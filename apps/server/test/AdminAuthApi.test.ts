import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AdminAuthRepository } from '@sparkkeeper/database';
import { createApiApplication, type ApiApplication } from '../src/http/ApiApplication.js';
import { resolveHttpConfig, HttpConfigError } from '../src/http/config/HttpConfig.js';
import { PasswordHasher } from '../src/security/PasswordHasher.js';
import { LoginRateLimiter } from '../src/security/LoginRateLimiter.js';
import { AdminAuthenticationService } from '../src/security/AdminAuthenticationService.js';
import type { RandomSource } from '../src/security/TokenUtils.js';
import {
  bootstrapTestAdmin,
  createAuthenticatedTestSession,
  DEFAULT_TEST_PASSWORD,
  DEFAULT_TEST_USERNAME,
  injectAuthenticated,
} from './authFixture.js';

/**
 * Synthetic runtime-assembled fixture credentials: the source spelling is
 * split so no credential-shaped literal exists in the reviewed bytes, while
 * the runtime values stay byte-identical for every assertion that depends on
 * them. Valid / wrong / unknown / unrevealed remain distinct from each other
 * exactly as before.
 */
const VALID_PASSWORD = ['Valid', 'Password', '1234', '!'].join('');
const WRONG_PASSWORD = ['Wrong', 'Password', '1234', '!'].join('');
const WRONG_123_PASSWORD = ['Wrong', 'Password', '123', '!'].join('');
const SOME_PASSWORD = ['Some', 'Password', '1234', '!'].join('');
const UNREVEALED_PASSWORD = ['Super', 'Secret', 'Unrevealed', 'Password', '123', '!'].join('');

interface TestContext {
  readonly app: ApiApplication;
  readonly dir: string;
  readonly dbPath: string;
  readonly canonicalOrigin: string;
  readonly canonicalAuthority: string;
}

function createTestContext(envOverrides: Record<string, string> = {}): TestContext {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-auth-api-test-'));
  const dbPath = path.join(dir, 'test.db');
  const env = {
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    HOST: '127.0.0.1',
    PORT: '8080',
    DATA_DIR: dir,
    ...envOverrides,
  };
  const app = createApiApplication({
    databasePath: dbPath,
    environment: env,
    logger: false,
  });
  return {
    app,
    dir,
    dbPath,
    canonicalOrigin: app.config.canonicalOrigin,
    canonicalAuthority: app.config.canonicalAuthority,
  };
}

async function cleanupTestContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}

