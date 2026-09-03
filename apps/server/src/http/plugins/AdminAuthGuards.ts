import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { HttpConfig } from '../config/HttpConfig.js';
import { ApiError } from '../errors/ApiError.js';
import type { AdminSessionService } from '../../security/AdminSessionService.js';

export type AuthRouteClass = 'P' | 'L' | 'S' | 'M' | 'R';

/** Frozen runtime allowlist: registration config is untyped at runtime. */
export const FROZEN_AUTH_ROUTE_CLASSES: readonly AuthRouteClass[] = ['P', 'L', 'S', 'M', 'R'];

export interface AdminAuthContext {
  readonly adminUserId: string;
  readonly username: string;
  readonly sessionId: string;
  readonly reauthenticatedAt: Date | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly now: Date;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthRouteClass;
  }
  interface FastifyRequest {
    authContext?: AdminAuthContext;
    requestSampledNow?: Date;
  }
}

export interface AdminAuthGuardsOptions {
  readonly config: HttpConfig;
  readonly sessionService: AdminSessionService;
  readonly clock?: (() => Date) | undefined;
}

export interface RegisteredApiRoute {
  readonly method: string;
  readonly url: string;
  readonly authClass: AuthRouteClass;
}

export interface AdminAuthGuardRegistration {
  /**
   * Actual Fastify registration metadata for every /api route, captured through
   * the same onRoute hook that enforces classification. This is the authoritative
   * route inventory; handwritten lists must not claim exhaustive coverage.
   */
  readonly getApiRouteInventory: () => readonly RegisteredApiRoute[];
}

/**
 * Checks if raw Cookie header contains duplicate occurrences of a given cookie name.
 */
export function hasDuplicateCookieName(
  rawCookieHeader: string | undefined,
  cookieName: string,
): boolean {
  if (!rawCookieHeader) return false;
  const regex = new RegExp(`(?:^|;)\\s*${cookieName}\\s*=`, 'g');
  const matches = rawCookieHeader.match(regex);
  return matches !== null && matches.length > 1;
}

/**
 * Sets a clearing cookie on the reply matching the configured cookie attributes.
 */
export function setClearingCookie(reply: FastifyReply, config: HttpConfig): void {
  reply.setCookie(config.cookie.name, '', {
    secure: config.cookie.secure,
    httpOnly: config.cookie.httpOnly,
    sameSite: config.cookie.sameSite,
    path: config.cookie.path,
    maxAge: 0,
    expires: new Date(0),
  });
}

/**
 * Registers the Admin authentication and mutation guards hook on the Fastify instance.
 * Returns the actual route registration metadata captured by the classification hook.
 */
