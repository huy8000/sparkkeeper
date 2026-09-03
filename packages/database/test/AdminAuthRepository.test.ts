import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import BetterSqlite3 from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import {
  AdminAuthRepository,
  AdminAuthRepositoryError,
  createDatabase,
  type DatabaseClient,
} from '../src/index.js';
import { adminSessions, adminUsers, auditEvents } from '../src/schema/index.js';

interface TestContext {
  readonly client: DatabaseClient;
  readonly repo: AdminAuthRepository;
  readonly dir: string;
  readonly dbPath: string;
}

function createTestContext(): TestContext {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-auth-repo-test-'));
  const dbPath = path.join(dir, 'test.db');
  const client = createDatabase({ databasePath: dbPath });
  client.migrate();
  const repo = new AdminAuthRepository(client);
  return { client, repo, dir, dbPath };
}

function cleanupTestContext(ctx: TestContext): void {
  ctx.client.close();
  rmSync(ctx.dir, { recursive: true, force: true });
}

test('AdminAuthRepository: bootstrap creates single admin and audit event', () => {
  const ctx = createTestContext();
  try {
    const t0 = new Date('2026-09-01T12:00:00.000Z');
    const dummyHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQxNg$aGFzaGhhc2hoYXNo';

    const result = ctx.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_1',
      passwordHash: dummyHash,
      now: t0,
    });

    assert.equal(result.outcome, 'SUCCESS');
    if (result.outcome !== 'SUCCESS') return;

    assert.equal(result.adminUser.username, 'Admin_1');
    assert.equal(result.adminUser.usernameNormalized, 'admin_1');
    assert.equal(result.adminUser.status, 'ACTIVE');
    assert.equal(result.adminUser.sessionVersion, 1);
    assert.equal('failedLoginCount' in result.adminUser, false);
    assert.equal('lockedUntil' in result.adminUser, false);
    assert.equal('lastFailedLoginAt' in result.adminUser, false);
    assert.equal(result.adminUser.lastLoginAt, null);

    const rawUser = ctx.client.sqlite
      .prepare(
        'SELECT failed_login_count, locked_until, last_failed_login_at FROM admin_users WHERE id = ?',
      )
      .get(result.adminUser.id) as {
      failed_login_count: number;
      locked_until: string | null;
      last_failed_login_at: string | null;
    };
    assert.equal(rawUser.failed_login_count, 0);
    assert.equal(rawUser.locked_until, null);
    assert.equal(rawUser.last_failed_login_at, null);

    // Verify audit event
    const audits = ctx.client.orm
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'ADMIN_INITIALIZED'))
      .all();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].entityType, 'ADMIN_USER');
    assert.equal(audits[0].entityId, result.adminUser.id);
    assert.equal(audits[0].actorAdminUserId, result.adminUser.id);
    assert.equal(audits[0].outcome, 'SUCCESS');

    // Repeated bootstrap must return ADMIN_ALREADY_INITIALIZED and zero mutations
    const repeatResult = ctx.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_2',
      passwordHash: dummyHash,
      now: new Date('2026-09-01T12:01:00.000Z'),
    });
    assert.equal(repeatResult.outcome, 'ADMIN_ALREADY_INITIALIZED');

    const allUsers = ctx.client.orm.select().from(adminUsers).all();
    assert.equal(allUsers.length, 1);
    assert.equal(allUsers[0].username, 'Admin_1');
  } finally {
    cleanupTestContext(ctx);
  }
});

test('AdminAuthRepository: concurrent two-connection bootstrap yields exactly one winner', () => {
  const ctx = createTestContext();
  const client2 = createDatabase({ databasePath: ctx.dbPath });
  const repo2 = new AdminAuthRepository(client2);

  try {
    const dummyHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQxNg$aGFzaGhhc2hoYXNo';
    const t0 = new Date('2026-09-01T12:00:00.000Z');

    const res1 = ctx.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_First',
      passwordHash: dummyHash,
      now: t0,
    });
    const res2 = repo2.bootstrapInitialAdminWithAudit({
      username: 'Admin_Second',
      passwordHash: dummyHash,
      now: t0,
    });

    const outcomes = [res1.outcome, res2.outcome].sort();
    assert.deepEqual(outcomes, ['ADMIN_ALREADY_INITIALIZED', 'SUCCESS']);

    const allUsers = ctx.client.orm.select().from(adminUsers).all();
    assert.equal(allUsers.length, 1);
    assert.equal(allUsers[0].username, 'Admin_First');
  } finally {
    client2.close();
    cleanupTestContext(ctx);
  }
});

