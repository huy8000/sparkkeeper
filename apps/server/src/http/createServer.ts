import fastifyCookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { resolveHttpConfig, type HttpConfig } from './config/HttpConfig.js';
import { ApiError } from './errors/ApiError.js';
import {
  registerAdminAuthGuards,
  type AdminAuthGuardRegistration,
} from './plugins/AdminAuthGuards.js';
import { registerAccountRoutes } from './routes/accountRoutes.js';
import { registerAuthRoutes } from './routes/authRoutes.js';
import { registerConfigurationRoutes } from './routes/configurationRoutes.js';
import {
  registerRealtimeRoutes,
  type RealtimeRouteRegistrationOptions,
} from './routes/realtimeRoutes.js';
import { registerRunRoutes } from './routes/runRoutes.js';
import { registerManualRunRoutes } from './routes/manualRunRoutes.js';
import { registerNotificationRoutes } from './routes/notificationRoutes.js';
import { registerStatusRoutes } from './routes/statusRoutes.js';
import { failure } from './serializers/envelope.js';
import type { ApiServices } from './services/ApiServices.js';

export interface CreateServerOptions {
  readonly services: ApiServices;
  readonly config?: HttpConfig | undefined;
  readonly logger?: FastifyServerOptions['logger'] | undefined;
  readonly clock?: (() => Date) | undefined;
  readonly realtime?: RealtimeRouteRegistrationOptions | undefined;
}

export interface CreatedServer {
  readonly server: FastifyInstance;
  readonly authGuards: AdminAuthGuardRegistration;
}

export function createServer(options: CreateServerOptions): CreatedServer {
  const config = options.config ?? resolveHttpConfig();
  const fastifyOptions: FastifyServerOptions = {
    logger: options.logger ?? false,
    trustProxy: config.trustProxy === false ? false : [...config.trustProxy],
    ajv: {
      customOptions: {
        coerceTypes: true,
        removeAdditional: false,
      },
    },
  };

  const server = Fastify(fastifyOptions);

  server.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send(failure('ROUTE_NOT_FOUND', 'Route was not found.'));
  });

  // Register cookie parser
  server.register(fastifyCookie);

  // Register auth and mutation guards (returns actual registration metadata)
  const authGuards = registerAdminAuthGuards(server, {
    config,
    sessionService: options.services.sessions,
    clock: options.clock,
  });

  server.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.retryAfter !== undefined) {
        reply.header('Retry-After', String(error.retryAfter));
      }
      if (error.statusCode === 401) {
        reply.header('Cache-Control', 'no-store');
        reply.header('Pragma', 'no-cache');
      }
      return reply.code(error.statusCode).send(failure(error.code, error.message));
    }

    if (isValidationError(error)) {
      return reply.code(400).send(failure('VALIDATION_ERROR', 'Request validation failed.'));
    }

    // Body-size violations surface as Fastify 413 content-parser errors; they
    // must classify as safe validation failures, never raw 500 diagnostics.
    if ((error as { statusCode?: number }).statusCode === 413) {
      return reply.code(413).send(failure('VALIDATION_ERROR', 'Request body is too large.'));
    }

    request.log.error(
      {
        eventType: 'HTTP_REQUEST_FAILED',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
      'HTTP request failed',
    );
    return reply
      .code(500)
      .send(failure('INTERNAL_ERROR', 'An unexpected internal error occurred.'));
  });

  registerAuthRoutes(server, options.services, config);
  registerStatusRoutes(server, options.services);
  registerAccountRoutes(server, options.services);
  registerConfigurationRoutes(server, options.services);
  registerRunRoutes(server, options.services);
  registerManualRunRoutes(server, options.services);
  registerNotificationRoutes(server, options.services);
  if (options.realtime !== undefined) {
    registerRealtimeRoutes(server, {
      ...options.realtime,
      sessionService: options.services.sessions,
      config,
      clock: options.clock,
    });
  }
  return { server, authGuards };
}

function isValidationError(error: unknown): error is { readonly validation: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    error.validation !== undefined
  );
}
