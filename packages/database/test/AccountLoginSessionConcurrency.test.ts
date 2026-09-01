import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import BetterSqlite3 from 'better-sqlite3';

import { createDatabase } from '../src/client/DatabaseClient.js';
import {
  clearAccountLoginSessionContentionProbeForTest,
  installAccountLoginSessionContentionProbeForTest,
} from '../src/internal/contentionProbe.js';
import { getInternalSqliteDriverForTest } from '../src/internal/testConnection.js';
import {
  AccountLoginSessionRepository,
  AccountLoginSessionRepositoryError,
  LOGIN_SESSION_CONTENTION_DEADLINE_MS,
  type AccountLoginSession,
} from '../src/repositories/AccountLoginSessionRepository.js';
import { AccountRepository } from '../src/repositories/AccountRepository.js';
import { AdminUserRepository } from '../src/repositories/AdminUserRepository.js';

type WorkerPayload =
  | {
      role: 'login_creator';
      databasePath: string;
      input: {
        purpose: 'ADD_ACCOUNT' | 'RELOGIN';
        accountId?: string | null;
        pendingAccountId?: string | null;
        createdByAdminUserId: string;
        expiresAt: number;
      };
      startBarrierBuffer?: SharedArrayBuffer;
      contentionProbeBuffer?: SharedArrayBuffer;
    }
  | {
      role: 'two_phase_unrelated_writer';
      databasePath: string;
      releaseSignalBuffer: SharedArrayBuffer;
    };

