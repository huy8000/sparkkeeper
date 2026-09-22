import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

import {
  AccountLoginSessionRepository,
  AccountOnboardingRepository,
  AccountRepository,
  AdminUserRepository,
  AuditEventRepository,
  createDatabase,
  type AccountOnboardingSession,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

interface StartWorkerPayload {
  readonly databasePath: string;
  readonly adminUserId: string;
  readonly idempotencyKey: string;
  readonly barrier: SharedArrayBuffer;
}

if (!isMainThread) {
  const payload = workerData as StartWorkerPayload;
  const client = createDatabase({ databasePath: payload.databasePath });
  try {
    parentPort!.postMessage({ type: 'ready' });
    Atomics.wait(new Int32Array(payload.barrier), 0, 0);
    const result = new AccountOnboardingRepository(client).start({
      purpose: 'ADD_ACCOUNT',
      createdByAdminUserId: payload.adminUserId,
      idempotencyKey: payload.idempotencyKey,
      now: new Date('2026-09-21T10:00:00.000Z'),
    });
    parentPort!.postMessage({ type: 'result', outcome: result.outcome });
  } catch (error) {
    parentPort!.postMessage({ type: 'error', message: String(error) });
  } finally {
    client.close();
  }
} else {
  function createAdmin(client: ReturnType<typeof createDatabase>, username = 'admin'): string {
    return new AdminUserRepository(client).create({ username, passwordHash: 'fixture-hash' }).id;
  }

  function advanceToAwaiting(
    repository: AccountOnboardingRepository,
    session: AccountOnboardingSession,
    startAt: Date,
  ): AccountOnboardingSession {
    const starting = repository.markStarting(session.id, startAt);
    assert.equal(starting.outcome, 'UPDATED');
    if (starting.outcome !== 'UPDATED') throw new Error('Expected STARTING transition.');
    const awaiting = repository.markAwaitingUser(session.id, new Date(startAt.getTime() + 1_000));
    assert.equal(awaiting.outcome, 'UPDATED');
    if (awaiting.outcome !== 'UPDATED') throw new Error('Expected AWAITING_USER transition.');
    return awaiting.session;
  }

  function createReadyAdd(
    repository: AccountOnboardingRepository,
    adminUserId: string,
    key: string,
    now: Date,
  ): AccountOnboardingSession {
    const start = repository.start({
      purpose: 'ADD_ACCOUNT',
      createdByAdminUserId: adminUserId,
      idempotencyKey: key,
      now,
    });
    assert.equal(start.outcome, 'CREATED');
    if (start.outcome !== 'CREATED') throw new Error('Expected created session.');
    advanceToAwaiting(repository, start.session, new Date(now.getTime() + 1_000));
    const ready = repository.markReadyDetected(start.session.id, new Date(now.getTime() + 3_000));
    assert.equal(ready.outcome, 'READY');
    if (ready.outcome !== 'READY') throw new Error('Expected ready session.');
    return ready.session;
  }

  test('AccountOnboardingRepository admits idempotently, fixes TTL, and redacts foreign active flow', (context) => {
    const { client } = createTemporaryDatabase(context);
    const adminId = createAdmin(client, 'admin-one');
    const otherAdminId = new AdminUserRepository(client).create({
      username: 'admin-two',
      passwordHash: 'fixture-hash',
      status: 'DISABLED',
    }).id;
    const repository = new AccountOnboardingRepository(client);
    const now = new Date('2026-09-21T10:00:00.000Z');

    const created = repository.start({
      purpose: 'ADD_ACCOUNT',
      createdByAdminUserId: adminId,
      idempotencyKey: 'onboarding-key-1',
      now,
    });
    assert.equal(created.outcome, 'CREATED');
    if (created.outcome !== 'CREATED') return;
    assert.equal(
      created.session.expiresAt.getTime() - created.session.createdAt.getTime(),
      900_000,
    );
    assert.equal(created.session.idempotencyKeyDigest?.length, 64);
    assert.notEqual(created.session.idempotencyKeyDigest, 'onboarding-key-1');
    assert.ok(created.session.pendingAccountId);

    const replay = repository.start({
      purpose: 'ADD_ACCOUNT',
      createdByAdminUserId: adminId,
      idempotencyKey: 'onboarding-key-1',
      now: new Date(now.getTime() + 60_000),
    });
    assert.equal(replay.outcome, 'REPLAY');
    if (replay.outcome === 'REPLAY') assert.equal(replay.session.id, created.session.id);

    const account = new AccountRepository(client).create({ name: 'Fixture Account' });
    const mismatchedReplay = repository.start({
      purpose: 'RELOGIN',
      accountId: account.id,
      createdByAdminUserId: adminId,
      idempotencyKey: 'onboarding-key-1',
      now,
    });
    assert.equal(mismatchedReplay.outcome, 'IDEMPOTENCY_CONFLICT');

    const foreignConflict = repository.start({
      purpose: 'ADD_ACCOUNT',
      createdByAdminUserId: otherAdminId,
      idempotencyKey: 'foreign-key',
      now,
    });
    assert.deepEqual(foreignConflict, { outcome: 'ACTIVE_CONFLICT', ownedSession: null });
    assert.equal(repository.findActiveForAdmin(otherAdminId), undefined);

    const audits = new AuditEventRepository(client).listByEntity(
      'ACCOUNT_LOGIN_SESSION',
      created.session.id,
    );
    assert.equal(audits.filter((audit) => audit.action === 'ACCOUNT_LOGIN_STARTED').length, 1);
  });

  test('READY, cancel, and expiry use one database winner', (context) => {
    const { client } = createTemporaryDatabase(context);
    const adminId = createAdmin(client);
    const repository = new AccountOnboardingRepository(client);
    const now = new Date('2026-09-21T10:00:00.000Z');
    const start = repository.start({
      purpose: 'ADD_ACCOUNT',
      createdByAdminUserId: adminId,
      idempotencyKey: 'race-ready',
      now,
    });
    assert.equal(start.outcome, 'CREATED');
    if (start.outcome !== 'CREATED') return;
    const awaiting = advanceToAwaiting(repository, start.session, new Date(now.getTime() + 1_000));

    assert.equal(
      repository.cancel(
        start.session.id,
        adminId,
        new Date(awaiting.updatedAt.getTime() - 1),
        new Date(now.getTime() + 3_000),
      ).outcome,
      'VERSION_CONFLICT',
    );
    const ready = repository.markReadyDetected(start.session.id, new Date(now.getTime() + 4_000));
    assert.equal(ready.outcome, 'READY');
    assert.equal(
      repository.cancel(
        start.session.id,
        adminId,
        ready.outcome === 'READY' ? ready.session.updatedAt : awaiting.updatedAt,
        new Date(now.getTime() + 5_000),
      ).outcome,
      'STATE_CONFLICT',
    );

    repository.markFailed(start.session.id, 'AUTH_NOT_READY', new Date(now.getTime() + 6_000));
    const expiring = repository.start({
      purpose: 'ADD_ACCOUNT',
      createdByAdminUserId: adminId,
      idempotencyKey: 'race-expire',
      now,
    });
    assert.equal(expiring.outcome, 'CREATED');
    if (expiring.outcome !== 'CREATED') return;
    advanceToAwaiting(repository, expiring.session, new Date(now.getTime() + 1_000));
    const expired = repository.markReadyDetected(
      expiring.session.id,
      new Date(now.getTime() + 900_000),
    );
    assert.equal(expired.outcome, 'EXPIRED');
  });

  test('ADD completion uses reserved Account id and converges through transaction A and B', (context) => {
    const { client } = createTemporaryDatabase(context);
    const adminId = createAdmin(client);
    const repository = new AccountOnboardingRepository(client);
    const now = new Date('2026-09-21T10:00:00.000Z');
    const ready = createReadyAdd(repository, adminId, 'add-completion', now);

    const begun = repository.beginAddCompletion(
      ready.id,
      { displayName: 'Fixture Douyin', douyinSecUid: 'sec-fixture-1' },
      new Date(now.getTime() + 4_000),
    );
    assert.equal(begun.outcome, 'COMPLETING');
    if (begun.outcome !== 'COMPLETING') return;
    assert.equal(begun.account.id, ready.pendingAccountId);
    assert.equal(begun.account.profileState, 'PROVISIONING');
    assert.equal(begun.session.status, 'COMPLETING');

    const recovery = repository.getRecoverySnapshot(ready.id);
    assert.equal(recovery?.account?.id, ready.pendingAccountId);
    assert.equal(recovery?.account?.profileState, 'PROVISIONING');

    const finished = repository.finishAddCompletion(ready.id, new Date(now.getTime() + 5_000));
    assert.equal(finished.outcome, 'COMPLETED');
    if (finished.outcome !== 'COMPLETED') return;
    assert.equal(finished.account.profileState, 'READY');
    assert.equal(finished.account.loginStatus, 'READY');
    assert.equal(finished.session.status, 'COMPLETED');
    assert.equal(
      new AuditEventRepository(client)
        .listByEntity('DOUYIN_ACCOUNT', finished.account.id)
        .filter((audit) => audit.action === 'ACCOUNT_CREATED').length,
      1,
    );

    const conflictReady = createReadyAdd(
      repository,
      adminId,
      'add-identity-conflict',
      new Date(now.getTime() + 10_000),
    );
    const conflict = repository.beginAddCompletion(conflictReady.id, {
      displayName: 'Duplicate',
      douyinSecUid: 'sec-fixture-1',
    });
    assert.equal(conflict.outcome, 'IDENTITY_CONFLICT');
    assert.equal(
      new AccountRepository(client).findById(conflictReady.pendingAccountId!),
      undefined,
    );
  });

  test('RELOGIN enforces stable identity for in-place and staging replacement completion', (context) => {
    const { client } = createTemporaryDatabase(context);
    const adminId = createAdmin(client);
    const accountRepository = new AccountRepository(client);
    const repository = new AccountOnboardingRepository(client);
    const now = new Date('2026-09-21T10:00:00.000Z');
    const account = accountRepository.create({
      name: 'Existing',
      profileState: 'READY',
      loginStatus: 'AUTH_EXPIRED',
      douyinSecUid: 'sec-existing',
      now,
    });

    const start = repository.start({
      purpose: 'RELOGIN',
      accountId: account.id,
      createdByAdminUserId: adminId,
      idempotencyKey: 'relogin-in-place',
      now,
    });
    assert.equal(start.outcome, 'CREATED');
    if (start.outcome !== 'CREATED') return;
    advanceToAwaiting(repository, start.session, new Date(now.getTime() + 1_000));
    repository.markReadyDetected(start.session.id, new Date(now.getTime() + 3_000));
    assert.equal(
      repository.completeReloginInPlace(start.session.id, {
        displayName: 'Wrong identity',
        douyinSecUid: 'sec-other',
      }).outcome,
      'IDENTITY_CONFLICT',
    );
    const completed = repository.completeReloginInPlace(
      start.session.id,
      { displayName: 'Existing refreshed', douyinSecUid: 'sec-existing' },
      new Date(now.getTime() + 5_000),
    );
    assert.equal(completed.outcome, 'COMPLETED');
    assert.equal(accountRepository.list().length, 1);

    accountRepository.update(account.id, {
      profileState: 'MISSING',
      loginStatus: 'UNKNOWN',
      now: new Date(now.getTime() + 6_000),
    });
    const replacementStart = repository.start({
      purpose: 'RELOGIN',
      accountId: account.id,
      createdByAdminUserId: adminId,
      idempotencyKey: 'relogin-replacement',
      now: new Date(now.getTime() + 7_000),
    });
    assert.equal(replacementStart.outcome, 'CREATED');
    if (replacementStart.outcome !== 'CREATED') return;
    advanceToAwaiting(repository, replacementStart.session, new Date(now.getTime() + 8_000));
    repository.markReadyDetected(replacementStart.session.id, new Date(now.getTime() + 10_000));
    const begun = repository.beginReloginReplacement(
      replacementStart.session.id,
      { displayName: 'Existing replacement', douyinSecUid: 'sec-existing' },
      new Date(now.getTime() + 11_000),
    );
    assert.equal(begun.outcome, 'COMPLETING');
    const finished = repository.finishReloginReplacement(
      replacementStart.session.id,
      new Date(now.getTime() + 12_000),
    );
    assert.equal(finished.outcome, 'COMPLETED');
    assert.equal(accountRepository.list().length, 1);
  });

  test('COMPLETING recovery failure marks the Account unavailable and the session terminal', (context) => {
    const { client } = createTemporaryDatabase(context);
    const adminId = createAdmin(client);
    const repository = new AccountOnboardingRepository(client);
    const now = new Date('2026-09-21T10:00:00.000Z');
    const ready = createReadyAdd(repository, adminId, 'recovery-failure', now);
    assert.equal(
      repository.beginAddCompletion(ready.id, {
        displayName: 'Recovery fixture',
        douyinUniqueId: 'unique-recovery',
      }).outcome,
      'COMPLETING',
    );
    const failed = repository.failCompleting(
      ready.id,
      'MISSING',
      'FINALIZE_FAILED',
      new Date(now.getTime() + 5_000),
    );
    assert.equal(failed?.session.status, 'FAILED');
    assert.equal(failed?.session.failureCode, 'FINALIZE_FAILED');
    assert.equal(failed?.account?.profileState, 'MISSING');
  });

  test('two concurrent connections admit exactly one global active onboarding flow', async (context) => {
    const { client, databasePath } = createTemporaryDatabase(context);
    const adminId = createAdmin(client);
    const barrier = new SharedArrayBuffer(4);
    const workerPath = fileURLToPath(import.meta.url);
    const workers = ['race-a', 'race-b'].map(
      (idempotencyKey) =>
        new Worker(workerPath, {
          workerData: { databasePath, adminUserId: adminId, idempotencyKey, barrier },
          execArgv: ['--import', 'tsx'],
        }),
    );
    context.after(async () => {
      await Promise.all(workers.map(async (worker) => worker.terminate()));
    });

    const channels = workers.map((worker) => {
      let resolveReady!: () => void;
      let resolveResult!: (message: { type: string; outcome?: string; message?: string }) => void;
      let rejectReady!: (error: Error) => void;
      let rejectResult!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });
      const result = new Promise<{ type: string; outcome?: string; message?: string }>(
        (resolve, reject) => {
          resolveResult = resolve;
          rejectResult = reject;
        },
      );
      worker.on('message', (message: { type: string; outcome?: string; message?: string }) => {
        if (message.type === 'ready') resolveReady();
        else resolveResult(message);
      });
      worker.once('error', (error) => {
        rejectReady(error);
        rejectResult(error);
      });
      return { ready, result };
    });

    await Promise.all(channels.map((channel) => channel.ready));

    Atomics.store(new Int32Array(barrier), 0, 1);
    Atomics.notify(new Int32Array(barrier), 0, workers.length);

    const settled = await Promise.all(channels.map((channel) => channel.result));
    assert.deepEqual(settled.map((result) => result.outcome).sort(), [
      'ACTIVE_CONFLICT',
      'CREATED',
    ]);
    assert.equal(new AccountLoginSessionRepository(client).listRecent().length, 1);
  });
}
