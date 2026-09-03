import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApiApplication, type ApiApplication } from '../src/http/ApiApplication.js';
import { createDatabase, type DatabaseClient } from '@sparkkeeper/database';
import type { AdminAuthRepository } from '@sparkkeeper/database';
import {
  bootstrapTestAdmin,
  createAuthenticatedTestSession,
  DEFAULT_TEST_PASSWORD,
} from './authFixture.js';

/** Test-only sentinel assembled at runtime (never a real credential). */
const WRONG_TEST_PASSWORD = ['deliberately', 'wrong', 'sentinel', 'V42'].join('-');

interface Fixture {
  readonly app: ApiApplication;
  readonly dir: string;
  readonly close: () => Promise<void>;
}

function createFixture(envOverrides: Record<string, string> = {}): Fixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-failclosed-'));
  const app = createApiApplication({
    databasePath: path.join(dir, 'test.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      DATA_DIR: dir,
      ...envOverrides,
    },
    logger: false,
  });
  return {
    app,
    dir,
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function loginInject(app: ApiApplication, payload: unknown, headers: Record<string, string> = {}) {
  return app.server.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: {
      host: app.config.canonicalAuthority,
      origin: app.config.canonicalOrigin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    payload: payload as Record<string, unknown>,
  });
}

function sessionRows(app: ApiApplication): Array<Record<string, unknown>> {
  return app.database.sqlite.prepare('SELECT * FROM admin_sessions ORDER BY id').all() as Array<
    Record<string, unknown>
  >;
}

function adminRows(app: ApiApplication): Array<Record<string, unknown>> {
  return app.database.sqlite.prepare('SELECT * FROM admin_users ORDER BY id').all() as Array<
    Record<string, unknown>
  >;
}

function auditCount(app: ApiApplication, action: string): number {
  const row = app.database.sqlite
    .prepare('SELECT COUNT(*) AS total FROM audit_events WHERE action = ?')
    .get(action) as { total: number };
  return row.total;
}

/**
 * Wraps a repository method so that, on the first invocation, a REAL second
 * physical connection acquires an exclusive writer lock before the original
 * method runs. The wrapped method then observes actual SQLITE_BUSY beyond the
 * bounded 500ms window. This injects a real DB fact; it never decides an
 * authentication outcome.
 */
function wrapWithRealLock<T extends object>(
  repo: T,
  methodName: keyof T & string,
  lock: { acquire: () => void },
  state: { armed: boolean; fired: boolean },
): void {
  const original = (repo[methodName] as unknown as (...args: unknown[]) => unknown).bind(repo);
  (repo as Record<string, unknown>)[methodName] = (...args: unknown[]) => {
    if (state.armed) {
      state.armed = false;
      state.fired = true;
      lock.acquire();
    }
    return original(...args);
  };
}