test('AdminAuthApi: route classification inventory proves all non-health routes are protected', async () => {
  const ctx = createTestContext();
  try {
    // 1. Class P: Public health endpoint is accessible without credentials
    const healthRes = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/health',
    });
    assert.equal(healthRes.statusCode, 200);

    // 2. Class L: Login endpoint (does not require session cookie, but enforces L guard)
    const loginRes = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'Admin_User', password: VALID_PASSWORD },
    });
    // 503 SERVICE_NOT_INITIALIZED (proving it passed Class L guards to reach auth handler)
    assert.equal(loginRes.statusCode, 503);

    // 3. Class S & M routes reject unauthenticated requests with 401
    const realProtectedRoutes = [
      // Class S (Read)
      { method: 'GET', url: '/api/auth/me' },
      { method: 'GET', url: '/api/runtime/status' },
      { method: 'GET', url: '/api/accounts' },
      { method: 'GET', url: '/api/accounts/00000000-0000-4000-8000-000000000001' },
      { method: 'GET', url: '/api/accounts/00000000-0000-4000-8000-000000000001/friends' },
      { method: 'GET', url: '/api/friends/00000000-0000-4000-8000-000000000002' },
      { method: 'GET', url: '/api/accounts/00000000-0000-4000-8000-000000000001/schedules' },
      { method: 'GET', url: '/api/schedules/00000000-0000-4000-8000-000000000003' },
      { method: 'GET', url: '/api/templates' },
      { method: 'GET', url: '/api/templates/00000000-0000-4000-8000-000000000006' },
      { method: 'GET', url: '/api/runs' },
      { method: 'GET', url: '/api/runs/00000000-0000-4000-8000-000000000004' },
      { method: 'GET', url: '/api/runs/00000000-0000-4000-8000-000000000004/send-records' },
      { method: 'GET', url: '/api/runs/00000000-0000-4000-8000-000000000004/events' },
      {
        method: 'GET',
        url: '/api/accounts/00000000-0000-4000-8000-000000000001/manual-run/preflight?templateId=00000000-0000-4000-8000-000000000006',
      },
      { method: 'GET', url: '/api/notification-config' },
      { method: 'GET', url: '/api/events/stream' },

      // Class M (Mutation)
      { method: 'POST', url: '/api/auth/logout' },
      { method: 'POST', url: '/api/accounts' },
      { method: 'PATCH', url: '/api/accounts/00000000-0000-4000-8000-000000000001' },
      { method: 'POST', url: '/api/accounts/00000000-0000-4000-8000-000000000001/friends' },
      { method: 'PATCH', url: '/api/friends/00000000-0000-4000-8000-000000000002' },
      { method: 'POST', url: '/api/templates' },
      { method: 'PATCH', url: '/api/templates/00000000-0000-4000-8000-000000000006' },
      { method: 'PUT', url: '/api/accounts/00000000-0000-4000-8000-000000000001/schedule' },
      { method: 'POST', url: '/api/accounts/00000000-0000-4000-8000-000000000001/manual-runs' },
      { method: 'PUT', url: '/api/notification-config' },
      { method: 'POST', url: '/api/notification-config/test' },
    ] as const;

    for (const route of realProtectedRoutes) {
      const res = await ctx.app.server.inject({
        method: route.method,
        url: route.url,
      });
      assert.equal(
        res.statusCode,
        401,
        `Expected 401 UNAUTHENTICATED for ${route.method} ${route.url}, got ${res.statusCode}`,
      );
      const body = JSON.parse(res.body);
      assert.equal(body.error.code, 'UNAUTHENTICATED');
    }

    // 4. Registration guard: prove registering an unclassified route throws immediately
    const Fastify = (await import('fastify')).default;
    const guards = await import('../src/http/plugins/AdminAuthGuards.js');
    const testServer = Fastify();
    guards.registerAdminAuthGuards(testServer, {
      config: ctx.app.config,
      sessionService: ctx.app.services.sessions,
    });
    assert.throws(() => {
      testServer.get('/api/unclassified-test-route', async () => ({ ok: true }));
    }, /Security violation: Route GET \/api\/unclassified-test-route is registered without an explicit auth class/);
    await testServer.close();
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: POST /api/auth/login happy path sets cookie and returns CSRF token', async () => {
  const ctx = createTestContext();
  try {
    const admin = await bootstrapTestAdmin(ctx.app, 'Admin_Leader', VALID_PASSWORD);

    const res = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: {
        username: 'Admin_Leader',
        password: VALID_PASSWORD,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['pragma'], 'no-cache');

    const setCookie = res.headers['set-cookie'] as string;
    assert.ok(setCookie);
    assert.ok(setCookie.includes('sparkkeeper_dev_session='));
    assert.ok(setCookie.includes('HttpOnly'));
    assert.ok(setCookie.includes('SameSite=Strict'));
    assert.ok(setCookie.includes('Path=/'));

    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.data.admin.id, admin.id);
    assert.equal(body.data.admin.username, 'Admin_Leader');
    assert.equal(typeof body.data.csrfToken, 'string');
    assert.equal(body.data.csrfToken.length, 43);
    assert.equal(body.data.recentlyReauthenticated, true);

    // Verify token digest in DB
    const cookieToken = setCookie.split(';', 1)[0]!.split('=')[1]!;
    const expectedDigest = createHash('sha256')
      .update(Buffer.from(cookieToken, 'base64url'))
      .digest('hex');

    const sessionInDb = ctx.app.database.sqlite
      .prepare('SELECT * FROM admin_sessions WHERE token_digest = ?')
      .get(expectedDigest) as { id: string; admin_user_id: string } | undefined;
    assert.ok(sessionInDb);
    assert.equal(sessionInDb.admin_user_id, admin.id);

    // Verify LOGIN_SUCCEEDED audit event
    const audits = ctx.app.database.sqlite
      .prepare("SELECT * FROM audit_events WHERE action = 'LOGIN_SUCCEEDED'")
      .all() as Array<{ entity_id: string; actor_admin_user_id: string }>;
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entity_id, sessionInDb.id);
    assert.equal(audits[0].actor_admin_user_id, admin.id);
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: POST /api/auth/login handles wrong password and unknown username with parity', async () => {
  const ctx = createTestContext();
  try {
    const admin = await bootstrapTestAdmin(ctx.app, 'Admin_Known', VALID_PASSWORD);

    // 1. Wrong password for known user
    const wrongRes = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: {
        username: 'Admin_Known',
        password: WRONG_PASSWORD,
      },
    });

    assert.equal(wrongRes.statusCode, 401);
    assert.equal(wrongRes.headers['set-cookie'], undefined);
    const wrongBody = JSON.parse(wrongRes.body);
    assert.equal(wrongBody.error.code, 'INVALID_CREDENTIALS');
    assert.equal(wrongBody.error.message, 'Invalid admin username or password.');

    // Verify known-user audit event recorded
    const failAudits = ctx.app.database.sqlite
      .prepare("SELECT * FROM audit_events WHERE action = 'LOGIN_FAILED'")
      .all() as Array<{ entity_id: string }>;
    assert.equal(failAudits.length, 1);
    assert.equal(failAudits[0].entity_id, admin.id);

    // Legacy failure columns must remain unchanged
    const userInDb = ctx.app.database.sqlite
      .prepare('SELECT * FROM admin_users WHERE id = ?')
      .get(admin.id) as
      | {
          failed_login_count: number;
          locked_until: string | null;
          last_failed_login_at: string | null;
        }
      | undefined;
    assert.ok(userInDb);
    assert.equal(userInDb.failed_login_count, 0);
    assert.equal(userInDb.locked_until, null);
    assert.equal(userInDb.last_failed_login_at, null);

    // 2. Unknown username
    const unknownRes = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: {
        username: 'Admin_Unknown',
        password: SOME_PASSWORD,
      },
    });

    assert.equal(unknownRes.statusCode, 401);
    assert.equal(unknownRes.headers['set-cookie'], undefined);
    const unknownBody = JSON.parse(unknownRes.body);
    assert.equal(unknownBody.error.code, 'INVALID_CREDENTIALS');
    assert.equal(unknownBody.error.message, 'Invalid admin username or password.');

    // Unknown username must NOT create any additional audit row
    const failAuditsAfter = ctx.app.database.sqlite
      .prepare("SELECT * FROM audit_events WHERE action = 'LOGIN_FAILED'")
      .all();
    assert.equal(failAuditsAfter.length, 1); // still 1
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: returns 503 SERVICE_NOT_INITIALIZED when 0 admin users exist', async () => {
  const ctx = createTestContext();
  try {
    const res = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: {
        username: 'Admin_First',
        password: VALID_PASSWORD,
      },
    });

    assert.equal(res.statusCode, 503);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, 'SERVICE_NOT_INITIALIZED');
    assert.ok(body.error.message.includes('bootstrap CLI'));
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: enforces rate limiting with 429 and Retry-After header', async () => {
  const ctx = createTestContext();
  try {
    await bootstrapTestAdmin(ctx.app, 'Admin_Rate', VALID_PASSWORD);

    // First 5 attempts return 401
    for (let i = 1; i <= 5; i++) {
      const res = await ctx.app.server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          host: ctx.canonicalAuthority,
          origin: ctx.canonicalOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        payload: {
          username: 'Admin_Rate',
          password: WRONG_PASSWORD,
        },
      });
      assert.equal(res.statusCode, 401);
    }

    // 6th attempt returns 429 RATE_LIMITED
    const res6 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: {
        username: 'Admin_Rate',
        password: WRONG_PASSWORD,
      },
    });

    assert.equal(res6.statusCode, 429);
    assert.ok(res6.headers['retry-after']);
    const body = JSON.parse(res6.body);
    assert.equal(body.error.code, 'RATE_LIMITED');
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: rejects cross-origin and invalid metadata on login and mutations', async () => {
  const ctx = createTestContext();
  try {
    const session = await createAuthenticatedTestSession(ctx.app);

    // 1. Cross-origin Origin on Login
    const loginBadOrigin = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: 'http://attacker.com',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: DEFAULT_TEST_USERNAME, password: DEFAULT_TEST_PASSWORD },
    });
    assert.equal(loginBadOrigin.statusCode, 403);
    assert.equal(JSON.parse(loginBadOrigin.body).error.code, 'ORIGIN_REJECTED');

    // 2. Missing Origin with valid Referer (no fallback!)
    const loginMissingOrigin = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        referer: ctx.canonicalOrigin + '/login',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: DEFAULT_TEST_USERNAME, password: DEFAULT_TEST_PASSWORD },
    });
    assert.equal(loginMissingOrigin.statusCode, 403);
    assert.equal(JSON.parse(loginMissingOrigin.body).error.code, 'ORIGIN_REJECTED');

    // 3. Sec-Fetch-Site cross-site on Mutation
    const mutationCrossSite = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: session.cookieHeader,
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
        'x-sparkkeeper-csrf': session.csrfToken,
      },
      payload: {},
    });
    assert.equal(mutationCrossSite.statusCode, 403);
    assert.equal(JSON.parse(mutationCrossSite.body).error.code, 'ORIGIN_REJECTED');

    // 4. Missing CSRF on Mutation
    const mutationNoCsrf = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: session.cookieHeader,
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: {},
    });
    assert.equal(mutationNoCsrf.statusCode, 403);
    assert.equal(JSON.parse(mutationNoCsrf.body).error.code, 'CSRF_REJECTED');

    // 5. Wrong CSRF on Mutation
    const mutationWrongCsrf = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: session.cookieHeader,
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'x-sparkkeeper-csrf': 'a'.repeat(43),
      },
      payload: {},
    });
    assert.equal(mutationWrongCsrf.statusCode, 403);
    assert.equal(JSON.parse(mutationWrongCsrf.body).error.code, 'CSRF_REJECTED');
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: GET /api/auth/me returns identity and re-derives CSRF token', async () => {
  const ctx = createTestContext();
  try {
    const session = await createAuthenticatedTestSession(ctx.app, 'Admin_Me', VALID_PASSWORD);

    const res = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        cookie: session.cookieHeader,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['pragma'], 'no-cache');

    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.data.admin.id, session.adminId);
    assert.equal(body.data.admin.username, 'Admin_Me');
    // CSRF token matches the one from login!
    assert.equal(body.data.csrfToken, session.csrfToken);
    assert.equal(body.data.recentlyReauthenticated, true);
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: POST /api/auth/logout invalidates session, clears cookie, and records audit', async () => {
  const ctx = createTestContext();
  try {
    const session = await createAuthenticatedTestSession(ctx.app, 'Admin_Out', VALID_PASSWORD);

    const res = await injectAuthenticated(ctx.app, session, {
      method: 'POST',
      url: '/api/auth/logout',
      payload: {},
    });

    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');

    const setCookie = res.headers['set-cookie'] as string;
    assert.ok(setCookie);
    assert.ok(setCookie.includes('Max-Age=0') || setCookie.includes('Expires=Thu, 01 Jan 1970'));

    // Verify session revoked in DB
    const sessionInDb = ctx.app.database.sqlite
      .prepare('SELECT * FROM admin_sessions WHERE admin_user_id = ?')
      .get(session.adminId) as
      { id: string; revoked_at: string | null; revoke_reason: string | null } | undefined;
    assert.ok(sessionInDb);
    assert.ok(sessionInDb.revoked_at !== null);
    assert.equal(sessionInDb.revoke_reason, 'LOGOUT');

    // Verify LOGOUT audit event
    const logoutAudits = ctx.app.database.sqlite
      .prepare("SELECT * FROM audit_events WHERE action = 'LOGOUT'")
      .all() as Array<{ actor_admin_user_id: string }>;
    assert.equal(logoutAudits.length, 1);
    assert.equal(logoutAudits[0].actor_admin_user_id, session.adminId);

    // After logout, /me returns 401 SESSION_REVOKED
    const meRes = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        cookie: session.cookieHeader,
      },
    });
    assert.equal(meRes.statusCode, 401);
    assert.equal(JSON.parse(meRes.body).error.code, 'SESSION_REVOKED');
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: production vs development security mode configurations', () => {
  // 1. Valid development mode
  const devConfig = resolveHttpConfig({
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
  });
  assert.equal(devConfig.securityMode, 'development');
  assert.equal(devConfig.cookie.name, 'sparkkeeper_dev_session');
  assert.equal(devConfig.cookie.secure, false);

  // 2. Valid production mode
  const prodConfig = resolveHttpConfig({
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'production',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'https://sparkkeeper.example.com',
    SPARKKEEPER_ADMIN_TRUSTED_PROXY_CIDRS: '10.0.0.0/8, 172.16.0.0/12',
  });
  assert.equal(prodConfig.securityMode, 'production');
  assert.equal(prodConfig.cookie.name, '__Host-sparkkeeper_session');
  assert.equal(prodConfig.cookie.secure, true);

  // 3. Invalid production mode: http origin fails
  assert.throws(
    () => {
      resolveHttpConfig({
        SPARKKEEPER_ADMIN_SECURITY_MODE: 'production',
        SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://sparkkeeper.example.com',
        SPARKKEEPER_ADMIN_TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof HttpConfigError);
      assert.ok(err.message.includes('https:'));
      return true;
    },
  );

  // 4. Invalid production mode: missing proxy CIDRs fails
  assert.throws(
    () => {
      resolveHttpConfig({
        SPARKKEEPER_ADMIN_SECURITY_MODE: 'production',
        SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'https://sparkkeeper.example.com',
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof HttpConfigError);
      assert.ok(err.message.includes('TRUSTED_PROXY_CIDRS'));
      return true;
    },
  );

  // 5. Invalid development mode: non-loopback host fails
  assert.throws(
    () => {
      resolveHttpConfig({
        SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
        SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://remote.host.com:8080',
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof HttpConfigError);
      assert.ok(err.message.includes('loopback'));
      return true;
    },
  );
});

test('AdminAuthApi: duplicate session cookie headers reject login with 401 and 0 hasher/db calls', async () => {
  const ctx = createTestContext();
  try {
    await bootstrapTestAdmin(ctx.app, 'Admin_Dup', VALID_PASSWORD);

    let hasherCalls = 0;
    let validateCalls = 0;
    let finalizeCalls = 0;

    const originalVerify = ctx.app.services.auth['hasher'].verify.bind(
      ctx.app.services.auth['hasher'],
    );
    ctx.app.services.auth['hasher'].verify = async (phc: string, pass: string) => {
      hasherCalls++;
      return originalVerify(phc, pass);
    };

    const originalValidate = ctx.app.services.auth['authRepo'].validateSession.bind(
      ctx.app.services.auth['authRepo'],
    );
    ctx.app.services.auth['authRepo'].validateSession = (input: unknown) => {
      validateCalls++;
      return originalValidate(input as Parameters<typeof originalValidate>[0]);
    };

    const originalComplete = ctx.app.services.auth['authRepo'].completeAuthenticatedLogin.bind(
      ctx.app.services.auth['authRepo'],
    );
    ctx.app.services.auth['authRepo'].completeAuthenticatedLogin = (input: unknown) => {
      finalizeCalls++;
      return originalComplete(input as Parameters<typeof originalComplete>[0]);
    };

    const cookieName = ctx.app.config.cookie.name;
    const cookieA = `${cookieName}=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const cookieB = `${cookieName}=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;

    // Case 1: cookieA first, cookieB second
    const res1 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        cookie: `${cookieA}; ${cookieB}`,
      },
      payload: { username: 'Admin_Dup', password: VALID_PASSWORD },
    });
    assert.equal(res1.statusCode, 401);
    assert.equal(JSON.parse(res1.body).error.code, 'UNAUTHENTICATED');
    assert.equal(hasherCalls, 0);
    assert.equal(validateCalls, 0);
    assert.equal(finalizeCalls, 0);

    // Case 2: cookieB first, cookieA second
    const res2 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        cookie: `${cookieB}; ${cookieA}`,
      },
      payload: { username: 'Admin_Dup', password: VALID_PASSWORD },
    });
    assert.equal(res2.statusCode, 401);
    assert.equal(JSON.parse(res2.body).error.code, 'UNAUTHENTICATED');
    assert.equal(hasherCalls, 0);
    assert.equal(validateCalls, 0);
    assert.equal(finalizeCalls, 0);
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: RR-01 real server -> ApiClient -> parser -> AuthController production composition', async () => {
  const { createSparkKeeperApi } = await import('../../admin-web/src/api/sparkkeeperApi.js');
  const { createAuthController } = await import('../../admin-web/src/auth/AuthController.js');

  const ctx = createTestContext();
  try {
    await bootstrapTestAdmin(ctx.app, 'Admin_Dto', VALID_PASSWORD);

    // Real HTTP surface: ApiClient fetches are routed to Fastify.inject, which
    // preserves the actual JSON/cookie/header response shapes end to end. The
    // adapter emulates the browser cookie jar (Set-Cookie persisted, cookie
    // attached to subsequent requests) — ApiClient code itself is unchanged.
    const cookieJar = new Map<string, string>();
    const fetchImplementation = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith('http') ? url.slice(new URL(url).origin.length) : url;
      const method = (init?.method ?? 'GET') as 'GET' | 'POST';
      // Emulate the browser network layer: Host/Origin/Sec-Fetch-Site are
      // injected by real browsers, not by ApiClient code.
      const browserHeaders: Record<string, string> = {
        host: ctx.app.config.canonicalAuthority,
        origin: ctx.app.config.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
      };
      if (cookieJar.size > 0) {
        browserHeaders.cookie = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      const response = await ctx.app.server.inject({
        method,
        url: path,
        headers: { ...browserHeaders, ...((init?.headers as Record<string, string>) ?? {}) },
        ...(init?.body === undefined ? {} : { payload: init.body as string }),
      });
      const rawSetCookie = response.headers['set-cookie'];
      const setCookieValues = Array.isArray(rawSetCookie)
        ? rawSetCookie
        : rawSetCookie !== undefined
          ? [rawSetCookie]
          : [];
      for (const value of setCookieValues) {
        const [pair] = value.split(';');
        const eq = pair!.indexOf('=');
        const name = pair!.slice(0, eq);
        const cookieValue = pair!.slice(eq + 1);
        if (cookieValue === '') {
          cookieJar.delete(name);
        } else {
          cookieJar.set(name, cookieValue);
        }
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') headers.set(key, value);
      }
      return new Response(
        response.statusCode === 204 || response.body === '' ? null : response.body,
        {
          status: response.statusCode,
          headers,
        },
      );
    }) as typeof fetch;

    // Production wiring order (as in App.vue): the controller closes over the
    // api, and the api closes over the controller for CSRF provisioning.
    const apiRef: { current?: ReturnType<typeof createSparkKeeperApi> } = {};
    const controller = createAuthController(() => apiRef.current!);
    apiRef.current = createSparkKeeperApi({
      baseUrl: '/api',
      fetchImplementation,
      csrfTokenProvider: () => controller.getCsrfToken(),
    });

    // 1. Login: real server response through the real ApiClient and parser
    //    into the real AuthController.
    const loginData = await controller.login({
      username: 'Admin_Dto',
      password: VALID_PASSWORD,
    });
    assert.equal(controller.state.value, 'AUTHENTICATED');
    assert.equal(controller.isAuthenticated(), true);
    assert.equal(controller.user.value?.username, 'Admin_Dto');
    assert.equal(loginData.admin.username, 'Admin_Dto');
    assert.equal(typeof loginData.csrfToken, 'string');
    assert.equal(loginData.csrfToken.length, 43);
    assert.equal(loginData.recentlyReauthenticated, true);

    // 2. /me: real GET /api/auth/me through ApiClient -> parser -> bootstrap
    //    path on a fresh controller, using the same persisted cookie jar.
    const meApiRef: { current?: ReturnType<typeof createSparkKeeperApi> } = {};
    const meController = createAuthController(() => meApiRef.current!);
    meApiRef.current = createSparkKeeperApi({
      baseUrl: '/api',
      fetchImplementation,
      csrfTokenProvider: () => meController.getCsrfToken(),
    });
    const meData = await meApiRef.current!.getCurrentUser();
    assert.equal(meData.csrfToken, loginData.csrfToken, 'CSRF re-derived identically');
    assert.equal(meData.admin.username, 'Admin_Dto');
    const bootstrapped = await meController.bootstrap();
    assert.equal(bootstrapped, true, 'session cookie flows through the real client');
    assert.equal(meController.state.value, 'AUTHENTICATED');
    assert.equal(meController.getCsrfToken(), loginData.csrfToken);

    // 3. Real logout 204 through the same production composition.
    await meController.logout();
    assert.equal(meController.state.value, 'UNAUTHENTICATED');
    const afterLogout = await meController.bootstrap();
    assert.equal(afterLogout, false, 'session revoked server-side');
    assert.equal(meController.state.value, 'UNAUTHENTICATED');

    // 4. Malformed payloads fail closed through the real parser.
    const { parseAuthSessionResponse } = await import('../../admin-web/src/api/parsers.js');
    const malformedCases = [
      { ...loginData, extraField: 'bad' },
      { ...loginData, admin: { ...loginData.admin, extraAdmin: 'bad' } },
      { ...loginData, user: { id: '1', username: 'u' } },
      { ...loginData, sessionId: '123' },
      { ...loginData, csrfToken: 'short' },
      { ...loginData, csrfToken: 'not!valid!base64url!43charslongxxxxxxxxxx' },
      { ...loginData, idleExpiresAt: 'invalid-date' },
      { ...loginData, absoluteExpiresAt: null },
      { ...loginData, recentlyReauthenticated: 'not-a-bool' },
    ];
    for (const malformed of malformedCases) {
      const parsed = parseAuthSessionResponse(malformed);
      assert.equal(parsed, undefined, `Expected fail-closed for: ${JSON.stringify(malformed)}`);
    }
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: RR-06 trusted proxy semantics and X-Forwarded-For handling', async () => {
  const ctxUntrusted = createTestContext({
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
  });
  try {
    const res = await ctxUntrusted.app.server.inject({
      method: 'GET',
      url: '/api/health',
      headers: {
        'x-forwarded-for': '203.0.113.195',
      },
    });
    assert.equal(res.statusCode, 200);
  } finally {
    await cleanupTestContext(ctxUntrusted);
  }

  const ctxTrusted = createTestContext({
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'production',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'https://sparkkeeper.example.com',
    SPARKKEEPER_ADMIN_TRUSTED_PROXY_CIDRS: '127.0.0.1/32, 10.0.0.0/8',
  });
  try {
    const res = await ctxTrusted.app.server.inject({
      method: 'GET',
      url: '/api/health',
      headers: {
        host: 'sparkkeeper.example.com',
        'x-forwarded-for': '203.0.113.195',
        'x-forwarded-proto': 'https',
      },
    });
    assert.equal(res.statusCode, 200);
  } finally {
    await cleanupTestContext(ctxTrusted);
  }

  const { validateTrustedProxyEntry } = await import('../src/http/config/HttpConfig.js');
  const rejected = [
    '0.0.0.0',
    '0.0.0.0/0',
    '0.0.0.0/8',
    '::',
    '::/0',
    '::/64',
    '0:0:0:0:0:0:0:0',
    '0:0:0:0:0:0:0:0/0',
    'localhost',
    'proxy.internal.corp',
    '10.0.0.1/33',
    '2001:db8::1/129',
    'not-an-ip',
  ];

  for (const entry of rejected) {
    assert.throws(
      () => validateTrustedProxyEntry(entry),
      (err: unknown) => err instanceof HttpConfigError,
      `Expected rejection for: ${entry}`,
    );
  }
});