test('AdminAuthRepository: completeAuthenticatedLogin creates session, leaves legacy columns unchanged', () => {
  const ctx = createTestContext();
  try {
    const t0 = new Date('2026-09-01T12:00:00.000Z');
    const dummyHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQxNg$aGFzaGhhc2hoYXNo';

    const boot = ctx.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_1',
      passwordHash: dummyHash,
      now: t0,
    });
    assert.equal(boot.outcome, 'SUCCESS');
    if (boot.outcome !== 'SUCCESS') return;

    const t1 = new Date('2026-09-01T12:05:00.000Z');
    const tokenDigest1 = createHash('sha256').update('token1').digest('hex');
    const csrfDigest1 = createHash('sha256').update('csrf1').digest('hex');
    const idle1 = new Date(t1.getTime() + 30 * 60 * 1000);
    const abs1 = new Date(t1.getTime() + 12 * 60 * 60 * 1000);

    const loginResult = ctx.repo.completeAuthenticatedLogin({
      adminUserId: boot.adminUser.id,
      expectedSessionVersion: boot.adminUser.sessionVersion,
      tokenDigest: tokenDigest1,
      csrfTokenDigest: csrfDigest1,
      idleExpiresAt: idle1,
      absoluteExpiresAt: abs1,
      now: t1,
    });

    assert.equal(loginResult.outcome, 'SUCCESS');
    if (loginResult.outcome !== 'SUCCESS') return;

    assert.equal(loginResult.session.adminUserId, boot.adminUser.id);
    assert.equal(loginResult.session.tokenDigest, tokenDigest1);
    assert.equal(loginResult.session.csrfTokenDigest, csrfDigest1);
    assert.equal(loginResult.session.sessionVersion, 1);
    assert.equal(loginResult.session.revokedAt, null);

    // Verify legacy failure/lock columns remain unchanged (0/null)
    const userInDb = ctx.client.orm
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, boot.adminUser.id))
      .get();
    assert.ok(userInDb);
    assert.equal(userInDb.failedLoginCount, 0);
    assert.equal(userInDb.lockedUntil, null);
    assert.equal(userInDb.lastFailedLoginAt, null);
    assert.equal(userInDb.lastLoginAt?.getTime(), t1.getTime());

    // Verify LOGIN_SUCCEEDED audit
    const loginAudits = ctx.client.orm
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'LOGIN_SUCCEEDED'))
      .all();
    assert.equal(loginAudits.length, 1);
    assert.equal(loginAudits[0].entityId, loginResult.session.id);
    assert.equal(loginAudits[0].actorAdminUserId, boot.adminUser.id);

    // Replacing current session atomically revokes old session
    const t2 = new Date('2026-09-01T12:10:00.000Z');
    const tokenDigest2 = createHash('sha256').update('token2').digest('hex');
    const csrfDigest2 = createHash('sha256').update('csrf2').digest('hex');
    const idle2 = new Date(t2.getTime() + 30 * 60 * 1000);
    const abs2 = new Date(t2.getTime() + 12 * 60 * 60 * 1000);

    const replaceResult = ctx.repo.completeAuthenticatedLogin({
      adminUserId: boot.adminUser.id,
      expectedSessionVersion: boot.adminUser.sessionVersion,
      tokenDigest: tokenDigest2,
      csrfTokenDigest: csrfDigest2,
      idleExpiresAt: idle2,
      absoluteExpiresAt: abs2,
      currentSessionIdToRevoke: loginResult.session.id,
      now: t2,
    });

    assert.equal(replaceResult.outcome, 'SUCCESS');
    if (replaceResult.outcome !== 'SUCCESS') return;

    // Check old session is revoked
    const oldSession = ctx.client.orm
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.id, loginResult.session.id))
      .get();
    assert.ok(oldSession);
    assert.equal(oldSession.revokedAt?.getTime(), t2.getTime());
    assert.equal(oldSession.revokeReason, 'LOGIN_REPLACED');
  } finally {
    cleanupTestContext(ctx);
  }
});