test('V42-FR-06 A: known wrong password + LOGIN_FAILED audit DB failure -> 503, nothing mutated', async () => {
  const fixture = createFixture();
  const secondConnection: DatabaseClient = createDatabase({
    databasePath: path.join(fixture.dir, 'test.db'),
  });
  const writer = secondConnection.sqlite;
  let lockHeld = false;
  const lock = {
    acquire: () => {
      writer.exec('BEGIN EXCLUSIVE');
      lockHeld = true;
    },
  };
  const state = { armed: true, fired: false };

  try {
    const admin = await bootstrapTestAdmin(fixture.app, 'Admin_FcA', DEFAULT_TEST_PASSWORD);
    const beforeSessions = sessionRows(fixture.app);
    const beforeAdmins = adminRows(fixture.app);
    const beforeLogins = auditCount(fixture.app, 'LOGIN_SUCCEEDED');
    const beforeFailures = auditCount(fixture.app, 'LOGIN_FAILED');

    const authRepo = (fixture.app.services.auth as unknown as Record<string, unknown>)[
      'authRepo'
    ] as AdminAuthRepository;
    wrapWithRealLock(authRepo, 'recordKnownCredentialFailureAudit', lock, state);

    let successClearCalls = 0;
    const rateLimiter = (fixture.app.services.auth as unknown as Record<string, unknown>)[
      'rateLimiter'
    ] as { recordSuccess: (ip: string, username: string) => void };
    const originalRecordSuccess = rateLimiter.recordSuccess.bind(rateLimiter);
    rateLimiter.recordSuccess = (ip: string, username: string) => {
      successClearCalls += 1;
      originalRecordSuccess(ip, username);
    };

    const res = await loginInject(fixture.app, {
      username: 'Admin_FcA',
      password: WRONG_TEST_PASSWORD,
    });
    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.equal(state.fired, true, 'audit seam must have been reached');
    assert.equal(lockHeld, true);

    assert.equal(sessionRows(fixture.app).length, beforeSessions.length);
    assert.deepEqual(sessionRows(fixture.app), beforeSessions);
    assert.deepEqual(adminRows(fixture.app), beforeAdmins);
    assert.equal(auditCount(fixture.app, 'LOGIN_SUCCEEDED'), beforeLogins);
    assert.equal(auditCount(fixture.app, 'LOGIN_FAILED'), beforeFailures, 'audit write failed');
    assert.equal(successClearCalls, 0);
    assert.notEqual(JSON.parse(res.body).error.code, 'INVALID_CREDENTIALS');
    assert.ok(admin.id);
  } finally {
    if (lockHeld) {
      try {
        writer.exec('ROLLBACK');
      } catch {
        // already closed
      }
    }
    secondConnection.close();
    await fixture.close();
  }
});

test('V42-FR-06 B: old presented session validation DB failure during login -> 503, no replacement', async () => {
  const fixture = createFixture();
  const secondConnection: DatabaseClient = createDatabase({
    databasePath: path.join(fixture.dir, 'test.db'),
  });
  const writer = secondConnection.sqlite;
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_FcB', DEFAULT_TEST_PASSWORD);
    const session = await createAuthenticatedTestSession(
      fixture.app,
      'Admin_FcB',
      DEFAULT_TEST_PASSWORD,
    );

    // Backdate the whole session timeline consistently (CHECK constraints keep
    // created_at <= last_seen_at) so the 5m touch write fires inside
    // validateSession and the real lock produces BUSY.
    const backdatedMs = new Date('2020-01-01T00:00:00.000Z').getTime();
    fixture.app.database.sqlite
      .prepare(
        'UPDATE admin_sessions SET created_at = ?, reauthenticated_at = ?, last_seen_at = ?, idle_expires_at = ?, absolute_expires_at = ?',
      )
      .run(
        backdatedMs,
        backdatedMs,
        backdatedMs,
        backdatedMs + 20 * 60_000,
        backdatedMs + 12 * 60 * 60_000,
      );

    const beforeSessions = sessionRows(fixture.app);
    const beforeAdmins = adminRows(fixture.app);

    const lock = { acquire: () => writer.exec('BEGIN EXCLUSIVE') };
    const state = { armed: true, fired: false };
    const authRepo = (fixture.app.services.auth as unknown as Record<string, unknown>)[
      'authRepo'
    ] as AdminAuthRepository;
    wrapWithRealLock(authRepo, 'validateSession', lock, state);

    const res = await loginInject(
      fixture.app,
      {
        username: 'Admin_FcB',
        password: DEFAULT_TEST_PASSWORD,
      },
      { cookie: session.cookieHeader },
    );

    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.equal(state.fired, true);

    // No finalizer, no replacement, no revocation: byte-equivalent rows.
    assert.deepEqual(sessionRows(fixture.app), beforeSessions);
    assert.deepEqual(adminRows(fixture.app), beforeAdmins);
    assert.equal(auditCount(fixture.app, 'LOGIN_SUCCEEDED'), 1); // from fixture session only
  } finally {
    try {
      writer.exec('ROLLBACK');
    } catch {
      // ignore
    }
    secondConnection.close();
    await fixture.close();
  }
});