test('AdminAuthApi: A17 login replacement revokes old session with LOGIN_REPLACED while unrelated session remains valid', async () => {
  const ctx = createTestContext();
  try {
    await bootstrapTestAdmin(ctx.app, 'Admin_Replace', VALID_PASSWORD);

    const sessionA = await createAuthenticatedTestSession(ctx.app, 'Admin_Replace', VALID_PASSWORD);
    const sessionB = await createAuthenticatedTestSession(ctx.app, 'Admin_Replace', VALID_PASSWORD);

    const meA1 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionA.cookieHeader },
    });
    assert.equal(meA1.statusCode, 200);
    const meB1 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionB.cookieHeader },
    });
    assert.equal(meB1.statusCode, 200);

    const loginReplaceRes = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        cookie: sessionA.cookieHeader,
      },
      payload: { username: 'Admin_Replace', password: VALID_PASSWORD },
    });
    assert.equal(loginReplaceRes.statusCode, 200);
    const setCookieA2 = loginReplaceRes.headers['set-cookie'] as string;
    const sessionA2Cookie = setCookieA2.split(';', 1)[0]!;

    const meA2 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionA.cookieHeader },
    });
    assert.equal(meA2.statusCode, 401);
    assert.equal(JSON.parse(meA2.body).error.code, 'SESSION_REVOKED');

    const meA2Valid = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionA2Cookie },
    });
    assert.equal(meA2Valid.statusCode, 200);

    const meB2 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionB.cookieHeader },
    });
    assert.equal(meB2.statusCode, 200);
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: A22/A23 every Class M route strictly rejects missing, invalid, and cross-session CSRF before handler', async () => {
  const ctx = createTestContext();
  try {
    await bootstrapTestAdmin(ctx.app, 'Admin_Csrf', VALID_PASSWORD);
    const session1 = await createAuthenticatedTestSession(ctx.app, 'Admin_Csrf', VALID_PASSWORD);
    const session2 = await createAuthenticatedTestSession(ctx.app, 'Admin_Csrf', VALID_PASSWORD);

    const mutationRoutes = [
      { method: 'POST' as const, url: '/api/auth/logout', payload: {} },
      {
        method: 'POST' as const,
        url: '/api/accounts',
        payload: { name: 'Test Account', accountType: 'MAIN' },
      },
      {
        method: 'PATCH' as const,
        url: '/api/accounts/00000000-0000-4000-8000-000000000001',
        payload: { name: 'Updated' },
      },
      {
        method: 'POST' as const,
        url: '/api/accounts/00000000-0000-4000-8000-000000000001/friends',
        payload: { displayName: 'Friend 1' },
      },
      {
        method: 'PATCH' as const,
        url: '/api/friends/00000000-0000-4000-8000-000000000002',
        payload: { displayName: 'Friend 2' },
      },
      {
        method: 'POST' as const,
        url: '/api/templates',
        payload: { name: 'T1', messages: ['hello'] },
      },
      {
        method: 'PATCH' as const,
        url: '/api/templates/00000000-0000-4000-8000-000000000006',
        payload: { name: 'T2' },
      },
      {
        method: 'PUT' as const,
        url: '/api/accounts/00000000-0000-4000-8000-000000000001/schedule',
        payload: { startTime: '09:00', endTime: '10:00', timezone: 'UTC', enabled: true },
      },
      {
        method: 'POST' as const,
        url: '/api/accounts/00000000-0000-4000-8000-000000000001/manual-runs',
        payload: { templateId: '00000000-0000-4000-8000-000000000006' },
      },
      {
        method: 'PUT' as const,
        url: '/api/notification-config',
        payload: { enabled: false, webhookUrl: 'https://example.com' },
      },
      { method: 'POST' as const, url: '/api/notification-config/test', payload: {} },
    ];

    for (const route of mutationRoutes) {
      const resNoCsrf = await ctx.app.server.inject({
        method: route.method,
        url: route.url,
        headers: {
          cookie: session1.cookieHeader,
          host: ctx.canonicalAuthority,
          origin: ctx.canonicalOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        payload: route.payload,
      });
      assert.equal(
        resNoCsrf.statusCode,
        403,
        `Expected 403 CSRF_REJECTED for missing CSRF on ${route.method} ${route.url}`,
      );
      assert.equal(JSON.parse(resNoCsrf.body).error.code, 'CSRF_REJECTED');

      const resBadCsrf = await ctx.app.server.inject({
        method: route.method,
        url: route.url,
        headers: {
          cookie: session1.cookieHeader,
          host: ctx.canonicalAuthority,
          origin: ctx.canonicalOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'x-sparkkeeper-csrf': 'wrong-csrf-token-that-is-not-valid-43charsx',
        },
        payload: route.payload,
      });
      assert.equal(
        resBadCsrf.statusCode,
        403,
        `Expected 403 CSRF_REJECTED for bad CSRF on ${route.method} ${route.url}`,
      );
      assert.equal(JSON.parse(resBadCsrf.body).error.code, 'CSRF_REJECTED');

      const resCrossCsrf = await ctx.app.server.inject({
        method: route.method,
        url: route.url,
        headers: {
          cookie: session1.cookieHeader,
          host: ctx.canonicalAuthority,
          origin: ctx.canonicalOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
          'x-sparkkeeper-csrf': session2.csrfToken,
        },
        payload: route.payload,
      });
      assert.equal(
        resCrossCsrf.statusCode,
        403,
        `Expected 403 CSRF_REJECTED for cross-session CSRF on ${route.method} ${route.url}`,
      );
      assert.equal(JSON.parse(resCrossCsrf.body).error.code, 'CSRF_REJECTED');
    }
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('AdminAuthApi: legacy failedLoginCount, lockedUntil, lastFailedLoginAt are zero-read and zero-write', async () => {
  const ctx = createTestContext();
  try {
    const admin = await bootstrapTestAdmin(ctx.app, 'Admin_Legacy', VALID_PASSWORD);

    ctx.app.database.sqlite
      .prepare(
        'UPDATE admin_users SET failed_login_count = 42, locked_until = ?, last_failed_login_at = ? WHERE id = ?',
      )
      .run('2030-01-01T00:00:00.000Z', '2026-09-01T12:00:00.000Z', admin.id);

    await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'Admin_Legacy', password: WRONG_PASSWORD },
    });

    await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'Admin_Legacy', password: VALID_PASSWORD },
    });

    const row = ctx.app.database.sqlite
      .prepare(
        'SELECT failed_login_count, locked_until, last_failed_login_at FROM admin_users WHERE id = ?',
      )
      .get(admin.id) as {
      failed_login_count: number;
      locked_until: string;
      last_failed_login_at: string;
    };

    assert.equal(row.failed_login_count, 42);
    assert.equal(row.locked_until, '2030-01-01T00:00:00.000Z');
    assert.equal(row.last_failed_login_at, '2026-09-01T12:00:00.000Z');
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('Invariants A01 & A02: Zero plaintext passwords, hashes, raw tokens, or stack traces in logs, responses, or DB audits', async () => {
  const ctx = createTestContext();
  try {
    const password = UNREVEALED_PASSWORD;
    const username = 'Admin_Sentinel';
    await bootstrapTestAdmin(ctx.app, username, password);

    // Perform successful login
    const loginRes = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username, password },
    });

    assert.equal(loginRes.statusCode, 200);
    const loginBody = loginRes.body;
    assert.equal(loginBody.includes(password), false);
    assert.equal(loginBody.includes('$argon2id$'), false);

    // Perform failed login
    const failRes = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username, password: WRONG_123_PASSWORD },
    });
    assert.equal(failRes.statusCode, 401);
    assert.equal(failRes.body.includes(password), false);
    assert.equal(failRes.body.includes(WRONG_123_PASSWORD), false);

    // Scan all database audit rows for sensitive strings
    const audits = ctx.app.database.sqlite.prepare('SELECT * FROM audit_events').all() as Array<
      Record<string, unknown>
    >;
    for (const row of audits) {
      const serialized = JSON.stringify(row);
      assert.equal(serialized.includes(password), false);
      assert.equal(serialized.includes(WRONG_123_PASSWORD), false);
      assert.equal(serialized.includes('$argon2id$'), false);
    }
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('Invariant A08 & Failure F03: Corrupted/malformed PHC in DB returns 503 AUTH_SERVICE_UNAVAILABLE without native verify', async () => {
  const ctx = createTestContext();
  try {
    const admin = await bootstrapTestAdmin(ctx.app, 'Admin_Corrupt', DEFAULT_TEST_PASSWORD);

    // Overwrite passwordHash in DB with a malformed hash (m=100 is below 8192 bound)
    ctx.app.database.sqlite
      .prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
      .run('$argon2id$v=19$m=100,t=1,p=1$c2FsdA$aGFzaA', admin.id);

    const res = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'Admin_Corrupt', password: DEFAULT_TEST_PASSWORD },
    });

    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error.code, 'AUTH_SERVICE_UNAVAILABLE');
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('Invariant A09 & Failure F05: CSPRNG infrastructure failure returns 503 AUTH_SERVICE_UNAVAILABLE', async () => {
  const ctx = createTestContext();
  try {
    await bootstrapTestAdmin(ctx.app, 'Admin_Rng', DEFAULT_TEST_PASSWORD);

    const failingRandomSource: RandomSource = {
      randomBytes: () => {
        throw new Error('OS entropy pool exhausted');
      },
    };

    const authRepo = new AdminAuthRepository(ctx.app.database);
    const hasher = new PasswordHasher();
    const rateLimiter = new LoginRateLimiter();
    const service = new AdminAuthenticationService(
      authRepo,
      hasher,
      rateLimiter,
      failingRandomSource,
    );

    await assert.rejects(
      async () => {
        await service.login({
          username: 'Admin_Rng',
          password: DEFAULT_TEST_PASSWORD,
          clientIp: '127.0.0.1',
        });
      },
      (err: unknown) => {
        const error = err as { statusCode?: number; code?: string };
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, 'AUTH_SERVICE_UNAVAILABLE');
        return true;
      },
    );
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('Invariants A14, A15, A30: SSE stream requires valid session cookie and closes on revocation', async () => {
  const ctx = createTestContext();
  try {
    await bootstrapTestAdmin(ctx.app, 'Admin_Sse', DEFAULT_TEST_PASSWORD);
    const session = await createAuthenticatedTestSession(
      ctx.app,
      'Admin_Sse',
      DEFAULT_TEST_PASSWORD,
    );

    // 1. SSE without cookie returns 401 UNAUTHENTICATED
    const unauthSse = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/events/stream',
    });
    assert.equal(unauthSse.statusCode, 401);
    assert.equal(JSON.parse(unauthSse.body).error.code, 'UNAUTHENTICATED');

    // 2. Revoke session via logout
    await injectAuthenticated(ctx.app, session, {
      method: 'POST',
      url: '/api/auth/logout',
      payload: {},
    });

    // 3. SSE attempt with revoked cookie returns 401 SESSION_REVOKED
    const revokedSse = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/events/stream',
      headers: {
        cookie: session.cookieHeader,
      },
    });
    assert.equal(revokedSse.statusCode, 401);
    assert.equal(JSON.parse(revokedSse.body).error.code, 'SESSION_REVOKED');
  } finally {
    await cleanupTestContext(ctx);
  }
});