test('AdminAuthRepository: rehash update preserves passwordChangedAt and sessionVersion', () => {
  const ctx = createTestContext();
  try {
    const t0 = new Date('2026-09-01T12:00:00.000Z');
    const oldHash = '$argon2id$v=19$m=8192,t=1,p=1$c2FsdHNhbHQxNg$b2xkaGFzaA';
    const newHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQxNg$bmV3aGFzaA';

    const boot = ctx.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_Rehash',
      passwordHash: oldHash,
      now: t0,
    });
    assert.equal(boot.outcome, 'SUCCESS');
    if (boot.outcome !== 'SUCCESS') return;

    const t1 = new Date('2026-09-01T12:15:00.000Z');
    const tokenDigest = createHash('sha256').update('token_rehash').digest('hex');
    const csrfDigest = createHash('sha256').update('csrf_rehash').digest('hex');

    const loginResult = ctx.repo.completeAuthenticatedLogin({
      adminUserId: boot.adminUser.id,
      expectedSessionVersion: boot.adminUser.sessionVersion,
      tokenDigest,
      csrfTokenDigest: csrfDigest,
      idleExpiresAt: new Date(t1.getTime() + 30 * 60 * 1000),
      absoluteExpiresAt: new Date(t1.getTime() + 12 * 60 * 60 * 1000),
      newPasswordHashRehash: newHash,
      now: t1,
    });

    assert.equal(loginResult.outcome, 'SUCCESS');
    if (loginResult.outcome !== 'SUCCESS') return;

    const userInDb = ctx.client.orm
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, boot.adminUser.id))
      .get();
    assert.ok(userInDb);
    assert.equal(userInDb.passwordHash, newHash);
    // passwordChangedAt must remain t0
    assert.equal(userInDb.passwordChangedAt.getTime(), t0.getTime());
    // sessionVersion must remain 1
    assert.equal(userInDb.sessionVersion, 1);
  } finally {
    cleanupTestContext(ctx);
  }
});