test('V42-FR-06 C: session RNG failure -> 503 through real HTTP, no session, no success audit, no limiter clear', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-rng-fail-'));
  const app = createApiApplication({
    databasePath: path.join(dir, 'test.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      DATA_DIR: dir,
    },
    logger: false,
  });
  try {
    await bootstrapTestAdmin(app, 'Admin_FcC', DEFAULT_TEST_PASSWORD);
    const beforeSessions = sessionRows(app);
    const beforeAdmins = adminRows(app);

    // Swap ONLY the random source on the production service instance for the
    // specific RNG-failure injection (no decision seam: the rest of the service
    // remains production code).
    const authService = app.services.auth as unknown as {
      randomSource: { randomBytes: (n: number) => Buffer };
    };
    const originalSource = authService.randomSource;
    authService.randomSource = {
      randomBytes: () => {
        throw new Error('OS entropy pool exhausted');
      },
    };

    let successClearCalls = 0;
    const rateLimiter = (app.services.auth as unknown as Record<string, unknown>)[
      'rateLimiter'
    ] as {
      recordSuccess: (ip: string, username: string) => void;
    };
    const originalRecordSuccess = rateLimiter.recordSuccess.bind(rateLimiter);
    rateLimiter.recordSuccess = (ip: string, username: string) => {
      successClearCalls += 1;
      originalRecordSuccess(ip, username);
    };

    const res = await loginInject(app, { username: 'Admin_FcC', password: DEFAULT_TEST_PASSWORD });
    authService.randomSource = originalSource;

    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.equal(sessionRows(app).length, beforeSessions.length);
    assert.deepEqual(sessionRows(app), beforeSessions);
    assert.deepEqual(adminRows(app), beforeAdmins);
    assert.equal(auditCount(app, 'LOGIN_SUCCEEDED'), 0);
    assert.equal(successClearCalls, 0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('V42-FR-06 D: login finalize DB failure -> 503 with full rollback', async () => {
  const fixture = createFixture();
  const secondConnection: DatabaseClient = createDatabase({
    databasePath: path.join(fixture.dir, 'test.db'),
  });
  const writer = secondConnection.sqlite;
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_FcD', DEFAULT_TEST_PASSWORD);
    const session = await createAuthenticatedTestSession(
      fixture.app,
      'Admin_FcD',
      DEFAULT_TEST_PASSWORD,
    );

    const beforeSessions = sessionRows(fixture.app);
    const beforeAdmins = adminRows(fixture.app);

    const lock = { acquire: () => writer.exec('BEGIN EXCLUSIVE') };
    const state = { armed: true, fired: false };
    const authRepo = (fixture.app.services.auth as unknown as Record<string, unknown>)[
      'authRepo'
    ] as AdminAuthRepository;
    wrapWithRealLock(authRepo, 'completeAuthenticatedLogin', lock, state);

    const res = await loginInject(
      fixture.app,
      {
        username: 'Admin_FcD',
        password: DEFAULT_TEST_PASSWORD,
      },
      { cookie: session.cookieHeader },
    );

    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.equal(state.fired, true);

    // Full rollback: no new session, old session not revoked, no partial updates.
    assert.deepEqual(sessionRows(fixture.app), beforeSessions);
    assert.deepEqual(adminRows(fixture.app), beforeAdmins);
    assert.equal(auditCount(fixture.app, 'LOGIN_SUCCEEDED'), 1);
  } finally {
    try {
      writer.exec('ROLLBACK');
    } catch {
      // ignore
    }
    secondConnection.close();
    await fixture.close();
  }
});

test('V42-FR-06 E: logout DB failure -> 503, session still valid, no false clear-cookie', async () => {
  const fixture = createFixture();
  const secondConnection: DatabaseClient = createDatabase({
    databasePath: path.join(fixture.dir, 'test.db'),
  });
  const writer = secondConnection.sqlite;
  let lockHeld = false;
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_FcE', DEFAULT_TEST_PASSWORD);
    const session = await createAuthenticatedTestSession(
      fixture.app,
      'Admin_FcE',
      DEFAULT_TEST_PASSWORD,
    );

    const beforeSessions = sessionRows(fixture.app);

    const lock = {
      acquire: () => {
        writer.exec('BEGIN EXCLUSIVE');
        lockHeld = true;
      },
    };
    const state = { armed: true, fired: false };
    const authRepo = (fixture.app.services.auth as unknown as Record<string, unknown>)[
      'authRepo'
    ] as AdminAuthRepository;
    wrapWithRealLock(authRepo, 'logoutCurrentSession', lock, state);

    const res = await fixture.app.server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: session.cookieHeader,
        host: fixture.app.config.canonicalAuthority,
        origin: fixture.app.config.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'x-sparkkeeper-csrf': session.csrfToken,
      },
      payload: {},
    });

    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.equal(state.fired, true);
    assert.equal(res.headers['set-cookie'], undefined, 'no cookie-success semantics on failure');

    // Release the real lock before re-validating.
    writer.exec('ROLLBACK');
    lockHeld = false;

    // Session remains valid: /me succeeds.
    const me = await fixture.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: session.cookieHeader },
    });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(sessionRows(fixture.app), beforeSessions);
  } finally {
    if (lockHeld) {
      try {
        writer.exec('ROLLBACK');
      } catch {
        // ignore
      }
    }
    secondConnection.close();
    await fixture.close();
  }
});

