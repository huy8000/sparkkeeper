import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { ApiError } from './errors/ApiError.js';
import {
  localMutationGuardOptions,
  registerMutationGuard,
  type MutationGuardOptions,
} from './plugins/MutationGuard.js';
import { registerAccountRoutes } from './routes/accountRoutes.js';
import { registerConfigurationRoutes } from './routes/configurationRoutes.js';
import { registerRealtimeRoutes, type RealtimeRouteOptions } from './routes/realtimeRoutes.js';
import { registerRunRoutes } from './routes/runRoutes.js';
import { registerStatusRoutes } from './routes/statusRoutes.js';
import { failure } from './serializers/envelope.js';
import type { ApiServices } from './services/ApiServices.js';

export interface CreateServerOptions {
  readonly services: ApiServices;
  readonly logger?: FastifyServerOptions['logger'];
  readonly mutationGuard?: MutationGuardOptions;
  readonly realtime?: RealtimeRouteOptions;
}

export function createServer(options: CreateServerOptions): FastifyInstance {
  const server = Fastify({
    logger: options.logger ?? false,
    ajv: {
      customOptions: {
        coerceTypes: true,
        removeAdditional: false,
      },
    },
  });

  server.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send(failure('ROUTE_NOT_FOUND', 'Route was not found.'));
  });

  registerMutationGuard(server, options.mutationGuard ?? localMutationGuardOptions(8080));

  server.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(failure(error.code, error.message));
    }
    if (isValidationError(error)) {
      return reply.code(400).send(failure('VALIDATION_ERROR', 'Request validation failed.'));
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

  registerStatusRoutes(server, options.services);
  registerAccountRoutes(server, options.services);
  registerConfigurationRoutes(server, options.services);
  registerRunRoutes(server, options.services);
  if (options.realtime !== undefined) registerRealtimeRoutes(server, options.realtime);
  return server;
}

function isValidationError(error: unknown): error is { readonly validation: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    error.validation !== undefined
  );
}