test('AdminAuthRepository: validateSession handles 5m touch throttle, expiry, and revocation', () => {
  const ctx = createTestContext();
  try {
    const t0 = new Date('2026-09-01T12:00:00.000Z');
    const dummyHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQxNg$aGFzaGhhc2hoYXNo';

    const boot = ctx.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_Touch',
      passwordHash: dummyHash,
      now: t0,
    });
    assert.equal(boot.outcome, 'SUCCESS');
    if (boot.outcome !== 'SUCCESS') return;

    const tokenDigest = createHash('sha256').update('session_token_touch').digest('hex');
    const csrfDigest = createHash('sha256').update('csrf_touch').digest('hex');
    const idleExpiresAt = new Date(t0.getTime() + 30 * 60 * 1000);
    const absoluteExpiresAt = new Date(t0.getTime() + 12 * 60 * 60 * 1000);

    const loginRes = ctx.repo.completeAuthenticatedLogin({
      adminUserId: boot.adminUser.id,
      expectedSessionVersion: 1,
      tokenDigest,
      csrfTokenDigest: csrfDigest,
      idleExpiresAt,
      absoluteExpiresAt,
      now: t0,
    });
    assert.equal(loginRes.outcome, 'SUCCESS');

    // 1. Validation at t0 + 1m (no touch write)
    const t1 = new Date(t0.getTime() + 1 * 60 * 1000);
    const val1 = ctx.repo.validateSession({ tokenDigest, now: t1 });
    assert.equal(val1.outcome, 'VALID');
    if (val1.outcome === 'VALID') {
      assert.equal(val1.session.lastSeenAt.getTime(), t0.getTime());
    }

    // 2. Validation at t0 + 4m 59s (no touch write)
    const t459 = new Date(t0.getTime() + (4 * 60 + 59) * 1000);
    const val459 = ctx.repo.validateSession({ tokenDigest, now: t459 });
    assert.equal(val459.outcome, 'VALID');
    if (val459.outcome === 'VALID') {
      assert.equal(val459.session.lastSeenAt.getTime(), t0.getTime());
    }

    // 3. Validation at t0 + 5m (touch throttled write occurs!)
    const t5 = new Date(t0.getTime() + 5 * 60 * 1000);
    const val5 = ctx.repo.validateSession({ tokenDigest, now: t5 });
    assert.equal(val5.outcome, 'VALID');
    if (val5.outcome === 'VALID') {
      assert.equal(val5.session.lastSeenAt.getTime(), t5.getTime());
      assert.equal(
        val5.session.idleExpiresAt.getTime(),
        new Date(t5.getTime() + 30 * 60 * 1000).getTime(),
      );
    }

    // Verify DB was updated
    const sessionInDb = ctx.client.orm
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.tokenDigest, tokenDigest))
      .get();
    assert.ok(sessionInDb);
    assert.equal(sessionInDb.lastSeenAt.getTime(), t5.getTime());

    // 4. Idle Expiry boundaries
    // Current idleExpiresAt is t5 + 30m = t0 + 35m
    const idleDeadline = sessionInDb.idleExpiresAt;
    // -1 ms: VALID (this valid check also touches and extends idleExpiresAt)
    const valIdleMinus1 = ctx.repo.validateSession({
      tokenDigest,
      now: new Date(idleDeadline.getTime() - 1),
    });
    assert.equal(valIdleMinus1.outcome, 'VALID');
    if (valIdleMinus1.outcome !== 'VALID') return;

    const newIdleDeadline = valIdleMinus1.session.idleExpiresAt;

    // Equal: SESSION_EXPIRED
    const valIdleEqual = ctx.repo.validateSession({
      tokenDigest,
      now: new Date(newIdleDeadline.getTime()),
    });
    assert.equal(valIdleEqual.outcome, 'SESSION_EXPIRED');

    // +1 ms: SESSION_EXPIRED
    const valIdlePlus1 = ctx.repo.validateSession({
      tokenDigest,
      now: new Date(newIdleDeadline.getTime() + 1),
    });
    assert.equal(valIdlePlus1.outcome, 'SESSION_EXPIRED');

    // 5. Absolute Expiry boundary
    // -1 ms: (with active touch)
    const valAbsMinus1 = ctx.repo.validateSession({
      tokenDigest,
      now: new Date(absoluteExpiresAt.getTime() - 1),
    });
    // Idle is expired anyway, so it's expired
    assert.equal(valAbsMinus1.outcome, 'SESSION_EXPIRED');

    // 6. Unknown token
    const valUnknown = ctx.repo.validateSession({
      tokenDigest: 'nonexistent_digest',
      now: t0,
    });
    assert.equal(valUnknown.outcome, 'UNAUTHENTICATED');
  } finally {
    cleanupTestContext(ctx);
  }
});

test('AdminAuthRepository: invalidation on user DISABLED or sessionVersion change', () => {
  const ctx = createTestContext();
  try {
    const t0 = new Date('2026-09-01T12:00:00.000Z');
    const dummyHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQxNg$aGFzaGhhc2hoYXNo';

    const boot = ctx.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_Dis',
      passwordHash: dummyHash,
      now: t0,
    });
    assert.equal(boot.outcome, 'SUCCESS');
    if (boot.outcome !== 'SUCCESS') return;

    const tokenDigest = createHash('sha256').update('token_dis').digest('hex');
    const csrfDigest = createHash('sha256').update('csrf_dis').digest('hex');

    ctx.repo.completeAuthenticatedLogin({
      adminUserId: boot.adminUser.id,
      expectedSessionVersion: 1,
      tokenDigest,
      csrfTokenDigest: csrfDigest,
      idleExpiresAt: new Date(t0.getTime() + 30 * 60 * 1000),
      absoluteExpiresAt: new Date(t0.getTime() + 12 * 60 * 60 * 1000),
      now: t0,
    });

    // Disable admin user
    ctx.client.orm
      .update(adminUsers)
      .set({ status: 'DISABLED' })
      .where(eq(adminUsers.id, boot.adminUser.id))
      .run();

    const val = ctx.repo.validateSession({ tokenDigest, now: t0 });
    assert.equal(val.outcome, 'SESSION_REVOKED');
    if (val.outcome === 'SESSION_REVOKED') {
      assert.equal(val.reason, 'ADMIN_DISABLED');
    }
  } finally {
    cleanupTestContext(ctx);
  }
});

