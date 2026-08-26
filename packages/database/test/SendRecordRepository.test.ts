import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { parseBusinessDate } from '@sparkkeeper/shared';
import { eq } from 'drizzle-orm';

import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  dailyRuns,
  FriendRepository,
  friends,
  MessageTemplateRepository,
  messageTemplates,
  SendRecordRepository,
  SendRecordRepositoryError,
  sendRecords,
  type NewSendRecordRow,
  type PrepareSendRecordInput,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

const BUSINESS_DATE = parseBusinessDate('2026-08-23');
const NEXT_BUSINESS_DATE = parseBusinessDate('2026-08-24');
const CREATED_AT = new Date('2026-08-23T10:00:00.000Z');
const CLAIMED_AT = new Date('2026-08-23T10:01:00.000Z');
const FINISHED_AT = new Date('2026-08-23T10:02:00.000Z');

test('prepare creates a READY SendRecord with UUID and explicit timestamps', (context) => {
  const fixture = createSendFixture(context);
  const result = prepareRecord(fixture);

  assert.equal(result.type, 'PREPARED');
  assert.match(result.record.id, /^[0-9a-f-]{36}$/i);
  assert.equal(result.record.status, 'READY');
  assert.equal(result.record.businessDate, BUSINESS_DATE);
  assert.equal(result.record.messageText, 'Hello');
  assert.equal(result.record.startedAt, null);
  assert.equal(result.record.finishedAt, null);
  assert.equal(result.record.createdAt.getTime(), CREATED_AT.getTime());
  assert.equal(result.record.updatedAt.getTime(), CREATED_AT.getTime());
});

test('findById returns a prepared SendRecord', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  assert.deepEqual(fixture.repository.findById(prepared.id), prepared);
});

test('findById returns undefined for an unknown SendRecord', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.equal(new SendRecordRepository(client).findById('missing-send-record'), undefined);
});

test('findByFriendAndBusinessDate returns the exact idempotency record', (context) => {
  const fixture = createSendFixture(context);
  const record = prepareRecord(fixture).record;
  assert.equal(
    fixture.repository.findByFriendAndBusinessDate(fixture.friend.id, BUSINESS_DATE)?.id,
    record.id,
  );
  assert.equal(
    fixture.repository.findByFriendAndBusinessDate(fixture.friend.id, NEXT_BUSINESS_DATE),
    undefined,
  );
});

test('listByDailyRunId returns only that DailyRun records', (context) => {
  const fixture = createSendFixture(context);
  const secondFriend = new FriendRepository(fixture.client).create({
    accountId: fixture.account.id,
    displayName: 'Bob',
  });
  prepareRecord(fixture);
  prepareRecord(fixture, { friendId: secondFriend.id, messageText: 'Message B' });

  assert.equal(fixture.repository.listByDailyRunId(fixture.run.id).length, 2);
  assert.equal(fixture.repository.listByDailyRunId('missing-run').length, 0);
});

test('listByFriendId returns records across business dates', (context) => {
  const fixture = createSendFixture(context);
  prepareRecord(fixture);
  const nextRun = new DailyRunRepository(fixture.client).createOrGet({
    accountId: fixture.account.id,
    businessDate: NEXT_BUSINESS_DATE,
    now: CREATED_AT,
  });
  prepareRecord(fixture, {
    dailyRunId: nextRun.id,
    businessDate: NEXT_BUSINESS_DATE,
    messageText: 'Message B',
  });

  assert.deepEqual(
    fixture.repository.listByFriendId(fixture.friend.id).map((record) => record.businessDate),
    [BUSINESS_DATE, NEXT_BUSINESS_DATE],
  );
});

test('duplicate Friend/businessDate prepare leaves only one row', (context) => {
  const fixture = createSendFixture(context);
  prepareRecord(fixture);
  prepareRecord(fixture);
  assert.equal(fixture.repository.listByFriendId(fixture.friend.id).length, 1);
});