test('V42-FR-06 F: session validation DB failure (closed DB) -> 503, protected handler=0', async () => {
  const fixture = createFixture();
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_FcF', DEFAULT_TEST_PASSWORD);
    const session = await createAuthenticatedTestSession(
      fixture.app,
      'Admin_FcF',
      DEFAULT_TEST_PASSWORD,
    );

    let handlerCalls = 0;
    const readService = fixture.app.services.read as unknown as {
      listAccounts: () => unknown;
    };
    const originalList = readService.listAccounts.bind(readService);
    (readService as Record<string, unknown>)['listAccounts'] = () => {
      handlerCalls += 1;
      return originalList();
    };

    // Real infrastructure failure: close the database before the request.
    fixture.app.database.close();

    const me = await fixture.app.server.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: session.cookieHeader },
    });
    assert.equal(me.statusCode, 503);
    assert.equal(JSON.parse(me.body).error.code, 'AUTH_SERVICE_UNAVAILABLE');

    const protectedRoute = await fixture.app.server.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { cookie: session.cookieHeader },
    });
    assert.equal(protectedRoute.statusCode, 503);
    assert.equal(JSON.parse(protectedRoute.body).error.code, 'AUTH_SERVICE_UNAVAILABLE');
    assert.equal(handlerCalls, 0, 'protected handler must not run');
  } finally {
    await fixture.app.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('V42-FR-06b: ordered two-connection races — touch vs revoke/disable/sessionVersion/expiry never yield stale VALID', async () => {
  const fixture = createFixture();
  const secondConnection: DatabaseClient = createDatabase({
    databasePath: path.join(fixture.dir, 'test.db'),
  });
  const writer = secondConnection.sqlite;
  try {
    const t0 = new Date('2026-09-01T12:00:00.000Z');
    await bootstrapTestAdmin(fixture.app, 'Admin_Race', DEFAULT_TEST_PASSWORD);
    const session = await createAuthenticatedTestSession(
      fixture.app,
      'Admin_Race',
      DEFAULT_TEST_PASSWORD,
    );
    const digestRow = fixture.app.database.sqlite
      .prepare('SELECT id, token_digest FROM admin_sessions ORDER BY rowid DESC LIMIT 1')
      .get() as { id: string; token_digest: string };
    const authRepo = (fixture.app.services.auth as unknown as Record<string, unknown>)[
      'authRepo'
    ] as AdminAuthRepository;

    const digest = digestRow.token_digest;
    const captured: string[] = [];

    // --- Race 1: revoke (conn2) commits while touch is locked out, then touch runs.
    writer.exec('BEGIN EXCLUSIVE');
    captured.push('conn2: writer lock acquired');
    writer
      .prepare("UPDATE admin_sessions SET revoked_at = ?, revoke_reason = 'LOGOUT' WHERE id = ?")
      .run(t0.getTime(), digestRow.id);
    captured.push('conn2: revoke committed under lock');
    let outcome: string;
    try {
      const result = authRepo.validateSession({ tokenDigest: digest, now: t0 });
      outcome = result.outcome;
    } catch (err) {
      outcome = (err as { code?: string }).code ?? 'THROWN';
    }
    assert.equal(outcome, 'INTEGRITY_ERROR', 'locked touch must fail closed with INTEGRITY_ERROR');
    captured.push(`conn1: touch attempt under lock -> ${outcome}`);
    writer.exec('ROLLBACK');
    // ROLLBACK undoes the revoke; re-apply it inside an explicit transaction.
    writer.exec('BEGIN EXCLUSIVE');
    writer
      .prepare("UPDATE admin_sessions SET revoked_at = ?, revoke_reason = 'LOGOUT' WHERE id = ?")
      .run(t0.getTime(), digestRow.id);
    writer.exec('COMMIT');
    captured.push('conn2: revoke committed after release');
    const afterRevoke = authRepo.validateSession({ tokenDigest: digest, now: t0 });
    assert.equal(afterRevoke.outcome, 'SESSION_REVOKED', 'never stale VALID after revoke');

    // --- Race 2: Admin disable.
    await createAuthenticatedTestSession(fixture.app, 'Admin_Race', DEFAULT_TEST_PASSWORD);
    const row2 = fixture.app.database.sqlite
      .prepare('SELECT id, token_digest FROM admin_sessions ORDER BY rowid DESC LIMIT 1')
      .get() as { id: string; token_digest: string };
    writer.exec('BEGIN EXCLUSIVE');
    writer.prepare("UPDATE admin_users SET status = 'DISABLED'").run();
    writer.exec('COMMIT');
    captured.push('conn2: admin disabled committed');
    const afterDisable = authRepo.validateSession({ tokenDigest: row2.token_digest, now: t0 });
    assert.equal(afterDisable.outcome, 'SESSION_REVOKED');

    // --- Race 3: sessionVersion increment (re-enable the admin first: the
    // disable race must not leak into the next scenario).
    fixture.app.database.sqlite.prepare("UPDATE admin_users SET status = 'ACTIVE'").run();
    await createAuthenticatedTestSession(fixture.app, 'Admin_Race', DEFAULT_TEST_PASSWORD);
    const row3 = fixture.app.database.sqlite
      .prepare('SELECT id, token_digest FROM admin_sessions ORDER BY rowid DESC LIMIT 1')
      .get() as { id: string; token_digest: string };
    writer.exec('BEGIN EXCLUSIVE');
    writer.prepare('UPDATE admin_users SET session_version = session_version + 1').run();
    writer.exec('COMMIT');
    captured.push('conn2: sessionVersion incremented');
    const afterVersion = authRepo.validateSession({ tokenDigest: row3.token_digest, now: t0 });
    assert.equal(afterVersion.outcome, 'SESSION_REVOKED');

    // --- Race 4: idle expiry ordered against touch.
    await createAuthenticatedTestSession(fixture.app, 'Admin_Race', DEFAULT_TEST_PASSWORD);
    const row4 = fixture.app.database.sqlite
      .prepare(
        'SELECT id, token_digest, idle_expires_at FROM admin_sessions ORDER BY rowid DESC LIMIT 1',
      )
      .get() as { id: string; token_digest: string; idle_expires_at: string };
    const idleDeadline = new Date(row4.idle_expires_at);
    captured.push(`conn2 state before expiry checks: sessions=${sessionRows(fixture.app).length}`);
    const atDeadline = authRepo.validateSession({
      tokenDigest: row4.token_digest,
      now: idleDeadline,
    });
    assert.equal(atDeadline.outcome, 'SESSION_EXPIRED', 'now == idle deadline is expired');
    const afterDeadline = authRepo.validateSession({
      tokenDigest: row4.token_digest,
      now: new Date(idleDeadline.getTime() + 1),
    });
    assert.equal(afterDeadline.outcome, 'SESSION_EXPIRED');
    void session;

    // --- Race 5: absolute expiry with frozen idle cap transition. A fresh
    // session gets its idle deadline backdated near the absolute deadline
    // (constraints preserved) so the touch cap is actually exercised.
    await createAuthenticatedTestSession(fixture.app, 'Admin_Race', DEFAULT_TEST_PASSWORD);
    const row5 = fixture.app.database.sqlite
      .prepare(
        'SELECT token_digest, absolute_expires_at FROM admin_sessions ORDER BY rowid DESC LIMIT 1',
      )
      .get() as { token_digest: string; absolute_expires_at: string };
    const absolute = new Date(row5.absolute_expires_at);
    fixture.app.database.sqlite
      .prepare(
        'UPDATE admin_sessions SET created_at = ?, reauthenticated_at = ?, last_seen_at = ?, idle_expires_at = ? WHERE token_digest = ?',
      )
      .run(
        absolute.getTime() - 10 * 60_000,
        absolute.getTime() - 10 * 60_000,
        absolute.getTime() - 10 * 60_000,
        absolute.getTime() - 30_000,
        row5.token_digest,
      );
    const nearAbsolute = new Date(absolute.getTime() - 60_000);
    const nearResult = authRepo.validateSession({
      tokenDigest: row5.token_digest,
      now: nearAbsolute,
    });
    assert.equal(nearResult.outcome, 'VALID');
    if (nearResult.outcome === 'VALID') {
      assert.equal(
        nearResult.session.idleExpiresAt.getTime(),
        absolute.getTime(),
        'idle capped exactly at absolute expiry',
      );
    }
    const atAbsolute = authRepo.validateSession({ tokenDigest: row5.token_digest, now: absolute });
    assert.equal(atAbsolute.outcome, 'SESSION_EXPIRED');

    assert.ok(captured.length >= 6, 'ordering markers captured');
  } finally {
    try {
      writer.exec('ROLLBACK');
    } catch {
      // ignore
    }
    secondConnection.close();
    await fixture.close();
  }
});

test('V42-FR-07 A: untrusted peer XFF cannot move the limiter IP bucket', async () => {
  const fixture = createFixture();
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_ProxyA', DEFAULT_TEST_PASSWORD);
    const observed: string[] = [];
    const rateLimiter = (fixture.app.services.auth as unknown as Record<string, unknown>)[
      'rateLimiter'
    ] as { checkAndReserve: (ip: string, u: string, n: Date) => unknown };
    const original = rateLimiter.checkAndReserve.bind(rateLimiter);
    rateLimiter.checkAndReserve = (ip: string, u: string, n: Date) => {
      // Observer records only; admission decisions stay with the real limiter.
      observed.push(ip);
      return original(ip, u, n);
    };

    const res = await loginInject(
      fixture.app,
      {
        username: 'Admin_ProxyA',
        password: DEFAULT_TEST_PASSWORD,
      },
      { 'x-forwarded-for': '203.0.113.99' },
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(observed, ['127.0.0.1'], 'limiter must use the actual peer IP');
  } finally {
    await fixture.close();
  }
});

test('V42-FR-07 B: trusted proxy resolves the intended client IP for the limiter', async () => {
  const fixture = createFixture({
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'production',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'https://sparkkeeper.example.com',
    SPARKKEEPER_ADMIN_TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
  });
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_ProxyB', DEFAULT_TEST_PASSWORD);
    const observed: string[] = [];
    const rateLimiter = (fixture.app.services.auth as unknown as Record<string, unknown>)[
      'rateLimiter'
    ] as { checkAndReserve: (ip: string, u: string, n: Date) => unknown };
    const original = rateLimiter.checkAndReserve.bind(rateLimiter);
    rateLimiter.checkAndReserve = (ip: string, u: string, n: Date) => {
      observed.push(ip);
      return original(ip, u, n);
    };

    const res = await fixture.app.server.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: 'sparkkeeper.example.com',
        origin: 'https://sparkkeeper.example.com',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.99',
        'x-forwarded-proto': 'https',
      },
      payload: { username: 'Admin_ProxyB', password: DEFAULT_TEST_PASSWORD },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(observed, ['203.0.113.99'], 'limiter reservation uses the intended client');
  } finally {
    await fixture.close();
  }
});

