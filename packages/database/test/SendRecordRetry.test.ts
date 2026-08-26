import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { parseBusinessDate } from '@sparkkeeper/shared';

import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  SendRecordRepository,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

const businessDate = parseBusinessDate('2026-08-23');
const preparedAt = new Date('2026-08-23T12:00:00.000Z');
const claimedAt = new Date('2026-08-23T12:00:10.000Z');

function retryFixture(context: TestContext) {
  const temporary = createTemporaryDatabase(context);
  const account = new AccountRepository(temporary.client).create({ name: 'Test Account' });
  const friend = new FriendRepository(temporary.client).create({
    accountId: account.id,
    displayName: 'Alice',
  });
  const template = new MessageTemplateRepository(temporary.client).create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Message A'],
  });
  const run = new DailyRunRepository(temporary.client).createOrGet({
    accountId: account.id,
    businessDate,
    now: preparedAt,
  });
  const repository = new SendRecordRepository(temporary.client);
  const record = repository.prepare({
    dailyRunId: run.id,
    friendId: friend.id,
    businessDate,
    messageTemplateId: template.id,
    messageText: 'Message A',
    now: preparedAt,
  }).record;
  return { ...temporary, account, friend, run, record, repository };
}

test('initial atomic claim changes READY Attempt 0 to RUNNING Attempt 1', (context) => {
  const fixture = retryFixture(context);
  assert.equal(fixture.record.status, 'READY');
  assert.equal(fixture.record.attemptCount, 0);

  const result = fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  assert.equal(result.type, 'CLAIMED');
  if (result.type === 'CLAIMED') {
    assert.equal(result.record.status, 'RUNNING');
    assert.equal(result.record.attemptCount, 1);
  }
});

test('RETRY_WAIT persists due time and only the due atomic claim increments Attempt 2', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const dueAt = new Date('2026-08-23T12:01:10.000Z');
  const waiting = fixture.repository.scheduleRetry(fixture.record.id, {
    failureCode: 'NETWORK_TRANSIENT',
    maxAttempts: 3,
    nextRetryAt: dueAt,
    now: new Date('2026-08-23T12:00:10.000Z'),
    externalActionConfirmedAbsent: true,
  });
  assert.equal(waiting.status, 'RETRY_WAIT');
  assert.equal(waiting.attemptCount, 1);
  assert.equal(waiting.nextRetryAt?.toISOString(), dueAt.toISOString());
  assert.equal(waiting.lastErrorCode, 'NETWORK_TRANSIENT');
  assert.equal(waiting.finishedAt, null);

  const early = fixture.repository.claimRetryAttempt(
    fixture.record.id,
    new Date('2026-08-23T12:01:09.999Z'),
    3,
  );
  assert.equal(early.type, 'NOT_CLAIMABLE');
  assert.equal(fixture.repository.findById(fixture.record.id)?.attemptCount, 1);

  const due = fixture.repository.claimRetryAttempt(fixture.record.id, dueAt, 3);
  assert.equal(due.type, 'CLAIMED');
  if (due.type === 'CLAIMED') {
    assert.equal(due.record.status, 'RUNNING');
    assert.equal(due.record.attemptCount, 2);
    assert.equal(due.record.nextRetryAt, null);
    assert.equal(due.record.sendActionStartedAt, null);
  }
});

test('concurrent due retry claims have one winner and increment exactly once', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const dueAt = new Date('2026-08-23T12:01:10.000Z');
  fixture.repository.scheduleRetry(fixture.record.id, {
    failureCode: 'PAGE_LOAD_TIMEOUT',
    maxAttempts: 3,
    nextRetryAt: dueAt,
    now: claimedAt,
    externalActionConfirmedAbsent: true,
  });
  const secondClient = createDatabase({ databasePath: fixture.databasePath });
  context.after(() => secondClient.close());
  secondClient.migrate();
  const secondRepository = new SendRecordRepository(secondClient);

  const results = [
    fixture.repository.claimRetryAttempt(fixture.record.id, dueAt, 3),
    secondRepository.claimRetryAttempt(fixture.record.id, dueAt, 3),
  ];
  assert.equal(results.filter((result) => result.type === 'CLAIMED').length, 1);
  assert.equal(results.filter((result) => result.type === 'NOT_CLAIMABLE').length, 1);
  assert.equal(fixture.repository.findById(fixture.record.id)?.attemptCount, 2);
});

test('retry scheduling and claim cannot cross maxAttempts', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 1);
  assert.throws(() =>
    fixture.repository.scheduleRetry(fixture.record.id, {
      failureCode: 'NETWORK_TRANSIENT',
      maxAttempts: 1,
      nextRetryAt: new Date('2026-08-23T12:01:10.000Z'),
      now: claimedAt,
      externalActionConfirmedAbsent: true,
    }),
  );
  assert.equal(fixture.repository.findById(fixture.record.id)?.attemptCount, 1);
  assert.equal(fixture.repository.findById(fixture.record.id)?.status, 'RUNNING');
});