test('duplicate prepare returns the existing typed result', (context) => {
  const fixture = createSendFixture(context);
  const first = prepareRecord(fixture);
  const second = prepareRecord(fixture);
  assert.equal(first.type, 'PREPARED');
  assert.equal(second.type, 'ALREADY_PREPARED');
  assert.equal(second.record.id, first.record.id);
});

test('duplicate prepare never overwrites the first message snapshot', (context) => {
  const fixture = createSendFixture(context);
  const first = prepareRecord(fixture, { messageText: 'Message A' });
  const second = prepareRecord(fixture, { messageText: 'Message B', now: FINISHED_AT });
  assert.equal(second.record.id, first.record.id);
  assert.equal(second.record.messageText, 'Message A');
  assert.equal(second.record.updatedAt.getTime(), CREATED_AT.getTime());
});

test('different Friends on the same business date are allowed', (context) => {
  const fixture = createSendFixture(context);
  const secondFriend = new FriendRepository(fixture.client).create({
    accountId: fixture.account.id,
    displayName: 'Bob',
  });
  prepareRecord(fixture);
  prepareRecord(fixture, { friendId: secondFriend.id, messageText: 'Message B' });
  assert.equal(fixture.repository.listByDailyRunId(fixture.run.id).length, 2);
});

test('the same Friend may receive a new record on the next business date', (context) => {
  const fixture = createSendFixture(context);
  prepareRecord(fixture);
  const nextRun = new DailyRunRepository(fixture.client).createOrGet({
    accountId: fixture.account.id,
    businessDate: NEXT_BUSINESS_DATE,
    now: CREATED_AT,
  });
  const next = prepareRecord(fixture, {
    dailyRunId: nextRun.id,
    businessDate: NEXT_BUSINESS_DATE,
    messageText: 'Message B',
  });
  assert.equal(next.type, 'PREPARED');
  assert.equal(fixture.repository.listByFriendId(fixture.friend.id).length, 2);
});

test('database UNIQUE(friend_id,business_date) rejects a low-level duplicate insert', (context) => {
  const fixture = createSendFixture(context);
  prepareRecord(fixture);
  const otherAccount = new AccountRepository(fixture.client).create({ name: 'Test Account B' });
  const otherRun = new DailyRunRepository(fixture.client).createOrGet({
    accountId: otherAccount.id,
    businessDate: BUSINESS_DATE,
    now: CREATED_AT,
  });

  assert.throws(
    () =>
      fixture.client.orm
        .insert(sendRecords)
        .values(rawRecord(fixture, { id: randomUUID(), dailyRunId: otherRun.id }))
        .run(),
    /UNIQUE constraint failed: send_records\.friend_id, send_records\.business_date/,
  );
});

test('database UNIQUE(daily_run_id,friend_id) rejects a low-level Run duplicate', (context) => {
  const fixture = createSendFixture(context);
  prepareRecord(fixture);

  assert.throws(
    () =>
      fixture.client.orm
        .insert(sendRecords)
        .values(
          rawRecord(fixture, {
            id: randomUUID(),
            businessDate: NEXT_BUSINESS_DATE,
          }),
        )
        .run(),
    /UNIQUE constraint failed: send_records\.daily_run_id, send_records\.friend_id/,
  );
});

test('prepare rejects an unknown Friend with a typed error', (context) => {
  const fixture = createSendFixture(context);
  assertRepositoryCode(
    () => prepareRecord(fixture, { friendId: 'missing-friend' }),
    'FRIEND_NOT_FOUND',
  );
});

test('prepare rejects an unknown DailyRun with a typed error', (context) => {
  const fixture = createSendFixture(context);
  assertRepositoryCode(
    () => prepareRecord(fixture, { dailyRunId: 'missing-daily-run' }),
    'DAILY_RUN_NOT_FOUND',
  );
});

test('prepare rejects an unknown MessageTemplate with a typed error', (context) => {
  const fixture = createSendFixture(context);
  assertRepositoryCode(
    () => prepareRecord(fixture, { messageTemplateId: 'missing-template' }),
    'MESSAGE_TEMPLATE_NOT_FOUND',
  );
});

