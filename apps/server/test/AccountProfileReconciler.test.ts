import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountOnboardingRepository,
  AdminUserRepository,
  createDatabase,
  type AccountOnboardingSession,
  type DatabaseClient,
} from '@sparkkeeper/database';

import { AccountProfileReconciler } from '../src/onboarding/AccountProfileReconciler.js';
import { AccountProfileStore } from '../src/onboarding/AccountProfileStore.js';

interface Fixture {
  readonly client: DatabaseClient;
  readonly repository: AccountOnboardingRepository;
  readonly profiles: AccountProfileStore;
  readonly reconciler: AccountProfileReconciler;
  readonly adminUserId: string;
  readonly directory: string;
}

function createFixture(context: TestContext): Fixture {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-reconcile-test-'));
  const client = createDatabase({ databasePath: path.join(directory, 'sparkkeeper.db') });
  client.migrate();
  const adminUserId = new AdminUserRepository(client).create({
    username: `admin-${randomUUID().slice(0, 8)}`,
    passwordHash: 'fixture-hash',
  }).id;
  const repository = new AccountOnboardingRepository(client);
  const profiles = new AccountProfileStore(directory);
  context.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    client,
    repository,
    profiles,
    reconciler: new AccountProfileReconciler(repository, profiles),
    adminUserId,
    directory,
  };
}

function createCompletingAdd(fixture: Fixture, key: string): AccountOnboardingSession {
  const now = new Date('2026-09-21T10:00:00.000Z');
  const started = fixture.repository.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: fixture.adminUserId,
    idempotencyKey: key,
    now,
  });
  assert.equal(started.outcome, 'CREATED');
  if (started.outcome !== 'CREATED') throw new Error('Expected created session.');
  fixture.repository.markStarting(started.session.id, new Date(now.getTime() + 1_000));
  fixture.repository.markAwaitingUser(started.session.id, new Date(now.getTime() + 2_000));
  fixture.repository.markReadyDetected(started.session.id, new Date(now.getTime() + 3_000));
  const begun = fixture.repository.beginAddCompletion(
    started.session.id,
    { displayName: `Fixture ${key}`, douyinUniqueId: `unique-${key}` },
    new Date(now.getTime() + 4_000),
  );
  assert.equal(begun.outcome, 'COMPLETING');
  if (begun.outcome !== 'COMPLETING') throw new Error('Expected completing session.');
  return begun.session;
}

test('reconciliation retries rename after transaction A and finishes transaction B', (context) => {
  const fixture = createFixture(context);
  const session = createCompletingAdd(fixture, 'after-a');
  fixture.profiles.prepareStaging(session.id, session.pendingAccountId!);

  const result = fixture.reconciler.reconcileCompleting(session);
  assert.equal(result.outcome, 'COMPLETED');
  assert.deepEqual(fixture.profiles.inspectReconciliation(session.id, session.pendingAccountId!), {
    staging: 'ABSENT',
    final: 'OWNED',
  });
  assert.equal(fixture.repository.getRecoverySnapshot(session.id)?.session.status, 'COMPLETED');
});

test('reconciliation recognizes rename completed before transaction B', (context) => {
  const fixture = createFixture(context);
  const session = createCompletingAdd(fixture, 'after-rename');
  fixture.profiles.prepareStaging(session.id, session.pendingAccountId!);
  fixture.profiles.finalizeStaging(session.id, session.pendingAccountId!);

  assert.equal(fixture.reconciler.reconcileCompleting(session).outcome, 'COMPLETED');
  assert.equal(fixture.repository.getRecoverySnapshot(session.id)?.session.status, 'COMPLETED');
});

test('reconciliation marks missing when neither staging nor final exists', (context) => {
  const fixture = createFixture(context);
  const session = createCompletingAdd(fixture, 'missing');

  assert.equal(fixture.reconciler.reconcileCompleting(session).outcome, 'FAILED_MISSING');
  const snapshot = fixture.repository.getRecoverySnapshot(session.id);
  assert.equal(snapshot?.session.status, 'FAILED');
  assert.equal(snapshot?.session.failureCode, 'FINALIZE_FAILED');
  assert.equal(snapshot?.account?.profileState, 'MISSING');
});

test('reconciliation quarantines both provably owned paths and fails closed', (context) => {
  const fixture = createFixture(context);
  const session = createCompletingAdd(fixture, 'both');
  const accountId = session.pendingAccountId!;
  const otherSessionId = randomUUID();
  fixture.profiles.prepareStaging(otherSessionId, accountId);
  fixture.profiles.finalizeStaging(otherSessionId, accountId);
  fixture.profiles.prepareStaging(session.id, accountId);

  assert.equal(fixture.reconciler.reconcileCompleting(session).outcome, 'FAILED_INTEGRITY');
  const snapshot = fixture.repository.getRecoverySnapshot(session.id);
  assert.equal(snapshot?.session.status, 'FAILED');
  assert.equal(snapshot?.session.failureCode, 'INTEGRITY_ERROR');
  assert.equal(snapshot?.account?.profileState, 'QUARANTINED');
  assert.deepEqual(fixture.profiles.inspectReconciliation(session.id, accountId), {
    staging: 'ABSENT',
    final: 'ABSENT',
  });
});

test('reconciliation never renames or deletes an invalid marker', (context) => {
  const fixture = createFixture(context);
  const session = createCompletingAdd(fixture, 'invalid');
  const staging = fixture.profiles.prepareStaging(session.id, session.pendingAccountId!);
  writeFileSync(
    path.join(staging, '.sparkkeeper-profile.json'),
    `${JSON.stringify({
      version: 1,
      accountId: randomUUID(),
      createdByLoginSessionId: session.id,
    })}\n`,
    'utf8',
  );

  assert.equal(fixture.reconciler.reconcileCompleting(session).outcome, 'FAILED_INTEGRITY');
  assert.equal(
    fixture.repository.getRecoverySnapshot(session.id)?.account?.profileState,
    'MISSING',
  );
  assert.equal(
    fixture.profiles.inspectReconciliation(session.id, session.pendingAccountId!).staging,
    'INVALID',
  );
});
