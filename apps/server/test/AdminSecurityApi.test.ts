import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, AdminSecurityRepository, AdminSecurityError } from '@sparkkeeper/database';
import { createApiApplication } from '../src/http/ApiApplication.js';
import { PasswordHasher, parsePhcString } from '../src/security/PasswordHasher.js';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import {
  createAuthenticatedTestSession,
  injectAuthenticated,
  DEFAULT_TEST_PASSWORD,
} from './authFixture.js';
async function fixture(
  fn: (
    app: ReturnType<typeof createApiApplication>,
    dbPath: string,
    clock: { now: Date },
  ) => Promise<void>,
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-security-')),
    dbPath = path.join(dir, 'fixture.db');
  const clock = { now: new Date() };
  const app = createApiApplication({
    databasePath: dbPath,
    logger: false,
    clock: () => clock.now,
    environment: {
      DATA_DIR: dir,
      HOST: '127.0.0.1',
      PORT: '8080',
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    },
  });
  try {
    await fn(app, dbPath, clock);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
test('security: reauth renews only freshness; old credential proof cannot publish after revocation', () =>
  fixture(async (app, dbPath, clock) => {
    const session = await createAuthenticatedTestSession(app);
    const before = (await injectAuthenticated(app, session, { url: '/api/auth/sessions' })).json()
      .data;
    const current = before.find((r: { current: boolean }) => r.current);
    clock.now = new Date(clock.now.getTime() + 301_000);
    const reauth = await injectAuthenticated(app, session, {
      method: 'POST',
      url: '/api/auth/reauth',
      payload: { password: DEFAULT_TEST_PASSWORD },
    });
    assert.equal(reauth.statusCode, 200);
    assert.equal(reauth.headers['set-cookie'], undefined);
    const after = (await injectAuthenticated(app, session, { url: '/api/auth/sessions' })).json()
      .data;
    assert.equal(after.length, before.length);
    assert.equal(after[0].absoluteExpiresAt, current.absoluteExpiresAt);
    assert.ok(!JSON.stringify(after).match(/passwordHash|csrf|digest|token|ipAddress|userAgent/iu));
    const client = createDatabase({ databasePath: dbPath }),
      repo = new AdminSecurityRepository(client);
    try {
      const proof = repo.proof(session.adminId, current.id, clock.now);
      const revoke = await injectAuthenticated(app, session, {
        method: 'POST',
        url: `/api/auth/sessions/${current.id}/revoke`,
        payload: { expectedSessionVersion: current.sessionVersion },
      });
      assert.equal(revoke.statusCode, 204);
      assert.throws(() => repo.reauthenticate(proof, clock.now), AdminSecurityError);
      assert.equal(
        (await injectAuthenticated(app, session, { url: '/api/auth/me' })).statusCode,
        401,
      );
    } finally {
      client.close();
    }
  }));
test('security: password change is recent/CSRF protected and atomically invalidates every session', () =>
  fixture(async (app, _db, clock) => {
    const first = await createAuthenticatedTestSession(app),
      second = await createAuthenticatedTestSession(app);
    const next = ['Replacement', 'Fixture', '123', '!'].join('');
    clock.now = new Date(clock.now.getTime() + 301_000);
    const body = { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: next };
    assert.equal(
      (
        await injectAuthenticated(app, first, {
          method: 'POST',
          url: '/api/auth/change-password',
          payload: body,
        })
      ).json().error.code,
      'REAUTH_REQUIRED',
    );
    assert.equal(
      (
        await injectAuthenticated(app, first, {
          method: 'POST',
          url: '/api/auth/reauth',
          headers: { 'x-sparkkeeper-csrf': 'invalid' },
          payload: { password: DEFAULT_TEST_PASSWORD },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await injectAuthenticated(app, first, {
          method: 'POST',
          url: '/api/auth/reauth',
          payload: { password: DEFAULT_TEST_PASSWORD },
        })
      ).statusCode,
      200,
    );
    const changed = await injectAuthenticated(app, first, {
      method: 'POST',
      url: '/api/auth/change-password',
      payload: body,
    });
    assert.equal(changed.statusCode, 204);
    for (const s of [first, second])
      assert.equal((await injectAuthenticated(app, s, { url: '/api/accounts' })).statusCode, 401);
    const login = (password: string) =>
      app.server.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: {
          host: app.config.canonicalAuthority,
          origin: app.config.canonicalOrigin,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/json',
        },
        payload: { username: first.username, password },
      });
    assert.equal((await login(DEFAULT_TEST_PASSWORD)).statusCode, 401);
    assert.equal((await login(next)).statusCode, 200);
  }));
test('security: revoke enforces optimistic version and no credential mutation on conflict', () =>
  fixture(async (app) => {
    const s = await createAuthenticatedTestSession(app);
    const current = (await injectAuthenticated(app, s, { url: '/api/auth/sessions' })).json()
      .data[0];
    assert.equal(
      (
        await injectAuthenticated(app, s, {
          method: 'POST',
          url: `/api/auth/sessions/${current.id}/revoke`,
          payload: { expectedSessionVersion: current.sessionVersion + 1 },
        })
      ).statusCode,
      409,
    );
    assert.equal((await injectAuthenticated(app, s, { url: '/api/auth/me' })).statusCode, 200);
    assert.equal(
      (
        await injectAuthenticated(app, s, {
          method: 'POST',
          url: '/api/auth/reauth',
          payload: { password: ['Incorrect', 'Fixture', '123', '!'].join('') },
        })
      ).statusCode,
      401,
    );
    assert.equal((await injectAuthenticated(app, s, { url: '/api/auth/me' })).statusCode, 200);
  }));
test('security: replacement password retains stronger stored Argon2 dimensions', async () => {
  const hasher = new PasswordHasher();
  const initial = await hasher.hash(DEFAULT_TEST_PASSWORD);
  const stronger = initial.replace('m=19456,t=2,p=1', 'm=32768,t=3,p=2');
  const next = await hasher.hash(DEFAULT_TEST_PASSWORD, stronger),
    parsed = parsePhcString(next)!;
  assert.equal(parsed.memoryCost, 32768);
  assert.equal(parsed.timeCost, 3);
  assert.equal(parsed.parallelism, 2);
  assert.equal((await hasher.verify(next, DEFAULT_TEST_PASSWORD)).outcome, 'MATCH');
});
test('security: upward rehash preserves each stronger dimension of mixed-cost PHC', async () => {
  const native = await argon2.hash(DEFAULT_TEST_PASSWORD, {
    type: argon2.argon2id,
    version: 0x13,
    salt: randomBytes(16),
    hashLength: 32,
    memoryCost: 32768,
    timeCost: 1,
    parallelism: 2,
  });
  const parts = native.split('$');
  const original = `$argon2id$v=19$m=32768,t=1,p=2$${parts[4]}$${parts[5]}`;
  const result = await new PasswordHasher().verify(original, DEFAULT_TEST_PASSWORD);
  assert.equal(result.outcome, 'MATCH_REHASH_NEEDED');
  const parsed = parsePhcString(result.newHash!)!;
  assert.equal(parsed.memoryCost, 32768);
  assert.equal(parsed.timeCost, 2);
  assert.equal(parsed.parallelism, 2);
});
