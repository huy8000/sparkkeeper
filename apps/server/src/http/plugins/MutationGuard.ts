import type { FastifyInstance, FastifyRequest } from 'fastify';

import { ApiError } from '../errors/ApiError.js';

export const ADMIN_MUTATION_HEADER = 'x-sparkkeeper-admin-request';
export const ADMIN_MUTATION_HEADER_VALUE = '1';
export const DEFAULT_ADMIN_WEB_PORT = 5173;

export interface MutationGuardOptions {
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedOrigins: ReadonlySet<string>;
}

export function localMutationGuardOptions(apiPort: number): MutationGuardOptions {
  const endpoints = [
    `127.0.0.1:${apiPort}`,
    `localhost:${apiPort}`,
    `127.0.0.1:${DEFAULT_ADMIN_WEB_PORT}`,
    `localhost:${DEFAULT_ADMIN_WEB_PORT}`,
  ];
  return {
    allowedHosts: new Set(endpoints),
    allowedOrigins: new Set(endpoints.map((endpoint) => `http://${endpoint}`)),
  };
}

export function registerMutationGuard(
  server: FastifyInstance,
  options: MutationGuardOptions,
): void {
  server.addHook('onRequest', async (request) => {
    if (!isApiMutation(request)) return;

    assertJsonContentType(request);
    if (request.headers[ADMIN_MUTATION_HEADER] !== ADMIN_MUTATION_HEADER_VALUE) {
      throw new ApiError(
        403,
        'ADMIN_REQUEST_REQUIRED',
        'A valid local Admin mutation request is required.',
      );
    }

    const host = request.headers.host?.toLowerCase();
    if (host === undefined || !options.allowedHosts.has(host)) {
      throw rejectedAdminRequest();
    }

    const origin = request.headers.origin;
    if (origin !== undefined && !isAllowedOrigin(origin, options.allowedOrigins)) {
      throw rejectedAdminRequest();
    }
  });
}

function isApiMutation(request: FastifyRequest): boolean {
  return (
    request.url.startsWith('/api/') &&
    request.method !== 'GET' &&
    request.method !== 'HEAD' &&
    request.method !== 'OPTIONS'
  );
}

function assertJsonContentType(request: FastifyRequest): void {
  const contentType = request.headers['content-type'];
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Configuration mutations require application/json.',
    );
  }
}

function isAllowedOrigin(origin: string, allowedOrigins: ReadonlySet<string>): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

function rejectedAdminRequest(): ApiError {
  return new ApiError(
    403,
    'ADMIN_REQUEST_REJECTED',
    'The local Admin mutation request was rejected.',
  );
}