test('V42-FR-07 C: wildcard and zero trust-proxy forms remain rejected', async () => {
  const { validateTrustedProxyEntry, HttpConfigError } =
    await import('../src/http/config/HttpConfig.js');
  for (const entry of ['0.0.0.0', '0.0.0.0/0', '::', '::/0', '10.0.0.1/0']) {
    assert.throws(() => validateTrustedProxyEntry(entry), HttpConfigError);
  }
});

test('V42-FR-07b: duplicate session cookies leave session table byte-equivalent in both orders', async () => {
  const fixture = createFixture();
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_DupSnap', DEFAULT_TEST_PASSWORD);
    const session = await createAuthenticatedTestSession(
      fixture.app,
      'Admin_DupSnap',
      DEFAULT_TEST_PASSWORD,
    );

    let hasherCalls = 0;
    let validateCalls = 0;
    let finalizeCalls = 0;
    const authService = fixture.app.services.auth as unknown as Record<string, unknown>;
    const hasher = authService['hasher'] as {
      verify: (phc: string, p: string) => Promise<unknown>;
    };
    const originalVerify = hasher.verify.bind(hasher);
    hasher.verify = async (phc: string, p: string) => {
      hasherCalls += 1;
      return originalVerify(phc, p);
    };
    const authRepo = authService['authRepo'] as unknown as Record<string, unknown>;
    const originalValidate = (authRepo['validateSession'] as (...a: unknown[]) => unknown).bind(
      authRepo,
    );
    authRepo['validateSession'] = (...a: unknown[]) => {
      validateCalls += 1;
      return originalValidate(...a);
    };
    const originalComplete = (
      authRepo['completeAuthenticatedLogin'] as (...a: unknown[]) => unknown
    ).bind(authRepo);
    authRepo['completeAuthenticatedLogin'] = (...a: unknown[]) => {
      finalizeCalls += 1;
      return originalComplete(...a);
    };

    const beforeSessions = sessionRows(fixture.app);
    const beforeAdmins = adminRows(fixture.app);

    const cookieName = fixture.app.config.cookie.name;
    const cookieA = `${cookieName}=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`;
    const cookieB = `${cookieName}=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`;

    for (const cookieHeader of [`${cookieA}; ${cookieB}`, `${cookieB}; ${cookieA}`]) {
      const res = await loginInject(
        fixture.app,
        {
          username: 'Admin_DupSnap',
          password: DEFAULT_TEST_PASSWORD,
        },
        { cookie: cookieHeader },
      );
      assert.equal(res.statusCode, 401);
      assert.equal(JSON.parse(res.body).error.code, 'UNAUTHENTICATED');
    }

    assert.equal(hasherCalls, 0);
    assert.equal(validateCalls, 0);
    assert.equal(finalizeCalls, 0);
    assert.deepEqual(sessionRows(fixture.app), beforeSessions, 'no revoke/create/touch');
    assert.deepEqual(adminRows(fixture.app), beforeAdmins);
    assert.ok(session.cookieHeader);
  } finally {
    await fixture.close();
  }
});
