import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDatabase, AdminAuthRepository } from '@sparkkeeper/database';

import {
  Argon2WorkGate,
  LoginRateLimiter,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
} from '../src/security/LoginRateLimiter.js';
import {
  deriveCsrfToken,
  digestCsrfToken,
  digestRawSessionToken,
  generateSessionTokens,
  validateCsrfToken,
} from '../src/security/TokenUtils.js';
import { AdminSessionService } from '../src/security/AdminSessionService.js';
import { ApiError } from '../src/http/errors/ApiError.js';

test('TokenUtils: generates 256-bit tokens, derives CSRF, and verifies in constant time', () => {
  const generated = generateSessionTokens();
  assert.equal(generated.rawToken.length, 43);
  assert.equal(generated.rawBytes.length, 32);
  assert.equal(generated.tokenDigest.length, 64);
  assert.equal(generated.rawCsrfToken.length, 43);
  assert.equal(generated.csrfTokenDigest.length, 64);

  // Derived CSRF is reproducible from rawBytes
  const derived = deriveCsrfToken(generated.rawBytes);
  assert.equal(derived, generated.rawCsrfToken);
  assert.equal(digestCsrfToken(derived), generated.csrfTokenDigest);

  // Validation: matching CSRF token passes
  assert.equal(validateCsrfToken(generated.rawCsrfToken, generated.csrfTokenDigest), true);

  // Validation: wrong CSRF token fails
  assert.equal(validateCsrfToken('a'.repeat(43), generated.csrfTokenDigest), false);

  // Validation: malformed shape fails immediately
  assert.equal(validateCsrfToken('short', generated.csrfTokenDigest), false);
  assert.equal(validateCsrfToken(null, generated.csrfTokenDigest), false);

  // digestRawSessionToken
  const digested = digestRawSessionToken(generated.rawToken);
  assert.ok(digested !== null);
  assert.equal(digested.tokenDigest, generated.tokenDigest);

  // Malformed session tokens
  assert.equal(digestRawSessionToken('invalid_token'), null);
  assert.equal(digestRawSessionToken(''), null);
  assert.equal(digestRawSessionToken(123), null);
});

test('LoginRateLimiter: limits attempts per IP and username dimensions and computes Retry-After', () => {
  const limiter = new LoginRateLimiter();
  const t0 = new Date('2026-09-01T12:00:00.000Z');
  const ip1 = '192.168.1.100';
  const user1 = 'admin_user';

  // First 5 attempts succeed
  for (let i = 1; i <= RATE_LIMIT_MAX_ATTEMPTS; i++) {
    const res = limiter.checkAndReserve(ip1, user1, t0);
    assert.equal(res.allowed, true, `Attempt ${i} should be allowed`);
  }

  // 6th attempt is denied
  const res6 = limiter.checkAndReserve(ip1, user1, t0);
  assert.equal(res6.allowed, false);
  assert.ok(res6.retryAfterSeconds !== undefined && res6.retryAfterSeconds > 0);
  assert.equal(res6.retryAfterSeconds, 15 * 60); // 900 seconds

  // Another IP with different username is still allowed
  const resOther = limiter.checkAndReserve('192.168.1.200', 'other_user', t0);
  assert.equal(resOther.allowed, true);

  // Same blocked IP with different username is denied
  const resSameIp = limiter.checkAndReserve(ip1, 'other_user', t0);
  assert.equal(resSameIp.allowed, false);
  assert.equal(resSameIp.reason, 'IP_RATE_LIMITED');

  // Different IP with same blocked username is denied
  const resSameUser = limiter.checkAndReserve('192.168.1.201', user1, t0);
  assert.equal(resSameUser.allowed, false);
  assert.equal(resSameUser.reason, 'USERNAME_RATE_LIMITED');

  // Advancing time past window resets limits
  const tAfterWindow = new Date(t0.getTime() + RATE_LIMIT_WINDOW_MS + 1000);
  const resAfter = limiter.checkAndReserve(ip1, user1, tAfterWindow);
  assert.equal(resAfter.allowed, true);

  // recordSuccess clears both dimensions
  limiter.checkAndReserve(ip1, user1, tAfterWindow); // 2nd attempt
  limiter.recordSuccess(ip1, user1);
  assert.equal(limiter.totalEntries, 0);
});