test('prepare allows a null MessageTemplate', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture, { messageTemplateId: null });
  assert.equal(prepared.record.messageTemplateId, null);
});

test('prepare rejects blank message text', (context) => {
  const fixture = createSendFixture(context);
  assertRepositoryCode(() => prepareRecord(fixture, { messageText: '   ' }), 'INVALID_MESSAGE');
});

test('prepare preserves original message whitespace', (context) => {
  const fixture = createSendFixture(context);
  assert.equal(prepareRecord(fixture, { messageText: ' Hello ' }).record.messageText, ' Hello ');
});

test('prepare rejects a DailyRun/Friend Account mismatch', (context) => {
  const fixture = createSendFixture(context);
  const secondAccount = new AccountRepository(fixture.client).create({ name: 'Test Account B' });
  const secondFriend = new FriendRepository(fixture.client).create({
    accountId: secondAccount.id,
    displayName: 'Bob',
  });
  assertRepositoryCode(
    () => prepareRecord(fixture, { friendId: secondFriend.id }),
    'ACCOUNT_MISMATCH',
  );
});

test('prepare rejects a DailyRun/businessDate mismatch', (context) => {
  const fixture = createSendFixture(context);
  assertRepositoryCode(
    () => prepareRecord(fixture, { businessDate: NEXT_BUSINESS_DATE }),
    'BUSINESS_DATE_MISMATCH',
  );
});

test('the first conditional claim changes READY to RUNNING', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  const claim = fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  assert.equal(claim.type, 'CLAIMED');
  assert.equal(claim.record.status, 'RUNNING');
  assert.equal(claim.record.startedAt?.getTime(), CLAIMED_AT.getTime());
});

test('a second claim returns NOT_CLAIMABLE', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  assert.equal(fixture.repository.claimForExecution(prepared.id, CLAIMED_AT).type, 'CLAIMED');
  assert.equal(
    fixture.repository.claimForExecution(prepared.id, FINISHED_AT).type,
    'NOT_CLAIMABLE',
  );
  assert.equal(fixture.repository.findById(prepared.id)?.status, 'RUNNING');
});

test('two DatabaseClients grant execution to only one claimant', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  const secondClient = createDatabase({ databasePath: fixture.databasePath });
  context.after(() => secondClient.close());
  secondClient.migrate();
  const secondRepository = new SendRecordRepository(secondClient);

  const results = [
    fixture.repository.claimForExecution(prepared.id, CLAIMED_AT),
    secondRepository.claimForExecution(prepared.id, FINISHED_AT),
  ];
  assert.deepEqual(
    results.map((result) => result.type),
    ['CLAIMED', 'NOT_CLAIMABLE'],
  );
  assert.equal(secondRepository.findById(prepared.id)?.status, 'RUNNING');
  secondClient.close();
});

test('SUCCESS SendRecords cannot be claimed', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  fixture.repository.markSuccess(prepared.id, FINISHED_AT);
  assert.equal(
    fixture.repository.claimForExecution(prepared.id, FINISHED_AT).type,
    'NOT_CLAIMABLE',
  );
});

test('FAILED SendRecords are not automatically claimable', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  fixture.repository.markFailed(prepared.id, FINISHED_AT);
  assert.equal(
    fixture.repository.claimForExecution(prepared.id, FINISHED_AT).type,
    'NOT_CLAIMABLE',
  );
});

test('DELIVERY_UNKNOWN SendRecords are not automatically claimable', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  fixture.repository.markDeliveryUnknown(prepared.id, FINISHED_AT);
  assert.equal(
    fixture.repository.claimForExecution(prepared.id, FINISHED_AT).type,
    'NOT_CLAIMABLE',
  );
});

test('markSuccess performs RUNNING to SUCCESS', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  assert.equal(fixture.repository.markSuccess(prepared.id, FINISHED_AT).status, 'SUCCESS');
});

