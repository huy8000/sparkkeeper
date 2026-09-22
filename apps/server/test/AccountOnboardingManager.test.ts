import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountOnboardingRepository,
  AdminUserRepository,
  createDatabase,
  type DatabaseClient,
} from '@sparkkeeper/database';

import { AccountOnboardingManager } from '../src/onboarding/AccountOnboardingManager.js';
import { AccountProfileStore } from '../src/onboarding/AccountProfileStore.js';
import type {
  AccountLoginWorkerEvent,
  AccountLoginWorkerStart,
} from '../src/onboarding/AccountLoginWorkerProtocol.js';

class FakeSupervisor {
  startInput: AccountLoginWorkerStart | undefined;
  handler: ((event: AccountLoginWorkerEvent) => void | Promise<void>) | undefined;
  stopped = 0;

  start(
    start: AccountLoginWorkerStart,
    handler: (event: AccountLoginWorkerEvent) => void | Promise<void>,
  ): void {
    this.startInput = start;
    this.handler = handler;
  }
  async emit(event: AccountLoginWorkerEvent): Promise<void> {
    await this.handler?.(event);
  }
  async stop(): Promise<void> {
    this.stopped += 1;
    this.startInput = undefined;
  }
  async stopAll(): Promise<void> {
    this.stopped += 1;
    this.startInput = undefined;
  }
  owns(sessionId: string): boolean {
    return this.startInput?.sessionId === sessionId;
  }
  getConsoleEndpoint(sessionId: string): { host: '127.0.0.1'; port: number } | undefined {
    return this.owns(sessionId) ? { host: '127.0.0.1', port: 48_321 } : undefined;
  }
}

interface Fixture {
  readonly database: DatabaseClient;
  readonly repository: AccountOnboardingRepository;
  readonly supervisor: FakeSupervisor;
  readonly profiles: AccountProfileStore;
  readonly manager: AccountOnboardingManager;
  readonly adminId: string;
  now: Date;
  fireTimer: (() => void) | undefined;
}

function createFixture(context: TestContext, releaseGateOpen: () => boolean = () => true): Fixture {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-manager-test-'));
  const database = createDatabase({ databasePath: path.join(directory, 'sparkkeeper.db') });
  database.migrate();
  const repository = new AccountOnboardingRepository(database);
  const supervisor = new FakeSupervisor();
  const profiles = new AccountProfileStore(directory);
  const fixture = {
    database,
    repository,
    supervisor,
    profiles,
    manager: undefined as unknown as AccountOnboardingManager,
    adminId: new AdminUserRepository(database).create({
      username: `admin-${randomUUID().slice(0, 8)}`,
      passwordHash: 'fixture-hash',
    }).id,
    now: new Date('2030-01-01T00:00:00.000Z'),
    fireTimer: undefined,
  };
  fixture.manager = new AccountOnboardingManager({
    repository,
    profiles,
    supervisor,
    clock: () => fixture.now,
    setTimer: (callback) => {
      fixture.fireTimer = callback;
      return setTimeout(() => undefined, 60 * 60 * 1000);
    },
    releaseGateOpen,
  });
  context.after(async () => {
    await fixture.manager.stop();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return fixture;
}

test('release gate refuses admission before any durable session or worker is created', async (context) => {
  const fixture = createFixture(context, () => false);
  const result = await fixture.manager.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: fixture.adminId,
    idempotencyKey: 'closed-release-gate',
    now: fixture.now,
  });

  assert.deepEqual(result, { outcome: 'RELEASE_GATE_CLOSED' });
  assert.equal(fixture.repository.findActiveGlobal(), undefined);
  assert.equal(fixture.supervisor.startInput, undefined);
});

test('ADD_ACCOUNT worker events complete transaction A, rename and transaction B', async (context) => {
  const fixture = createFixture(context);
  const started = await fixture.manager.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: fixture.adminId,
    idempotencyKey: 'manager-add',
    now: fixture.now,
  });
  assert.equal(started.outcome, 'CREATED');
  if (started.outcome !== 'CREATED') throw new Error('Expected created session.');
  const sessionId = started.session.id;
  assert.equal(fixture.supervisor.startInput?.profileKind, 'STAGING');

  fixture.now = new Date(fixture.now.getTime() + 1_000);
  await fixture.supervisor.emit({ type: 'AWAITING_USER', sessionId });
  fixture.now = new Date(fixture.now.getTime() + 1_000);
  await fixture.supervisor.emit({ type: 'READY_DETECTED', sessionId });
  fixture.now = new Date(fixture.now.getTime() + 1_000);
  await fixture.supervisor.emit({
    type: 'IDENTITY_EXTRACTED',
    sessionId,
    identity: {
      displayName: 'Controlled Account',
      douyinSecUid: null,
      douyinUniqueId: 'controlled-unique',
      douyinShortId: null,
      avatarRemoteUrl: null,
    },
  });

  const snapshot = fixture.repository.getRecoverySnapshot(sessionId);
  assert.equal(snapshot?.session.status, 'COMPLETED');
  assert.equal(snapshot?.account?.profileState, 'READY');
  assert.equal(snapshot?.account?.loginStatus, 'READY');
  assert.equal(
    fixture.manager.getForAdmin(sessionId, fixture.adminId)?.resultAccountId,
    snapshot?.account?.id,
  );
});

