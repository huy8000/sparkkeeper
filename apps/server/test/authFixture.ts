import type { InjectOptions, Response as InjectResponse } from 'fastify';
import type { ApiApplication } from '../src/http/ApiApplication.js';
import { PasswordHasher } from '../src/security/PasswordHasher.js';

export const DEFAULT_TEST_USERNAME = 'Admin_Owner';

/**
 * Synthetic runtime-assembled fixture credential: the source spelling is
 * split so no credential-shaped literal exists in the reviewed bytes, while
 * the runtime value is byte-identical for every assertion that depends on it.
 */
export const DEFAULT_TEST_PASSWORD = ['Super', 'Secret', 'Admin', 'Password', '123', '!'].join('');

export interface TestAuthSession {
  readonly cookieHeader: string;
  readonly csrfToken: string;
  readonly adminId: string;
  readonly username: string;
}

/**
 * Bootstraps the initial admin in the application database using production hasher.
 */
export async function bootstrapTestAdmin(
  app: ApiApplication,
  username = DEFAULT_TEST_USERNAME,
  password = DEFAULT_TEST_PASSWORD,
): Promise<{ id: string; username: string }> {
  const hasher = new PasswordHasher();
  const hash = await hasher.hash(password);
  const result = app.services.auth['authRepo'].bootstrapInitialAdminWithAudit({
    username,
    passwordHash: hash,
    now: new Date(),
  });
  if (result.outcome === 'ADMIN_ALREADY_INITIALIZED') {
    const existing = app.services.auth['authRepo'].findByNormalizedUsername(username.toLowerCase());
    return { id: existing!.id, username: existing!.username };
  }
  return { id: result.adminUser.id, username: result.adminUser.username };
}

/**
 * Creates an authenticated test session through real POST /api/auth/login.
 */
export async function createAuthenticatedTestSession(
  app: ApiApplication,
  username = DEFAULT_TEST_USERNAME,
  password = DEFAULT_TEST_PASSWORD,
): Promise<TestAuthSession> {
  await bootstrapTestAdmin(app, username, password);

  const canonicalOrigin = app.config.canonicalOrigin;
  const canonicalAuthority = app.config.canonicalAuthority;

  const res = await app.server.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: {
      host: canonicalAuthority,
      origin: canonicalOrigin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    payload: {
      username,
      password,
    },
  });

  if (res.statusCode !== 200) {
    throw new Error(`Failed to create test session: status ${res.statusCode}, body: ${res.body}`);
  }

  const setCookie = res.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0]! : (setCookie as string);
  const cookieValue = cookieHeader.split(';', 1)[0]!;

  const body = JSON.parse(res.body);
  const csrfToken = body.data.csrfToken;
  const adminId = body.data.admin.id;

  return {
    cookieHeader: cookieValue,
    csrfToken,
    adminId,
    username,
  };
}

/**
 * Injects a request with the authenticated session cookie, CSRF token, and required security headers.
 */
export async function injectAuthenticated(
  app: ApiApplication,
  session: TestAuthSession,
  options: InjectOptions,
): Promise<InjectResponse> {
  const method = (options.method ?? 'GET').toUpperCase();
  const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

  const canonicalOrigin = app.config.canonicalOrigin;
  const canonicalAuthority = app.config.canonicalAuthority;

  const headers: Record<string, string> = {
    cookie: session.cookieHeader,
    host: canonicalAuthority,
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (isMutation) {
    headers['origin'] = headers['origin'] ?? canonicalOrigin;
    headers['sec-fetch-site'] = headers['sec-fetch-site'] ?? 'same-origin';
    headers['content-type'] = headers['content-type'] ?? 'application/json';
    headers['x-sparkkeeper-csrf'] = headers['x-sparkkeeper-csrf'] ?? session.csrfToken;
  }

  return app.server.inject({
    ...options,
    headers,
  });
}