test('markFailed performs RUNNING to FAILED', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  assert.equal(fixture.repository.markFailed(prepared.id, FINISHED_AT).status, 'FAILED');
});

test('markFailedBeforeSend transitions READY directly to FAILED without a claim', (context) => {
  const fixture = createSendFixture(context);
  const record = prepareRecord(fixture).record;
  const failed = fixture.repository.markFailedBeforeSend(record.id, FINISHED_AT);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.startedAt, null);
  assert.equal(failed.finishedAt?.getTime(), FINISHED_AT.getTime());
  assert.equal(fixture.repository.claimForExecution(record.id, CLAIMED_AT).type, 'NOT_CLAIMABLE');
});

test('markDeliveryUnknown performs RUNNING to DELIVERY_UNKNOWN', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  assert.equal(
    fixture.repository.markDeliveryUnknown(prepared.id, FINISHED_AT).status,
    'DELIVERY_UNKNOWN',
  );
});

test('SUCCESS is terminal and repeated markSuccess preserves the first finish timestamp', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  const success = fixture.repository.markSuccess(prepared.id, FINISHED_AT);
  const repeated = fixture.repository.markSuccess(
    prepared.id,
    new Date('2026-08-23T10:03:00.000Z'),
  );

  assert.equal(repeated.finishedAt?.getTime(), success.finishedAt?.getTime());
  assertRepositoryCode(
    () => fixture.repository.markFailed(prepared.id, FINISHED_AT),
    'INVALID_STATE_TRANSITION',
  );
  assertRepositoryCode(
    () => fixture.repository.markDeliveryUnknown(prepared.id, FINISHED_AT),
    'INVALID_STATE_TRANSITION',
  );
});

test('claim and completion update only their explicit timestamp fields', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  const claimed = fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  assert.equal(claimed.type, 'CLAIMED');
  assert.equal(claimed.record.createdAt.getTime(), CREATED_AT.getTime());
  assert.equal(claimed.record.updatedAt.getTime(), CLAIMED_AT.getTime());
  const success = fixture.repository.markSuccess(prepared.id, FINISHED_AT);
  assert.equal(success.startedAt?.getTime(), CLAIMED_AT.getTime());
  assert.equal(success.finishedAt?.getTime(), FINISHED_AT.getTime());
  assert.equal(success.updatedAt.getTime(), FINISHED_AT.getTime());
});

test('SUCCESS idempotency keeps one record through prepare and claim repeats', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture, { messageText: 'Message A' }).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  fixture.repository.markSuccess(prepared.id, FINISHED_AT);
  const repeatedPrepare = prepareRecord(fixture, { messageText: 'Message B' });
  const repeatedClaim = fixture.repository.claimForExecution(prepared.id, FINISHED_AT);

  assert.equal(repeatedPrepare.type, 'ALREADY_PREPARED');
  assert.equal(repeatedPrepare.record.status, 'SUCCESS');
  assert.equal(repeatedPrepare.record.messageText, 'Message A');
  assert.equal(repeatedClaim.type, 'NOT_CLAIMABLE');
  assert.equal(fixture.repository.listByFriendId(fixture.friend.id).length, 1);
});

test('claim and terminal markers distinguish missing SendRecords', (context) => {
  const fixture = createSendFixture(context);
  assert.deepEqual(fixture.repository.claimForExecution('missing-record', CLAIMED_AT), {
    type: 'NOT_FOUND',
  });
  assertRepositoryCode(
    () => fixture.repository.markSuccess('missing-record', FINISHED_AT),
    'SEND_RECORD_NOT_FOUND',
  );
});

test('invalid timestamps fail explicitly', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  assertRepositoryCode(
    () => fixture.repository.claimForExecution(prepared.id, new Date(Number.NaN)),
    'INVALID_TIMESTAMP',
  );
});