test('send-action marker is durable before SUCCESS writes sentAt and remains terminal', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const actionAt = new Date('2026-08-23T12:00:20.000Z');
  const marked = fixture.repository.markSendActionStarted(fixture.record.id, actionAt);
  assert.equal(marked.sendActionStartedAt?.toISOString(), actionAt.toISOString());

  const succeededAt = new Date('2026-08-23T12:00:30.000Z');
  const succeeded = fixture.repository.markSuccess(fixture.record.id, succeededAt);
  assert.equal(succeeded.status, 'SUCCESS');
  assert.equal(succeeded.sentAt?.toISOString(), succeededAt.toISOString());
  assert.equal(succeeded.finishedAt?.toISOString(), succeededAt.toISOString());
  assert.equal(succeeded.nextRetryAt, null);
  assert.equal(
    fixture.repository.claimRetryAttempt(fixture.record.id, new Date('2026-08-23T12:02:00Z'), 3)
      .type,
    'NOT_CLAIMABLE',
  );
});

test('final FAILED clears retry timing, persists safe code and cannot be claimed again', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const dueAt = new Date('2026-08-23T12:01:10.000Z');
  fixture.repository.scheduleRetry(fixture.record.id, {
    failureCode: 'NETWORK_TRANSIENT',
    maxAttempts: 3,
    nextRetryAt: dueAt,
    now: claimedAt,
    externalActionConfirmedAbsent: true,
  });
  const finishedAt = new Date('2026-08-23T12:02:00.000Z');
  const failed = fixture.repository.markFinalFailed(
    fixture.record.id,
    finishedAt,
    'RETRY_WINDOW_EXPIRED',
  );
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.lastErrorCode, 'RETRY_WINDOW_EXPIRED');
  assert.equal(failed.nextRetryAt, null);
  assert.equal(failed.finishedAt?.toISOString(), finishedAt.toISOString());
  assert.equal(
    fixture.repository.claimRetryAttempt(fixture.record.id, dueAt, 3).type,
    'NOT_CLAIMABLE',
  );
});

test('DELIVERY_UNKNOWN is terminal and never retryable', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  fixture.repository.markSendActionStarted(fixture.record.id, claimedAt);
  const unknown = fixture.repository.markDeliveryUnknown(fixture.record.id, claimedAt);
  assert.equal(unknown.status, 'DELIVERY_UNKNOWN');
  assert.equal(unknown.lastErrorCode, 'DELIVERY_UNKNOWN');
  assert.equal(unknown.nextRetryAt, null);
  assert.equal(
    fixture.repository.claimRetryAttempt(fixture.record.id, claimedAt, 3).type,
    'NOT_CLAIMABLE',
  );
});

test('stale RUNNING before the action boundary recovers without refunding Attempt 1', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const dueAt = new Date('2026-08-23T12:01:10.000Z');
  const recovered = fixture.repository.recoverInterruptedBeforeSend(fixture.record.id, {
    maxAttempts: 3,
    nextRetryAt: dueAt,
    now: claimedAt,
  });
  assert.equal(recovered.type, 'RECOVERED');
  if (recovered.type === 'RECOVERED') {
    assert.equal(recovered.record.status, 'RETRY_WAIT');
    assert.equal(recovered.record.attemptCount, 1);
    assert.equal(recovered.record.lastErrorCode, 'PROCESS_INTERRUPTED_BEFORE_SEND');
  }
});

test('stale RUNNING after the action boundary becomes DELIVERY_UNKNOWN', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  fixture.repository.markSendActionStarted(fixture.record.id, claimedAt);
  const recovered = fixture.repository.recoverInterruptedAfterSendBoundary(
    fixture.record.id,
    new Date('2026-08-23T12:01:00.000Z'),
  );
  assert.equal(recovered.status, 'DELIVERY_UNKNOWN');
  assert.equal(recovered.attemptCount, 1);
  assert.equal(recovered.lastErrorCode, 'DELIVERY_UNKNOWN');
});

test('due retry listing excludes future RETRY_WAIT until the exact due instant', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const dueAt = new Date('2026-08-23T12:01:10.000Z');
  fixture.repository.scheduleRetry(fixture.record.id, {
    failureCode: 'NETWORK_TRANSIENT',
    maxAttempts: 3,
    nextRetryAt: dueAt,
    now: claimedAt,
    externalActionConfirmedAbsent: true,
  });
  assert.deepEqual(
    fixture.repository.listDueRetriesByDailyRunId(
      fixture.run.id,
      new Date('2026-08-23T12:01:09.999Z'),
    ),
    [],
  );
  assert.deepEqual(
    fixture.repository.listDueRetriesByDailyRunId(fixture.run.id, dueAt).map((record) => record.id),
    [fixture.record.id],
  );
});