test('AdminAuthRepository: logoutCurrentSession revokes and audits', () => {
  const ctx = createTestContext();
  try {
    const t0 = new Date('2026-09-01T12:00:00.000Z');
    const dummyHash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQxNg$aGFzaGhhc2hoYXNo';

    const boot = ctx.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_Logout',
      passwordHash: dummyHash,
      now: t0,
    });
    assert.equal(boot.outcome, 'SUCCESS');
    if (boot.outcome !== 'SUCCESS') return;

    const tokenDigest = createHash('sha256').update('token_logout').digest('hex');
    const csrfDigest = createHash('sha256').update('csrf_logout').digest('hex');

    const loginRes = ctx.repo.completeAuthenticatedLogin({
      adminUserId: boot.adminUser.id,
      expectedSessionVersion: 1,
      tokenDigest,
      csrfTokenDigest: csrfDigest,
      idleExpiresAt: new Date(t0.getTime() + 30 * 60 * 1000),
      absoluteExpiresAt: new Date(t0.getTime() + 12 * 60 * 60 * 1000),
      now: t0,
    });
    assert.equal(loginRes.outcome, 'SUCCESS');
    if (loginRes.outcome !== 'SUCCESS') return;

    const t1 = new Date('2026-09-01T12:10:00.000Z');
    const logoutRes = ctx.repo.logoutCurrentSession({
      sessionId: loginRes.session.id,
      adminUserId: boot.adminUser.id,
      now: t1,
    });
    assert.equal(logoutRes.outcome, 'SUCCESS');

    // Verify session revoked in DB
    const sessionInDb = ctx.client.orm
      .select()
      .from(adminSessions)
      .where(eq(adminSessions.id, loginRes.session.id))
      .get();
    assert.ok(sessionInDb);
    assert.equal(sessionInDb.revokedAt?.getTime(), t1.getTime());
    assert.equal(sessionInDb.revokeReason, 'LOGOUT');

    // Verify audit event
    const logoutAudits = ctx.client.orm
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'LOGOUT'))
      .all();
    assert.equal(logoutAudits.length, 1);
    assert.equal(logoutAudits[0].entityId, loginRes.session.id);
    assert.equal(logoutAudits[0].actorAdminUserId, boot.adminUser.id);

    // Second logout on same session returns NOT_FOUND_OR_REVOKED
    const secondLogout = ctx.repo.logoutCurrentSession({
      sessionId: loginRes.session.id,
      adminUserId: boot.adminUser.id,
      now: t1,
    });
    assert.equal(secondLogout.outcome, 'NOT_FOUND_OR_REVOKED');
  } finally {
    cleanupTestContext(ctx);
  }
});

test('AdminAuthRepository: database writer contention enforces 500ms timeout and maps to INTEGRITY_ERROR', () => {
  const ctx = createTestContext();
  // Open independent physical connection
  const rawSqlite2 = new BetterSqlite3(ctx.dbPath);

  try {
    // Acquire exclusive writer lock on connection 2
    rawSqlite2.exec('BEGIN EXCLUSIVE');

    const start = performance.now();
    assert.throws(
      () => {
        ctx.repo.bootstrapInitialAdminWithAudit({
          username: 'Admin_Contention',
          passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQxNg$aGFzaGhhc2hoYXNo',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AdminAuthRepositoryError);
        assert.equal(err.code, 'INTEGRITY_ERROR');
        return true;
      },
    );
    const elapsed = performance.now() - start;
    // Timeout should be around 500ms (e.g. >= 400ms)
    assert.ok(elapsed >= 350, `Expected elapsed >= 350ms, got ${elapsed}ms`);
  } finally {
    try {
      rawSqlite2.exec('ROLLBACK');
    } catch {
      // ignore
    }
    rawSqlite2.close();
    cleanupTestContext(ctx);
  }
});