export function registerAdminAuthGuards(
  server: FastifyInstance,
  options: AdminAuthGuardsOptions,
): AdminAuthGuardRegistration {
  const { config, sessionService } = options;
  const clock = options.clock ?? (() => new Date());

  const apiRouteInventory: RegisteredApiRoute[] = [];

  // Fail-fast route classification validator on registration; the same hook
  // records the actual registration metadata as the authoritative inventory.
  // Runtime allowlist: TypeScript typing cannot protect against malformed
  // runtime config objects, so an invalid truthy class also fails registration.
  server.addHook('onRoute', (routeOptions) => {
    if (routeOptions.url.startsWith('/api/') || routeOptions.url === '/api') {
      const auth = (routeOptions.config as { auth?: unknown } | undefined)?.auth;
      if (!auth) {
        throw new Error(
          `Security violation: Route ${routeOptions.method} ${routeOptions.url} is registered without an explicit auth class (P, L, S, M, R).`,
        );
      }
      if (typeof auth !== 'string' || !FROZEN_AUTH_ROUTE_CLASSES.includes(auth as AuthRouteClass)) {
        throw new Error(
          `Security violation: Route ${routeOptions.method} ${routeOptions.url} declares invalid auth class ${String(
            auth,
          )} (allowed: P, L, S, M, R).`,
        );
      }
      apiRouteInventory.push({
        method: String(routeOptions.method),
        url: routeOptions.url,
        authClass: auth as AuthRouteClass,
      });
    }
  });

  server.addHook('onRequest', async (request, reply) => {
    // Only inspect /api/ routes
    if (!request.url.startsWith('/api/') && request.url !== '/api') {
      return;
    }

    const routeConfig = request.routeOptions?.config;
    const authClass: AuthRouteClass | undefined = routeConfig?.auth;
    if (!authClass) {
      return;
    }

    // Check for duplicate cookie names before any auth handling (including Class L)
    const rawCookie = request.headers.cookie;
    if (hasDuplicateCookieName(rawCookie, config.cookie.name)) {
      setClearingCookie(reply, config);
      throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid or duplicate session cookie.');
    }

    // Sample single request time
    const now = clock();
    request.requestSampledNow = now;

    // Class P: Public health endpoint
    if (authClass === 'P') {
      return;
    }

    // Class L: Public login endpoint
    if (authClass === 'L') {
      assertOriginAndFetchMetadata(request, config);
      assertJsonContentType(request);
      return;
    }

    // Class S, M & R: Session authentication required
    const token = request.cookies[config.cookie.name];
    if (!token) {
      const cookiePresented = rawCookie && rawCookie.includes(config.cookie.name + '=');
      if (cookiePresented) {
        setClearingCookie(reply, config);
      }
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const val = sessionService.validateSession(token, now);
    if (val.outcome === 'UNAUTHENTICATED') {
      setClearingCookie(reply, config);
      throw new ApiError(401, 'UNAUTHENTICATED', 'Session is invalid or does not exist.');
    }

    if (val.outcome === 'SESSION_EXPIRED') {
      setClearingCookie(reply, config);
      throw new ApiError(401, 'SESSION_EXPIRED', 'Session has expired.');
    }

    if (val.outcome === 'SESSION_REVOKED') {
      setClearingCookie(reply, config);
      throw new ApiError(401, 'SESSION_REVOKED', 'Session has been revoked.');
    }

    // Attach validated safe authContext to request (no raw tokens, hashes, or digests)
    request.authContext = {
      adminUserId: val.adminUser.id,
      username: val.adminUser.username,
      sessionId: val.session.id,
      reauthenticatedAt: val.session.reauthenticatedAt,
      idleExpiresAt: val.session.idleExpiresAt,
      absoluteExpiresAt: val.session.absoluteExpiresAt,
      now,
    };

    // Class M & R: Protected mutation checks
    if (authClass === 'M' || authClass === 'R') {
      assertOriginAndFetchMetadata(request, config);
      assertJsonContentType(request);

      // Validate session-bound CSRF token
      const csrfHeader = request.headers['x-sparkkeeper-csrf'];
      if (
        typeof csrfHeader !== 'string' ||
        !sessionService.validateCsrf(csrfHeader, val.session.csrfTokenDigest)
      ) {
        throw new ApiError(403, 'CSRF_REJECTED', 'Invalid or missing CSRF token.');
      }
    }

    // Class R: Recent re-authentication check
    if (authClass === 'R') {
      const reauthAgeMs = now.getTime() - (val.session.reauthenticatedAt?.getTime() ?? 0);
      if (reauthAgeMs > 5 * 60 * 1000) {
        throw new ApiError(
          403,
          'REAUTH_REQUIRED',
          'Recent authentication required for sensitive operations.',
        );
      }
    }
  });

  return {
    getApiRouteInventory: () => [...apiRouteInventory],
  };
}

function assertOriginAndFetchMetadata(request: FastifyRequest, config: HttpConfig): void {
  // 1. Host / Authority check
  const host = request.headers.host?.toLowerCase();
  if (host !== config.canonicalAuthority.toLowerCase()) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Request authority mismatch.');
  }

  // 2. Protocol check
  const protocol = (request.protocol ?? 'http') + ':';
  if (protocol !== config.canonicalProtocol) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Request protocol mismatch.');
  }

  // 3. Origin header check (mandatory, exact match, NO Referer fallback!)
  const origin = request.headers.origin;
  if (!origin || origin !== config.canonicalOrigin) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Origin mismatch or missing origin.');
  }

  // 4. Sec-Fetch-Site header check (mandatory, must be 'same-origin')
  const secFetchSite = request.headers['sec-fetch-site'];
  if (secFetchSite !== 'same-origin') {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Sec-Fetch-Site must be same-origin.');
  }
}

function assertJsonContentType(request: FastifyRequest): void {
  const contentType = request.headers['content-type'];
  const mediaType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'API mutations require application/json content type.',
    );
  }
}