if (!isMainThread) {
  const payload = workerData as WorkerPayload;

  if (payload.role === 'login_creator') {
    let contentionProbe: Int32Array | undefined;
    if (payload.contentionProbeBuffer) {
      contentionProbe = new Int32Array(payload.contentionProbeBuffer);
      installAccountLoginSessionContentionProbeForTest(contentionProbe);
    }

    const client = createDatabase({ databasePath: payload.databasePath });
    const repo = new AccountLoginSessionRepository(client);

    try {
      parentPort!.postMessage({ type: 'creator-ready' });

      // Wait on start barrier until released by main thread
      if (payload.startBarrierBuffer) {
        const barrier = new Int32Array(payload.startBarrierBuffer);
        Atomics.wait(barrier, 0, 0);
      }

      const repoCreateStartedAt = performance.now();
      parentPort!.postMessage({ type: 'creator-entering-create' });

      let session: AccountLoginSession | undefined;
      let repoError: unknown;

      try {
        session = repo.create({
          ...payload.input,
          expiresAt: new Date(payload.input.expiresAt),
        });
      } catch (err) {
        repoError = err;
      } finally {
        const repoCreateElapsedMs = performance.now() - repoCreateStartedAt;
        const contentionObservedCount = contentionProbe ? Atomics.load(contentionProbe, 0) : 0;

        if (session) {
          parentPort!.postMessage({
            type: 'success',
            session,
            repoCreateElapsedMs,
            contentionObservedCount,
          });
        } else if (repoError instanceof AccountLoginSessionRepositoryError) {
          parentPort!.postMessage({
            type: repoError.code === 'CONFLICT' ? 'conflict' : 'repository_error',
            code: repoError.code,
            message: repoError.message,
            repoCreateElapsedMs,
            contentionObservedCount,
          });
        } else {
          parentPort!.postMessage({
            type: 'unexpected_error',
            error: String(repoError),
            repoCreateElapsedMs,
            contentionObservedCount,
          });
        }
      }
    } finally {
      clearAccountLoginSessionContentionProbeForTest();
      client.close();
    }
  } else if (payload.role === 'two_phase_unrelated_writer') {
    const sqlite = new BetterSqlite3(payload.databasePath);
    try {
      // Phase 1: Acquire exclusive write reservation on independent connection
      sqlite.prepare('BEGIN IMMEDIATE').run();
      // Notify parent that write lock is 100% held
      parentPort!.postMessage({ type: 'writer-acquired' });

      // Wait explicitly on releaseSignalBuffer until test signals release
      const releaseSignal = new Int32Array(payload.releaseSignalBuffer);
      Atomics.wait(releaseSignal, 0, 0);

      // Phase 2: Commit / Release
      sqlite.prepare('COMMIT').run();
      parentPort!.postMessage({ type: 'writer-released' });
    } catch (error) {
      try {
        sqlite.prepare('ROLLBACK').run();
      } catch {
        // ignore rollback error on close
      }
      parentPort!.postMessage({ type: 'writer_error', error: String(error) });
    } finally {
      sqlite.close();
    }
  }
} else {
  const workerScript = fileURLToPath(import.meta.url);

  interface WorkerResult {
    type:
      | 'creator-ready'
      | 'creator-entering-create'
      | 'success'
      | 'conflict'
      | 'repository_error'
      | 'unexpected_error'
      | 'writer-acquired'
      | 'writer-released'
      | 'writer_error';
    session?: AccountLoginSession;
    code?: string;
    message?: string;
    error?: string;
    repoCreateElapsedMs?: number;
    contentionObservedCount?: number;
  }

  async function executeTwoLoginCreatorRace(
    databasePath: string,
    inputA: {
      purpose: 'ADD_ACCOUNT' | 'RELOGIN';
      accountId?: string | null;
      pendingAccountId?: string | null;
      createdByAdminUserId: string;
      expiresAt: number;
    },
    inputB: {
      purpose: 'ADD_ACCOUNT' | 'RELOGIN';
      accountId?: string | null;
      pendingAccountId?: string | null;
      createdByAdminUserId: string;
      expiresAt: number;
    },
  ): Promise<{
    successCount: number;
    conflictCount: number;
    errorCount: number;
    results: WorkerResult[];
  }> {
    const startBarrierBuffer = new SharedArrayBuffer(4);
    const barrier = new Int32Array(startBarrierBuffer);

    const workerA = new Worker(workerScript, {
      workerData: {
        role: 'login_creator',
        databasePath,
        input: inputA,
        startBarrierBuffer,
      } satisfies WorkerPayload,
      execArgv: ['--import', 'tsx'],
    });

    const workerB = new Worker(workerScript, {
      workerData: {
        role: 'login_creator',
        databasePath,
        input: inputB,
        startBarrierBuffer,
      } satisfies WorkerPayload,
      execArgv: ['--import', 'tsx'],
    });

    let readyCount = 0;
    const results: WorkerResult[] = [];

    await new Promise<void>((resolve, reject) => {
      const checkReady = () => {
        if (readyCount === 2) {
          // Release start barrier simultaneously for both workers
          Atomics.store(barrier, 0, 1);
          Atomics.notify(barrier, 0, 2);
        }
      };

      const onMessage = (msg: WorkerResult) => {
        if (msg.type === 'creator-ready') {
          readyCount++;
          checkReady();
        } else if (msg.type !== 'creator-entering-create') {
          results.push(msg);
          if (results.length === 2) {
            resolve();
          }
        }
      };

      workerA.on('message', onMessage);
      workerB.on('message', onMessage);
      workerA.on('error', reject);
      workerB.on('error', reject);
    });

    await workerA.terminate();
    await workerB.terminate();

    const successCount = results.filter((r) => r.type === 'success').length;
    const conflictCount = results.filter(
      (r) => r.type === 'conflict' && r.code === 'CONFLICT',
    ).length;
    const errorCount = results.filter(
      (r) => r.type === 'repository_error' || r.type === 'unexpected_error',
    ).length;

    return { successCount, conflictCount, errorCount, results };
  }

  test('V4Concurrency: AccountLoginSession multi-worker true concurrency with start barrier (10 iterations)', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-concurrency-test-'));
    const databasePath = path.join(directory, 'test.db');

    const setupClient = createDatabase({ databasePath });
    setupClient.migrate();
    const admin = new AdminUserRepository(setupClient).create({
      username: 'admin',
      passwordHash: 'hash',
    });
    const accountA = new AccountRepository(setupClient).create({ name: 'Account A' });
    const accountB = new AccountRepository(setupClient).create({ name: 'Account B' });
    setupClient.close();

    // Run 10 iterations of diverse race conditions (cross-account, cross-purpose, same-account)
    for (let i = 0; i < 10; i++) {
      let inputA: Parameters<typeof executeTwoLoginCreatorRace>[1];
      let inputB: Parameters<typeof executeTwoLoginCreatorRace>[2];

      if (i % 3 === 0) {
        // Cross-account race: Account A RELOGIN vs Account B RELOGIN
        inputA = {
          purpose: 'RELOGIN',
          accountId: accountA.id,
          createdByAdminUserId: admin.id,
          expiresAt: Date.now() + 600_000,
        };
        inputB = {
          purpose: 'RELOGIN',
          accountId: accountB.id,
          createdByAdminUserId: admin.id,
          expiresAt: Date.now() + 600_000,
        };
      } else if (i % 3 === 1) {
        // Cross-purpose race: ADD_ACCOUNT vs RELOGIN
        inputA = {
          purpose: 'ADD_ACCOUNT',
          pendingAccountId: `pending-${i}-A`,
          createdByAdminUserId: admin.id,
          expiresAt: Date.now() + 600_000,
        };
        inputB = {
          purpose: 'RELOGIN',
          accountId: accountA.id,
          createdByAdminUserId: admin.id,
          expiresAt: Date.now() + 600_000,
        };
      } else {
        // Cross-pending-account race: ADD_ACCOUNT pending A vs ADD_ACCOUNT pending B
        inputA = {
          purpose: 'ADD_ACCOUNT',
          pendingAccountId: `pending-${i}-X`,
          createdByAdminUserId: admin.id,
          expiresAt: Date.now() + 600_000,
        };
        inputB = {
          purpose: 'ADD_ACCOUNT',
          pendingAccountId: `pending-${i}-Y`,
          createdByAdminUserId: admin.id,
          expiresAt: Date.now() + 600_000,
        };
      }

      const raceResult = await executeTwoLoginCreatorRace(databasePath, inputA, inputB);

      assert.equal(
        raceResult.successCount,
        1,
        `Iteration ${i}: Expected exactly 1 success, got ${raceResult.successCount}`,
      );
      assert.equal(
        raceResult.conflictCount,
        1,
        `Iteration ${i}: Expected exactly 1 CONFLICT, got ${raceResult.conflictCount}`,
      );
      assert.equal(
        raceResult.errorCount,
        0,
        `Iteration ${i}: Expected 0 unexpected errors, got ${raceResult.errorCount}`,
      );

      // Verify active count = 1 using a 3rd independent SQLite connection
      const verifySqlite = new BetterSqlite3(databasePath);
      const activeCountRow = verifySqlite
        .prepare(
          `SELECT COUNT(*) as count FROM account_login_sessions WHERE status IN ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING')`,
        )
        .get() as { count: number };
      assert.equal(
        activeCountRow.count,
        1,
        `Iteration ${i}: Active count in database must be exactly 1, got ${activeCountRow.count}`,
      );

      // Terminal releases slot test: Transition winning session to terminal state
      const winnerResult = raceResult.results.find((r) => r.type === 'success');
      assert.ok(winnerResult?.session?.id);

      const clientToTerminate = createDatabase({ databasePath });
      const repoToTerminate = new AccountLoginSessionRepository(clientToTerminate);
      if (i % 2 === 0) {
        repoToTerminate.markCancelled(winnerResult.session.id);
      } else {
        const sSt = repoToTerminate.markStarting(winnerResult.session.id);
        const sAu = repoToTerminate.markAwaitingUser(sSt.id);
        const sRd = repoToTerminate.markReadyDetected(sAu.id);
        const sCm = repoToTerminate.markCompleting(sRd.id);
        repoToTerminate.markCompleted(sCm.id);
      }
      clientToTerminate.close();

      // Verify active count in DB is now 0
      const afterTerminalRow = verifySqlite
        .prepare(
          `SELECT COUNT(*) as count FROM account_login_sessions WHERE status IN ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING')`,
        )
        .get() as { count: number };
      assert.equal(
        afterTerminalRow.count,
        0,
        `Iteration ${i}: Active count after terminal must be 0, got ${afterTerminalRow.count}`,
      );
      verifySqlite.close();
    }

    // After all iterations, creating a new session succeeds cleanly
    const finalClient = createDatabase({ databasePath });
    const finalRepo = new AccountLoginSessionRepository(finalClient);
    const finalSession = finalRepo.create({
      purpose: 'RELOGIN',
      accountId: accountA.id,
      createdByAdminUserId: admin.id,
      expiresAt: new Date(Date.now() + 600_000),
    });
    assert.equal(finalSession.status, 'PENDING');
    finalRepo.markCancelled(finalSession.id);
    finalClient.close();

    rmSync(directory, { recursive: true, force: true });
  });

  test('V4Concurrency: Deterministic atomic-probe short contention recovery (3 rounds)', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-short-handshake-test-'));
    const databasePath = path.join(directory, 'test.db');

    const setupClient = createDatabase({ databasePath });
    setupClient.migrate();
    const admin = new AdminUserRepository(setupClient).create({
      username: 'admin',
      passwordHash: 'hash',
    });
    const account = new AccountRepository(setupClient).create({ name: 'Account A' });
    setupClient.close();

    for (let round = 0; round < 3; round++) {
      const releaseSignalBuffer = new SharedArrayBuffer(4);
      const releaseSignal = new Int32Array(releaseSignalBuffer);

      const startBarrierBuffer = new SharedArrayBuffer(4);
      const startBarrier = new Int32Array(startBarrierBuffer);

      const contentionProbeBuffer = new SharedArrayBuffer(4);
      const contentionProbe = new Int32Array(contentionProbeBuffer);

      // Phase 1: Launch unrelated writer and wait for explicit 'writer-acquired' message
      const writerWorker = new Worker(workerScript, {
        workerData: {
          role: 'two_phase_unrelated_writer',
          databasePath,
          releaseSignalBuffer,
        } satisfies WorkerPayload,
        execArgv: ['--import', 'tsx'],
      });

      await new Promise<void>((resolve, reject) => {
        const onMessage = (msg: WorkerResult) => {
          if (msg.type === 'writer-acquired') {
            resolve();
          } else if (msg.type === 'writer_error') {
            reject(new Error(`Writer failed to acquire lock: ${msg.error}`));
          }
        };
        writerWorker.on('message', onMessage);
        writerWorker.on('error', reject);
      });

      // Confirm write lock is 100% held and 0 active sessions exist
      const checkSqlite = new BetterSqlite3(databasePath);
      const preCount = checkSqlite
        .prepare(
          `SELECT COUNT(*) as count FROM account_login_sessions WHERE status IN ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING')`,
        )
        .get() as { count: number };
      assert.equal(preCount.count, 0, 'No login session should exist before creator');
      checkSqlite.close();

      // Phase 2: Start Creator and wait until initialized ('creator-ready')
      let resolveCreatorResult: ((res: WorkerResult) => void) | undefined;
      const creatorResultPromise = new Promise<WorkerResult>((res) => {
        resolveCreatorResult = res;
      });

      const creatorWorker = new Worker(workerScript, {
        workerData: {
          role: 'login_creator',
          databasePath,
          startBarrierBuffer,
          contentionProbeBuffer,
          input: {
            purpose: 'RELOGIN',
            accountId: account.id,
            createdByAdminUserId: admin.id,
            expiresAt: Date.now() + 600_000,
          },
        } satisfies WorkerPayload,
        execArgv: ['--import', 'tsx'],
      });

      await new Promise<void>((resolve, reject) => {
        creatorWorker.on('message', (msg: WorkerResult) => {
          if (msg.type === 'creator-ready') {
            resolve();
          } else if (msg.type !== 'creator-entering-create') {
            resolveCreatorResult?.(msg);
          }
        });
        creatorWorker.on('error', reject);
      });

      // Both workers are fully ready:
      // 1. Release Creator to enter repo.create()
      Atomics.store(startBarrier, 0, 1);
      Atomics.notify(startBarrier, 0, 1);

      // 2. Wait on atomic probe until real SQLite lock contention (SQLITE_BUSY) is actually observed by Creator
      const probeDeadline = Date.now() + 2000;
      while (Atomics.load(contentionProbe, 0) < 1 && Date.now() < probeDeadline) {
        Atomics.wait(contentionProbe, 0, 0, 10);
      }
      assert.ok(
        Atomics.load(contentionProbe, 0) >= 1,
        'Contention probe must register at least 1 BUSY before writer release',
      );

      // 3. Now that real contention is proven to have occurred, signal Writer to release lock
      Atomics.store(releaseSignal, 0, 1);
      Atomics.notify(releaseSignal, 0, 1);

      const creatorResult = await creatorResultPromise;

      await creatorWorker.terminate();
      await writerWorker.terminate();

      // Assertions: Creator must recover within 500ms deadline, succeed, and NOT CONFLICT
      assert.equal(
        creatorResult.type,
        'success',
        `Round ${round}: Expected creator to succeed after transient lock release, got ${creatorResult.type} (${creatorResult.message})`,
      );
      assert.ok(creatorResult.session?.id);
      assert.ok(
        creatorResult.contentionObservedCount !== undefined &&
          creatorResult.contentionObservedCount >= 1,
        `Round ${round}: Must have observed real lock contention before recovering`,
      );
      assert.ok(
        creatorResult.repoCreateElapsedMs !== undefined && creatorResult.repoCreateElapsedMs >= 0,
      );

      // Verify active count in DB is exactly 1
      const verifySqlite = new BetterSqlite3(databasePath);
      const activeCount = verifySqlite
        .prepare(
          `SELECT COUNT(*) as count FROM account_login_sessions WHERE status IN ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING')`,
        )
        .get() as { count: number };
      assert.equal(activeCount.count, 1, `Round ${round}: Active session count must be exactly 1`);

      // Clean up session for next round
      const cleanupClient = createDatabase({ databasePath });
      const cleanupRepo = new AccountLoginSessionRepository(cleanupClient);
      cleanupRepo.markCancelled(creatorResult.session.id);
      cleanupClient.close();
      verifySqlite.close();
    }

    rmSync(directory, { recursive: true, force: true });
  });

  test('V4Concurrency: Deterministic atomic-probe persistent contention bounded timeout (3 rounds)', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-persistent-handshake-test-'));
    const databasePath = path.join(directory, 'test.db');

    const setupClient = createDatabase({ databasePath });
    setupClient.migrate();
    const admin = new AdminUserRepository(setupClient).create({
      username: 'admin',
      passwordHash: 'hash',
    });
    const account = new AccountRepository(setupClient).create({ name: 'Account A' });
    setupClient.close();

    for (let round = 0; round < 3; round++) {
      const releaseSignalBuffer = new SharedArrayBuffer(4);
      const releaseSignal = new Int32Array(releaseSignalBuffer);

      const startBarrierBuffer = new SharedArrayBuffer(4);
      const startBarrier = new Int32Array(startBarrierBuffer);

      const contentionProbeBuffer = new SharedArrayBuffer(4);
      const contentionProbe = new Int32Array(contentionProbeBuffer);

      // Phase 1: Launch unrelated writer and wait for explicit 'writer-acquired' message
      const writerWorker = new Worker(workerScript, {
        workerData: {
          role: 'two_phase_unrelated_writer',
          databasePath,
          releaseSignalBuffer,
        } satisfies WorkerPayload,
        execArgv: ['--import', 'tsx'],
      });

      await new Promise<void>((resolve, reject) => {
        const onMessage = (msg: WorkerResult) => {
          if (msg.type === 'writer-acquired') {
            resolve();
          } else if (msg.type === 'writer_error') {
            reject(new Error(`Writer failed to acquire lock: ${msg.error}`));
          }
        };
        writerWorker.on('message', onMessage);
        writerWorker.on('error', reject);
      });

      // Confirm 0 active sessions before creator starts
      const checkSqlite = new BetterSqlite3(databasePath);
      const preCount = checkSqlite
        .prepare(
          `SELECT COUNT(*) as count FROM account_login_sessions WHERE status IN ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING')`,
        )
        .get() as { count: number };
      assert.equal(preCount.count, 0);
      checkSqlite.close();

      // Phase 2: Start Creator and wait until initialized ('creator-ready')
      let resolveCreatorResult: ((res: WorkerResult) => void) | undefined;
      const creatorResultPromise = new Promise<WorkerResult>((res) => {
        resolveCreatorResult = res;
      });

      const creatorWorker = new Worker(workerScript, {
        workerData: {
          role: 'login_creator',
          databasePath,
          startBarrierBuffer,
          contentionProbeBuffer,
          input: {
            purpose: 'RELOGIN',
            accountId: account.id,
            createdByAdminUserId: admin.id,
            expiresAt: Date.now() + 600_000,
          },
        } satisfies WorkerPayload,
        execArgv: ['--import', 'tsx'],
      });

      await new Promise<void>((resolve, reject) => {
        creatorWorker.on('message', (msg: WorkerResult) => {
          if (msg.type === 'creator-ready') {
            resolve();
          } else if (msg.type !== 'creator-entering-create') {
            resolveCreatorResult?.(msg);
          }
        });
        creatorWorker.on('error', reject);
      });

      // Release Creator: Writer lock is NOT released, so Creator exhausts 500ms deadline
      Atomics.store(startBarrier, 0, 1);
      Atomics.notify(startBarrier, 0, 1);

      // Verify contention is actually observed by Creator probe
      const persistentProbeDeadline = Date.now() + 2000;
      while (Atomics.load(contentionProbe, 0) < 1 && Date.now() < persistentProbeDeadline) {
        Atomics.wait(contentionProbe, 0, 0, 10);
      }
      assert.ok(Atomics.load(contentionProbe, 0) >= 1);

      const creatorResult = await creatorResultPromise;

      // Now signal Writer to release lock and teardown
      Atomics.store(releaseSignal, 0, 1);
      Atomics.notify(releaseSignal, 0, 1);

      await creatorWorker.terminate();
      await writerWorker.terminate();

      // Assertions:
      // 1. Result must be repository_error with INTEGRITY_ERROR
      assert.equal(
        creatorResult.type,
        'repository_error',
        `Round ${round}: Expected repository_error, got ${creatorResult.type}`,
      );
      assert.equal(creatorResult.code, 'INTEGRITY_ERROR');
      assert.notEqual(creatorResult.code, 'CONFLICT');

      // 2. repoCreateElapsedMs measured worker-side must be bounded by ~500ms deadline (e.g. 450ms <= elapsed < 850ms)
      assert.ok(
        creatorResult.repoCreateElapsedMs !== undefined,
        'repoCreateElapsedMs must be returned on failure',
      );
      assert.ok(
        creatorResult.repoCreateElapsedMs >= LOGIN_SESSION_CONTENTION_DEADLINE_MS - 50,
        `Worker repo.create elapsed time ${creatorResult.repoCreateElapsedMs}ms should be at least ~500ms deadline`,
      );
      assert.ok(
        creatorResult.repoCreateElapsedMs < 850,
        `Worker repo.create elapsed time ${creatorResult.repoCreateElapsedMs}ms must be well below 850ms (never 30s worst-case)`,
      );

      // 3. Must have observed multiple BUSY contention attempts before deadline expiry
      assert.ok(
        creatorResult.contentionObservedCount !== undefined &&
          creatorResult.contentionObservedCount >= 1,
        `Round ${round}: Must have observed persistent lock contention before exhaustion`,
      );

      // 4. Active count in DB must remain strictly 0
      const verifySqlite = new BetterSqlite3(databasePath);
      const row = verifySqlite
        .prepare(
          `SELECT COUNT(*) as count FROM account_login_sessions WHERE status IN ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING')`,
        )
        .get() as { count: number };
      assert.equal(row.count, 0, `Round ${round}: Active count in DB must be exactly 0`);
      verifySqlite.close();

      // 5. Verify that after writer lock is released, creating a session succeeds cleanly
      const client = createDatabase({ databasePath });
      const repo = new AccountLoginSessionRepository(client);
      const session = repo.create({
        purpose: 'RELOGIN',
        accountId: account.id,
        createdByAdminUserId: admin.id,
        expiresAt: new Date(Date.now() + 600_000),
      });
      assert.equal(session.status, 'PENDING');
      repo.markCancelled(session.id);
      client.close();
    }

    rmSync(directory, { recursive: true, force: true });
  });

  test('V4Concurrency: Real nested transaction misuse on same physical connection through Repository', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-real-nested-repo-test-'));
    const databasePath = path.join(directory, 'test.db');

    const client = createDatabase({ databasePath });
    client.migrate();
    const admin = new AdminUserRepository(client).create({
      username: 'admin',
      passwordHash: 'hash',
    });
    const account = new AccountRepository(client).create({ name: 'Account A' });
    const repo = new AccountLoginSessionRepository(client);

    // Install internal contention probe to verify nested transaction error is NEVER classified as BUSY
    const contentionProbeBuffer = new SharedArrayBuffer(4);
    const contentionProbe = new Int32Array(contentionProbeBuffer);
    installAccountLoginSessionContentionProbeForTest(contentionProbe);

    // Access the SAME physical SQLite connection backing the client and repo
    const rawSqlite = getInternalSqliteDriverForTest(client);
    const originalTransaction = rawSqlite.transaction.bind(rawSqlite);

    try {
      // 1. Begin an outer raw transaction on this exact physical connection
      rawSqlite.prepare('BEGIN').run();

      // Configure driver transaction to execute raw BEGIN IMMEDIATE without savepoint interception
      // to test Repository error classification on raw SQLite nested transaction error
      rawSqlite.transaction = ((fn: (...args: unknown[]) => unknown) => {
        const wrapped = (...args: unknown[]) => {
          rawSqlite.prepare('BEGIN IMMEDIATE').run();
          try {
            const res = fn(...args);
            rawSqlite.prepare('COMMIT').run();
            return res;
          } catch (err) {
            try {
              rawSqlite.prepare('ROLLBACK').run();
            } catch {
              // ignore
            }
            throw err;
          }
        };
        wrapped.immediate = wrapped;
        wrapped.deferred = wrapped;
        wrapped.exclusive = wrapped;
        return wrapped;
      }) as unknown as typeof rawSqlite.transaction;

      // 2. Call repo.create() while outer transaction is active on the same physical connection
      const startTime = performance.now();
      let repositoryError: unknown;

      try {
        repo.create({
          purpose: 'RELOGIN',
          accountId: account.id,
          createdByAdminUserId: admin.id,
          expiresAt: new Date(Date.now() + 600_000),
        });
      } catch (err) {
        repositoryError = err;
      }
      const elapsed = performance.now() - startTime;

      // 3. Assertions:
      // a. Must throw typed AccountLoginSessionRepositoryError with INTEGRITY_ERROR
      assert.ok(
        repositoryError instanceof AccountLoginSessionRepositoryError,
        'Must throw typed AccountLoginSessionRepositoryError',
      );
      assert.equal((repositoryError as AccountLoginSessionRepositoryError).code, 'INTEGRITY_ERROR');
      assert.notEqual((repositoryError as AccountLoginSessionRepositoryError).code, 'CONFLICT');

      // b. Underlying cause must be SQLite nested transaction error
      assert.match(
        String((repositoryError as { cause?: unknown }).cause),
        /cannot start a transaction within a transaction/i,
        'Underlying cause must be SQLite cannot start a transaction within a transaction',
      );

      // c. Contention probe count must be strictly 0 (never classified as BUSY)
      assert.equal(
        Atomics.load(contentionProbe, 0),
        0,
        'Nested transaction error must NOT be classified as BUSY (contention probe count must be 0)',
      );

      // d. Must fail immediately without entering retry delay (elapsed < 50ms, way below 500ms deadline)
      assert.ok(
        elapsed < 50,
        `Nested transaction error must fail immediately (<50ms), took ${elapsed}ms`,
      );

      // 4. Verify 0 login session rows were created during the failed nested transaction attempt
      const countRow = rawSqlite
        .prepare('SELECT COUNT(*) as count FROM account_login_sessions')
        .get() as { count: number };
      assert.equal(
        countRow.count,
        0,
        'No login session row must exist after failed nested attempt',
      );

      // 5. Restore original driver transaction and rollback outer transaction
      rawSqlite.transaction = originalTransaction;
      rawSqlite.prepare('ROLLBACK').run();

      // 6. Verify that after rollback, repo.create() on this same connection succeeds cleanly
      const session = repo.create({
        purpose: 'RELOGIN',
        accountId: account.id,
        createdByAdminUserId: admin.id,
        expiresAt: new Date(Date.now() + 600_000),
      });
      assert.equal(session.status, 'PENDING');
      repo.markCancelled(session.id);
    } finally {
      rawSqlite.transaction = originalTransaction;
      clearAccountLoginSessionContentionProbeForTest();
      client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('V4Concurrency: Non-busy schema and driver errors throw immediately without retry delay', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-non-busy-error-test-'));
    const databasePath = path.join(directory, 'test.db');

    const setupClient = createDatabase({ databasePath });
    setupClient.migrate();
    const admin = new AdminUserRepository(setupClient).create({
      username: 'admin',
      passwordHash: 'hash',
    });
    const account = new AccountRepository(setupClient).create({ name: 'Account A' });

    // Drop table to trigger non-busy driver error
    const rawSqlite = getInternalSqliteDriverForTest(setupClient);
    rawSqlite.prepare('DROP TABLE account_login_sessions').run();

    const loginRepo = new AccountLoginSessionRepository(setupClient);

    const startTime = performance.now();
    assert.throws(
      () => {
        loginRepo.create({
          purpose: 'RELOGIN',
          accountId: account.id,
          createdByAdminUserId: admin.id,
          expiresAt: new Date(Date.now() + 600_000),
        });
      },
      (err: unknown) => {
        return (
          err instanceof AccountLoginSessionRepositoryError &&
          err.code === 'INTEGRITY_ERROR' &&
          err.code !== 'CONFLICT'
        );
      },
    );
    const elapsed = performance.now() - startTime;
    // Must throw immediately (< 150ms), NOT wait for 500ms deadline or retry loop
    assert.ok(
      elapsed < 150,
      `Non-busy database error should fail immediately without retry delay, took ${elapsed}ms`,
    );

    setupClient.close();
    rmSync(directory, { recursive: true, force: true });
  });
}