test('retry state and original message snapshot persist through close, reopen and migrate again', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const dueAt = new Date('2026-08-23T12:01:10.000Z');
  fixture.repository.scheduleRetry(fixture.record.id, {
    failureCode: 'NETWORK_TRANSIENT',
    maxAttempts: 3,
    nextRetryAt: dueAt,
    now: claimedAt,
    externalActionConfirmedAbsent: true,
  });
  fixture.client.close();

  const reopened = createDatabase({ databasePath: fixture.databasePath });
  context.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 8);
  const persisted = new SendRecordRepository(reopened).findById(fixture.record.id);
  assert.equal(persisted?.status, 'RETRY_WAIT');
  assert.equal(persisted?.attemptCount, 1);
  assert.equal(persisted?.nextRetryAt?.toISOString(), dueAt.toISOString());
  assert.equal(persisted?.messageText, 'Message A');
});

test('initial claim reports a missing SendRecord without creating state', (context) => {
  const fixture = retryFixture(context);
  assert.deepEqual(fixture.repository.claimInitialAttempt('missing', claimedAt, 3), {
    type: 'NOT_FOUND',
  });
});

test('retry claim reports a missing SendRecord without creating state', (context) => {
  const fixture = retryFixture(context);
  assert.deepEqual(fixture.repository.claimRetryAttempt('missing', claimedAt, 3), {
    type: 'NOT_FOUND',
  });
});

test('SUCCESS cannot be scheduled for retry', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  fixture.repository.markSuccess(fixture.record.id, claimedAt);
  assert.throws(() =>
    fixture.repository.scheduleRetry(fixture.record.id, {
      failureCode: 'NETWORK_TRANSIENT',
      maxAttempts: 3,
      nextRetryAt: new Date('2026-08-23T12:01:10.000Z'),
      now: claimedAt,
      externalActionConfirmedAbsent: true,
    }),
  );
});

test('final FAILED cannot be scheduled for retry', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  fixture.repository.markFinalFailed(fixture.record.id, claimedAt, 'CONTACT_NOT_FOUND');
  assert.throws(() =>
    fixture.repository.scheduleRetry(fixture.record.id, {
      failureCode: 'NETWORK_TRANSIENT',
      maxAttempts: 3,
      nextRetryAt: new Date('2026-08-23T12:01:10.000Z'),
      now: claimedAt,
      externalActionConfirmedAbsent: true,
    }),
  );
});

test('DELIVERY_UNKNOWN cannot be scheduled for retry', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  fixture.repository.markDeliveryUnknown(fixture.record.id, claimedAt);
  assert.throws(() =>
    fixture.repository.scheduleRetry(fixture.record.id, {
      failureCode: 'NETWORK_TRANSIENT',
      maxAttempts: 3,
      nextRetryAt: new Date('2026-08-23T12:01:10.000Z'),
      now: claimedAt,
      externalActionConfirmedAbsent: true,
    }),
  );
});

test('retry scheduling rejects a non-future nextRetryAt', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  assert.throws(() =>
    fixture.repository.scheduleRetry(fixture.record.id, {
      failureCode: 'NETWORK_TRANSIENT',
      maxAttempts: 3,
      nextRetryAt: claimedAt,
      now: claimedAt,
      externalActionConfirmedAbsent: true,
    }),
  );
});

test('send-action marker is idempotent and preserves its first timestamp', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const first = fixture.repository.markSendActionStarted(fixture.record.id, claimedAt);
  const second = fixture.repository.markSendActionStarted(
    fixture.record.id,
    new Date('2026-08-23T12:00:20.000Z'),
  );
  assert.equal(second.sendActionStartedAt?.getTime(), first.sendActionStartedAt?.getTime());
});

test('interrupted pre-send Attempt at maxAttempts is not recoverable', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 1);
  const result = fixture.repository.recoverInterruptedBeforeSend(fixture.record.id, {
    maxAttempts: 1,
    nextRetryAt: new Date('2026-08-23T12:01:10.000Z'),
    now: claimedAt,
  });
  assert.equal(result.type, 'NOT_RECOVERABLE');
  assert.equal(fixture.repository.findById(fixture.record.id)?.attemptCount, 1);
});

test('a retry claim respects a lower valid maxAttempts bound from Schedule', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  const dueAt = new Date('2026-08-23T12:01:10.000Z');
  fixture.repository.scheduleRetry(fixture.record.id, {
    failureCode: 'NETWORK_TRANSIENT',
    maxAttempts: 3,
    nextRetryAt: dueAt,
    now: claimedAt,
    externalActionConfirmedAbsent: true,
  });
  assert.equal(
    fixture.repository.claimRetryAttempt(fixture.record.id, dueAt, 1).type,
    'NOT_CLAIMABLE',
  );
  assert.equal(fixture.repository.findById(fixture.record.id)?.attemptCount, 1);
});

test('due listing remains empty for terminal SendRecords', (context) => {
  const fixture = retryFixture(context);
  fixture.repository.claimInitialAttempt(fixture.record.id, claimedAt, 3);
  fixture.repository.markFinalFailed(fixture.record.id, claimedAt, 'CONTACT_NOT_FOUND');
  assert.deepEqual(
    fixture.repository.listDueRetriesByDailyRunId(
      fixture.run.id,
      new Date('2026-08-23T12:10:00.000Z'),
    ),
    [],
  );
});