test('Friend deletion is blocked while historical SendRecords reference it', (context) => {
  const fixture = createSendFixture(context);
  prepareRecord(fixture);
  assert.throws(
    () => fixture.client.orm.delete(friends).where(eq(friends.id, fixture.friend.id)).run(),
    /FOREIGN KEY constraint failed/,
  );
});

test('DailyRun deletion cascades to its SendRecords', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture).record;
  fixture.client.orm.delete(dailyRuns).where(eq(dailyRuns.id, fixture.run.id)).run();
  assert.equal(fixture.repository.findById(prepared.id), undefined);
});

test('MessageTemplate deletion sets the FK null and preserves the message snapshot', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture, { messageText: 'Message A' }).record;
  fixture.client.orm
    .delete(messageTemplates)
    .where(eq(messageTemplates.id, fixture.template.id))
    .run();
  const persisted = fixture.repository.findById(prepared.id);
  assert.equal(persisted?.messageTemplateId, null);
  assert.equal(persisted?.messageText, 'Message A');
});

test('database CHECK constraints reject invalid dates, messages, and statuses', (context) => {
  const fixture = createSendFixture(context);
  assert.throws(
    () =>
      fixture.client.orm
        .insert(sendRecords)
        .values(rawRecord(fixture, { businessDate: '2026-02-30' as typeof BUSINESS_DATE }))
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      fixture.client.orm
        .insert(sendRecords)
        .values(rawRecord(fixture, { messageText: '   ' }))
        .run(),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      fixture.client.orm
        .insert(sendRecords)
        .values(rawRecord(fixture, { status: 'RETRYING' as NewSendRecordRow['status'] }))
        .run(),
    /CHECK constraint failed/,
  );
});

test('SendRecord persists after close, reopen, and repeated migrate', (context) => {
  const fixture = createSendFixture(context);
  const prepared = prepareRecord(fixture, { messageText: 'Message A' }).record;
  fixture.repository.claimForExecution(prepared.id, CLAIMED_AT);
  fixture.repository.markSuccess(prepared.id, FINISHED_AT);
  fixture.client.close();

  const reopened = createDatabase({ databasePath: fixture.databasePath });
  context.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 8);
  const persisted = new SendRecordRepository(reopened).findById(prepared.id);
  assert.equal(persisted?.status, 'SUCCESS');
  assert.equal(persisted?.messageText, 'Message A');
  reopened.close();
});

function createSendFixture(context: TestContext) {
  const temporary = createTemporaryDatabase(context);
  const account = new AccountRepository(temporary.client).create({ name: 'Test Account' });
  const friend = new FriendRepository(temporary.client).create({
    accountId: account.id,
    displayName: 'Alice',
  });
  const template = new MessageTemplateRepository(temporary.client).create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  const run = new DailyRunRepository(temporary.client).createOrGet({
    accountId: account.id,
    businessDate: BUSINESS_DATE,
    now: CREATED_AT,
  });
  return {
    ...temporary,
    account,
    friend,
    repository: new SendRecordRepository(temporary.client),
    run,
    template,
  };
}

type SendFixture = ReturnType<typeof createSendFixture>;

function prepareRecord(fixture: SendFixture, overrides: Partial<PrepareSendRecordInput> = {}) {
  return fixture.repository.prepare({
    dailyRunId: fixture.run.id,
    friendId: fixture.friend.id,
    businessDate: BUSINESS_DATE,
    messageTemplateId: fixture.template.id,
    messageText: 'Hello',
    now: CREATED_AT,
    ...overrides,
  });
}

function rawRecord(
  fixture: SendFixture,
  overrides: Partial<NewSendRecordRow> = {},
): NewSendRecordRow {
  return {
    id: randomUUID(),
    dailyRunId: fixture.run.id,
    friendId: fixture.friend.id,
    businessDate: BUSINESS_DATE,
    messageTemplateId: fixture.template.id,
    messageText: 'Hello',
    status: 'READY',
    startedAt: null,
    finishedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function assertRepositoryCode(
  action: () => unknown,
  expectedCode: SendRecordRepositoryError['code'],
): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof SendRecordRepositoryError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}