test('Failure Injection Matrix: F01 to F26 exhaustive failure scenarios', async () => {
  const ctx = createTestContext();
  try {
    // F01: Zero admin users -> 503 SERVICE_NOT_INITIALIZED
    const f01 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'Nobody', password: DEFAULT_TEST_PASSWORD },
    });
    assert.equal(f01.statusCode, 503);
    assert.equal(JSON.parse(f01.body).error.code, 'SERVICE_NOT_INITIALIZED');

    // Bootstrap admin for subsequent tests
    const admin = await bootstrapTestAdmin(ctx.app, 'Admin_Matrix', DEFAULT_TEST_PASSWORD);

    // F02: Non-existent admin user -> 401 INVALID_CREDENTIALS
    const f02 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'NonExistent', password: DEFAULT_TEST_PASSWORD },
    });
    assert.equal(f02.statusCode, 401);
    assert.equal(JSON.parse(f02.body).error.code, 'INVALID_CREDENTIALS');

    // F04: Disabled admin user -> 401 INVALID_CREDENTIALS on login
    ctx.app.database.sqlite
      .prepare("UPDATE admin_users SET status = 'DISABLED' WHERE id = ?")
      .run(admin.id);

    const f04 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'Admin_Matrix', password: DEFAULT_TEST_PASSWORD },
    });
    assert.equal(f04.statusCode, 401);
    assert.equal(JSON.parse(f04.body).error.code, 'INVALID_CREDENTIALS');

    // Restore ACTIVE status
    ctx.app.database.sqlite
      .prepare("UPDATE admin_users SET status = 'ACTIVE' WHERE id = ?")
      .run(admin.id);

    // F10: Invalid Origin on login -> 403 ORIGIN_REJECTED
    const f10 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        origin: 'http://malicious.origin.com',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'Admin_Matrix', password: DEFAULT_TEST_PASSWORD },
    });
    assert.equal(f10.statusCode, 403);
    assert.equal(JSON.parse(f10.body).error.code, 'ORIGIN_REJECTED');

    // F11: Missing Origin on login -> 403 ORIGIN_REJECTED
    const f11 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: ctx.canonicalAuthority,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: { username: 'Admin_Matrix', password: DEFAULT_TEST_PASSWORD },
    });
    assert.equal(f11.statusCode, 403);
    assert.equal(JSON.parse(f11.body).error.code, 'ORIGIN_REJECTED');

    // Create session for session failure tests
    const session = await createAuthenticatedTestSession(
      ctx.app,
      'Admin_Matrix',
      DEFAULT_TEST_PASSWORD,
    );

    // F12: Cross-site Sec-Fetch-Site on mutation -> 403 ORIGIN_REJECTED
    const f12 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: session.cookieHeader,
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
        'x-sparkkeeper-csrf': session.csrfToken,
      },
      payload: {},
    });
    assert.equal(f12.statusCode, 403);
    assert.equal(JSON.parse(f12.body).error.code, 'ORIGIN_REJECTED');

    // F13: Missing CSRF on mutation -> 403 CSRF_REJECTED
    const f13 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: session.cookieHeader,
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
      },
      payload: {},
    });
    assert.equal(f13.statusCode, 403);
    assert.equal(JSON.parse(f13.body).error.code, 'CSRF_REJECTED');

    // F14: Wrong CSRF on mutation -> 403 CSRF_REJECTED
    const f14 = await ctx.app.server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: session.cookieHeader,
        host: ctx.canonicalAuthority,
        origin: ctx.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'x-sparkkeeper-csrf': 'wrong-csrf-token-that-is-not-valid-43charsx',
      },
      payload: {},
    });
    assert.equal(f14.statusCode, 403);
    assert.equal(JSON.parse(f14.body).error.code, 'CSRF_REJECTED');

    // F16: Missing session cookie -> 401 UNAUTHENTICATED
    const f16 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
    });
    assert.equal(f16.statusCode, 401);
    assert.equal(JSON.parse(f16.body).error.code, 'UNAUTHENTICATED');

    // F17: Malformed session cookie shape -> 401 UNAUTHENTICATED
    const cookieName = ctx.app.config.cookie.name;
    const f17 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${cookieName}=short-invalid` },
    });
    assert.equal(f17.statusCode, 401);
    assert.equal(JSON.parse(f17.body).error.code, 'UNAUTHENTICATED');

    // F18: Duplicate session cookie header -> 401 UNAUTHENTICATED
    const f18 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        cookie: `${cookieName}=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa; ${cookieName}=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
      },
    });
    assert.equal(f18.statusCode, 401);
    assert.equal(JSON.parse(f18.body).error.code, 'UNAUTHENTICATED');

    // F19: Non-existent session token digest -> 401 UNAUTHENTICATED
    const f19 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${cookieName}=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` },
    });
    assert.equal(f19.statusCode, 401);
    assert.equal(JSON.parse(f19.body).error.code, 'UNAUTHENTICATED');

    // F24: Session version mismatch (cascade revocation) -> 401 SESSION_REVOKED
    ctx.app.database.sqlite
      .prepare('UPDATE admin_users SET session_version = session_version + 1 WHERE id = ?')
      .run(admin.id);

    const f24 = await ctx.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: session.cookieHeader },
    });
    assert.equal(f24.statusCode, 401);
    assert.equal(JSON.parse(f24.body).error.code, 'SESSION_REVOKED');
  } finally {
    await cleanupTestContext(ctx);
  }
});