function createLatch() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('Argon2WorkGate: bounds concurrency using explicit work latches with zero sleeps', async () => {
  const gate = new Argon2WorkGate(2, 8, 500); // 2 active, 8 queued, 500ms timeout
  assert.equal(gate.maxActive, 2);
  assert.equal(gate.maxQueued, 8);

  const latch1Started = createLatch();
  const latch1Hold = createLatch();
  const latch2Started = createLatch();
  const latch2Hold = createLatch();

  // 1. Start work 1 -> latch confirms active
  const p1 = gate.withGate(async () => {
    latch1Started.resolve();
    await latch1Hold.promise;
    return 'result-1';
  });
  await latch1Started.promise;
  assert.equal(gate.currentActive, 1);
  assert.equal(gate.currentQueued, 0);

  // 2. Start work 2 -> latch confirms active
  const p2 = gate.withGate(async () => {
    latch2Started.resolve();
    await latch2Hold.promise;
    return 'result-2';
  });
  await latch2Started.promise;
  assert.equal(gate.currentActive, 2);
  assert.equal(gate.currentQueued, 0);

  // 3. Queue up 8 items
  const queuedLatches = Array.from({ length: 8 }, () => ({
    started: createLatch(),
    hold: createLatch(),
  }));

  const queuedPromises = queuedLatches.map((latches, idx) =>
    gate.withGate(async () => {
      latches.started.resolve();
      await latches.hold.promise;
      return `queued-${idx}`;
    }),
  );

  assert.equal(gate.currentActive, 2);
  assert.equal(gate.currentQueued, 8);

  // 4. 11th task immediately rejects with Argon2WorkGateError (capacity reached)
  await assert.rejects(
    async () => {
      await gate.withGate(async () => {});
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'Argon2WorkGateError');
      return true;
    },
  );

  // 5. Release work 1 -> first queued item enters active execution
  latch1Hold.resolve();
  const res1 = await p1;
  assert.equal(res1, 'result-1');

  // Wait for queued item 0 to start
  await queuedLatches[0]!.started.promise;
  assert.equal(gate.currentActive, 2);
  assert.equal(gate.currentQueued, 7);

  // Release work 2
  latch2Hold.resolve();
  const res2 = await p2;
  assert.equal(res2, 'result-2');

  // Wait for queued item 1 to start
  await queuedLatches[1]!.started.promise;
  assert.equal(gate.currentActive, 2);
  assert.equal(gate.currentQueued, 6);

  // Release remaining queued tasks
  for (let i = 0; i < 8; i++) {
    queuedLatches[i]!.hold.resolve();
  }

  const queuedResults = await Promise.all(queuedPromises);
  assert.equal(queuedResults.length, 8);
  assert.equal(gate.currentActive, 0);
  assert.equal(gate.currentQueued, 0);

  // 6. Force one work throw -> lease released cleanly
  await assert.rejects(
    async () => {
      await gate.withGate(async () => {
        throw new Error('Simulated native error');
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'Simulated native error');
      return true;
    },
  );
  assert.equal(gate.currentActive, 0);
  assert.equal(gate.currentQueued, 0);
});

test('AdminSessionService: validates recent-auth guard', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-recent-auth-test-'));
  const dbPath = path.join(dir, 'test.db');
  const client = createDatabase({ databasePath: dbPath });
  client.migrate();
  const repo = new AdminAuthRepository(client);
  const sessionService = new AdminSessionService(repo);

  try {
    const t0 = new Date('2026-09-01T12:00:00.000Z');

    // Valid within 5 minutes
    const t4m = new Date(t0.getTime() + 4 * 60 * 1000);
    assert.doesNotThrow(() => {
      sessionService.requireRecentAuthentication(t0, t4m);
    });

    // Exact 5m boundary: valid
    const t5m = new Date(t0.getTime() + 5 * 60 * 1000);
    assert.doesNotThrow(() => {
      sessionService.requireRecentAuthentication(t0, t5m);
    });

    // +1 ms: 403 REAUTH_REQUIRED
    const t5mPlus1 = new Date(t0.getTime() + 5 * 60 * 1000 + 1);
    assert.throws(
      () => sessionService.requireRecentAuthentication(t0, t5mPlus1),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'REAUTH_REQUIRED');
        return true;
      },
    );

    // Null reauthenticatedAt: 403 REAUTH_REQUIRED
    assert.throws(
      () => sessionService.requireRecentAuthentication(null, t0),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.statusCode, 403);
        assert.equal(err.code, 'REAUTH_REQUIRED');
        return true;
      },
    );
  } finally {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