test('non-renewable TTL expires and cleans up the worker/profile lease', async (context) => {
  const fixture = createFixture(context);
  const started = await fixture.manager.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: fixture.adminId,
    idempotencyKey: 'manager-expiry',
    now: fixture.now,
  });
  assert.equal(started.outcome, 'CREATED');
  if (started.outcome !== 'CREATED') throw new Error('Expected created session.');

  fixture.now = new Date(started.session.expiresAt.getTime());
  fixture.fireTimer?.();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    fixture.repository.getRecoverySnapshot(started.session.id)?.session.status,
    'EXPIRED',
  );
  assert.ok(fixture.supervisor.stopped >= 1);
});

test('worker TTL notification delegates the unique terminal outcome to repository expiry CAS', async (context) => {
  const fixture = createFixture(context);
  const started = await fixture.manager.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: fixture.adminId,
    idempotencyKey: 'manager-worker-expiry',
    now: fixture.now,
  });
  assert.equal(started.outcome, 'CREATED');
  if (started.outcome !== 'CREATED') return;
  await fixture.supervisor.emit({ type: 'AWAITING_USER', sessionId: started.session.id });
  fixture.now = new Date(started.session.expiresAt.getTime());

  await fixture.supervisor.emit({
    type: 'INTERACTIVE_EXPIRED',
    sessionId: started.session.id,
  });

  assert.equal(
    fixture.repository.getRecoverySnapshot(started.session.id)?.session.status,
    'EXPIRED',
  );
  assert.equal(
    fixture.profiles.inspectReconciliation(started.session.id, started.session.pendingAccountId!)
      .staging,
    'ABSENT',
  );
});

test('startup recovery continues READY completion after the interactive expiry timestamp', async (context) => {
  const fixture = createFixture(context);
  const started = fixture.repository.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: fixture.adminId,
    idempotencyKey: 'recover-ready-after-expiry',
    now: fixture.now,
  });
  assert.equal(started.outcome, 'CREATED');
  if (started.outcome !== 'CREATED') return;
  fixture.profiles.prepareStaging(started.session.id, started.session.pendingAccountId!);
  fixture.repository.markStarting(started.session.id, new Date(fixture.now.getTime() + 1_000));
  fixture.repository.markAwaitingUser(started.session.id, new Date(fixture.now.getTime() + 2_000));
  fixture.repository.markReadyDetected(started.session.id, new Date(fixture.now.getTime() + 3_000));
  fixture.now = new Date(started.session.expiresAt.getTime() + 60_000);

  await fixture.manager.recover();

  assert.equal(fixture.supervisor.startInput?.runtimeMode, 'COMPLETION_RECOVERY');
  assert.equal(
    fixture.repository.getRecoverySnapshot(started.session.id)?.session.status,
    'READY_DETECTED',
  );
  await fixture.supervisor.emit({
    type: 'IDENTITY_EXTRACTED',
    sessionId: started.session.id,
    identity: {
      displayName: 'Recovered Account',
      douyinSecUid: 'recovered-sec-uid',
      douyinUniqueId: null,
      douyinShortId: null,
      avatarRemoteUrl: null,
    },
  });
  assert.equal(
    fixture.repository.getRecoverySnapshot(started.session.id)?.session.status,
    'COMPLETED',
  );
});

test('startup recovery idempotently removes owned staging left by terminal sessions', async (context) => {
  const fixture = createFixture(context);
  const started = fixture.repository.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: fixture.adminId,
    idempotencyKey: 'recover-terminal-staging',
    now: fixture.now,
  });
  assert.equal(started.outcome, 'CREATED');
  if (started.outcome !== 'CREATED') return;
  fixture.profiles.prepareStaging(started.session.id, started.session.pendingAccountId!);
  fixture.repository.markFailed(started.session.id, 'START_FAILED', fixture.now);

  await fixture.manager.recover();
  await fixture.manager.recover();

  assert.equal(
    fixture.profiles.inspectReconciliation(started.session.id, started.session.pendingAccountId!)
      .staging,
    'ABSENT',
  );
  assert.equal(fixture.supervisor.startInput, undefined);
});

test('idempotent replay of a terminal session never starts a second worker', async (context) => {
  const fixture = createFixture(context);
  const request = {
    purpose: 'ADD_ACCOUNT' as const,
    createdByAdminUserId: fixture.adminId,
    idempotencyKey: 'terminal-replay',
    now: fixture.now,
  };
  const first = await fixture.manager.start(request);
  assert.equal(first.outcome, 'CREATED');
  if (first.outcome !== 'CREATED') throw new Error('Expected created session.');
  const cancelled = await fixture.manager.cancel(
    first.session.id,
    fixture.adminId,
    first.summary?.updatedAt === undefined
      ? first.session.updatedAt
      : new Date(first.summary.updatedAt),
  );
  assert.equal(cancelled.outcome, 'CANCELLED');

  const replay = await fixture.manager.start(request);
  assert.equal(replay.outcome, 'REPLAY');
  assert.equal(replay.summary?.status, 'CANCELLED');
  assert.equal(fixture.supervisor.startInput, undefined);
});
