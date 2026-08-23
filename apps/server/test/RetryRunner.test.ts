import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
  type Friend,
  type SendRecord,
} from '@sparkkeeper/database';
import { parseBusinessDate } from '@sparkkeeper/shared';

import { DailyTaskRunner } from '../src/application/DailyTaskRunner.js';
import { TaskScheduler } from '../src/scheduler/TaskScheduler.js';

const businessDate = parseBusinessDate('2026-08-23');

class RetryFakeAutomation {
  auth: 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN' = 'READY';
  openResults: unknown[] = [{ status: 'VERIFIED' }];
  sendResults: unknown[] = [{ status: 'SUCCESS', sendAction: 'TRIGGERED' }];
  starts = 0;
  closes = 0;
  sends: string[] = [];

  async start() {
    this.starts += 1;
  }

  async checkAuth() {
    return this.auth;
  }

  async resolveAndOpen() {
    return this.openResults.shift() ?? { status: 'VERIFIED' };
  }

  async sendAndVerify(friend: Friend, record: SendRecord) {
    void friend;
    this.sends.push(record.messageText);
    return this.sendResults.shift() ?? { status: 'SUCCESS', sendAction: 'TRIGGERED' };
  }

  async close() {
    this.closes += 1;
  }
}

function runnerFixture(context: TestContext, friendCount = 1) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-retry-runner-test-'));
  const client = createDatabase({ databasePath: path.join(directory, 'sparkkeeper.db') });
  client.migrate();
  context.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const accounts = new AccountRepository(client);
  const schedules = new ScheduleRepository(client);
  const friends = new FriendRepository(client);
  const templates = new MessageTemplateRepository(client);
  const dailyRuns = new DailyRunRepository(client);
  const sendRecords = new SendRecordRepository(client);
  const account = accounts.create({ name: 'Test Account', loginStatus: 'READY' });
  schedules.create({
    accountId: account.id,
    startTime: '19:30',
    endTime: '21:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 3,
    retryIntervalSeconds: 60,
    now: new Date('2026-08-23T12:00:00.000Z'),
  });
  const friendRows = Array.from({ length: friendCount }, (_, index) =>
    friends.create({
      accountId: account.id,
      displayName: index === 0 ? 'Alice' : index === 1 ? 'Bob' : `Test User ${index + 1}`,
    }),
  );
  const friend = friendRows[0]!;
  const template = templates.create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Message A'],
  });
  const automation = new RetryFakeAutomation();
  let clock = new Date('2026-08-23T12:00:00.000Z');
  const runner = new DailyTaskRunner({
    accountId: account.id,
    messageTemplateId: template.id,
    allowRealSend: true,
    automation: automation as never,
    accounts,
    schedules,
    friends,
    templates,
    dailyRuns,
    sendRecords,
    now: () => clock,
  });
  return {
    client,
    account,
    friend,
    friendRows,
    template,
    automation,
    dailyRuns,
    schedules,
    sendRecords,
    runner,
    setClock: (value: Date) => {
      clock = value;
    },
    getClock: () => clock,
  };
}

function createStaleRunningRecord(fixture: ReturnType<typeof runnerFixture>) {
  const run = fixture.dailyRuns.createOrGet({
    accountId: fixture.account.id,
    businessDate,
    now: new Date('2026-08-23T12:00:00.000Z'),
  });
  fixture.dailyRuns.markRunning(run.id, new Date('2026-08-23T12:00:00.000Z'));
  const record = fixture.sendRecords.prepare({
    dailyRunId: run.id,
    friendId: fixture.friend.id,
    businessDate,
    messageTemplateId: fixture.template.id,
    messageText: 'Message A',
    now: new Date('2026-08-23T12:00:00.000Z'),
  }).record;
  fixture.sendRecords.claimInitialAttempt(record.id, new Date('2026-08-23T12:00:00.000Z'), 3);
  return { run, record };
}

test('retryable first Attempt waits, then succeeds at due time with the same snapshot', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = [
    { status: 'FAILED', failureCode: 'NETWORK_TRANSIENT' },
    { status: 'VERIFIED' },
  ];

  const result = await fixture.runner.run(fixture.account.id, businessDate);
  assert.equal(result, 'RETRY_WAIT');
  let record = fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate);
  assert.equal(record?.status, 'RETRY_WAIT');
  assert.equal(record?.attemptCount, 1);
  assert.equal(record?.messageText, 'Message A');

  fixture.setClock(new Date('2026-08-23T12:01:00.000Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SUCCESS');
  record = fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate);
  assert.equal(record?.status, 'SUCCESS');
  assert.equal(record?.attemptCount, 2);
  assert.equal(record?.messageText, 'Message A');
  assert.deepEqual(fixture.automation.sends, ['Message A']);
});

test('a retry tick before nextRetryAt does not start Browser automation', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = [{ status: 'FAILED', failureCode: 'NETWORK_TRANSIENT' }];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  assert.equal(fixture.automation.starts, 1);

  fixture.setClock(new Date('2026-08-23T12:00:59.999Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  assert.equal(fixture.automation.starts, 1);
  assert.equal(fixture.automation.sends.length, 0);
});

test('three total retryable Attempts finish FAILED without creating Attempt 4', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = Array.from({ length: 3 }, () => ({
    status: 'FAILED',
    failureCode: 'PAGE_LOAD_TIMEOUT',
  }));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  fixture.setClock(new Date('2026-08-23T12:01:00.000Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  fixture.setClock(new Date('2026-08-23T12:02:00.000Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');

  const record = fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate);
  assert.equal(record?.status, 'FAILED');
  assert.equal(record?.attemptCount, 3);
  assert.equal(record?.lastErrorCode, 'MAX_ATTEMPTS_EXHAUSTED');
  fixture.setClock(new Date('2026-08-23T12:03:00.000Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SKIPPED');
  assert.equal(fixture.automation.starts, 3);
});

test('AMBIGUOUS_CONTACT is final on the first Attempt and never sends', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = [{ status: 'FAILED', failureCode: 'AMBIGUOUS_CONTACT' }];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  const record = fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate);
  assert.equal(record?.status, 'FAILED');
  assert.equal(record?.attemptCount, 1);
  assert.equal(record?.lastErrorCode, 'AMBIGUOUS_CONTACT');
  assert.equal(fixture.automation.sends.length, 0);
});

test('typed pre-send SEND_ACTION_FAILED can retry and clears the conservative marker', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.sendResults = [
    { status: 'FAILED', failureCode: 'SEND_ACTION_FAILED', sendAction: 'NOT_TRIGGERED' },
  ];
  await fixture.runner.run(fixture.account.id, businessDate);
  const record = fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate);
  assert.equal(record?.status, 'RETRY_WAIT');
  assert.equal(record?.attemptCount, 1);
  assert.equal(record?.sendActionStartedAt, null);
  assert.equal(record?.lastErrorCode, 'SEND_ACTION_FAILED');
});

test('post-boundary uncertainty becomes DELIVERY_UNKNOWN and never retries', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.sendResults = [
    {
      status: 'DELIVERY_UNKNOWN',
      failureCode: 'DELIVERY_UNKNOWN',
      sendAction: 'UNKNOWN',
    },
  ];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  const record = fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate);
  assert.equal(record?.status, 'DELIVERY_UNKNOWN');
  assert.equal(record?.attemptCount, 1);
  fixture.setClock(new Date('2026-08-23T12:01:00.000Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SKIPPED');
  assert.equal(fixture.automation.sends.length, 1);
});

test('restart recovers stale RUNNING without marker to RETRY_WAIT without Browser', async (context) => {
  const fixture = runnerFixture(context);
  const { record } = createStaleRunningRecord(fixture);
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  const recovered = fixture.sendRecords.findById(record.id);
  assert.equal(recovered?.status, 'RETRY_WAIT');
  assert.equal(recovered?.attemptCount, 1);
  assert.equal(recovered?.lastErrorCode, 'PROCESS_INTERRUPTED_BEFORE_SEND');
  assert.equal(fixture.automation.starts, 0);
  assert.equal(fixture.automation.sends.length, 0);
});

test('restart recovers stale RUNNING with marker to DELIVERY_UNKNOWN without Browser', async (context) => {
  const fixture = runnerFixture(context);
  const { record } = createStaleRunningRecord(fixture);
  fixture.sendRecords.markSendActionStarted(record.id, new Date('2026-08-23T12:00:01.000Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  const recovered = fixture.sendRecords.findById(record.id);
  assert.equal(recovered?.status, 'DELIVERY_UNKNOWN');
  assert.equal(recovered?.attemptCount, 1);
  assert.equal(fixture.automation.starts, 0);
  assert.equal(fixture.automation.sends.length, 0);
});

test('a Friend-local retryable failure allows the next safe Friend in the same session', async (context) => {
  const fixture = runnerFixture(context, 2);
  fixture.automation.sendResults = [
    { status: 'FAILED', failureCode: 'SEND_ACTION_FAILED', sendAction: 'NOT_TRIGGERED' },
    { status: 'SUCCESS', sendAction: 'TRIGGERED' },
  ];
  const result = await fixture.runner.run(fixture.account.id, businessDate);
  const run = fixture.dailyRuns.findByAccountAndBusinessDate(fixture.account.id, businessDate)!;
  assert.deepEqual(
    fixture.sendRecords
      .listByDailyRunId(run.id)
      .map((record) => record.status)
      .sort(),
    ['RETRY_WAIT', 'SUCCESS'],
  );
  assert.equal(fixture.automation.starts, 1);
  assert.equal(fixture.automation.sends.length, 2);
  assert.equal(result, 'RETRY_WAIT');
});

test('a Run-global Browser failure schedules the current retry and stops later Friends', async (context) => {
  const fixture = runnerFixture(context, 2);
  fixture.automation.openResults = [{ status: 'FAILED', failureCode: 'BROWSER_TRANSIENT' }];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  const run = fixture.dailyRuns.findByAccountAndBusinessDate(fixture.account.id, businessDate)!;
  const records = fixture.sendRecords.listByDailyRunId(run.id);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.status, 'RETRY_WAIT');
  assert.equal(fixture.automation.sends.length, 0);
});

test('Scheduler ticks skip early retry work and execute exactly at the due instant', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = [
    { status: 'FAILED', failureCode: 'NETWORK_TRANSIENT' },
    { status: 'VERIFIED' },
  ];
  const scheduler = new TaskScheduler(fixture.account.id, fixture.schedules, fixture.runner, {
    now: () => fixture.getClock(),
  });

  assert.equal(await scheduler.tick(), 'TRIGGERED');
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate)?.attemptCount,
    1,
  );
  fixture.setClock(new Date('2026-08-23T12:00:59.999Z'));
  await scheduler.tick();
  assert.equal(fixture.automation.starts, 1);
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate)?.attemptCount,
    1,
  );

  fixture.setClock(new Date('2026-08-23T12:01:00.000Z'));
  assert.equal(await scheduler.tick(), 'TRIGGERED');
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate)?.attemptCount,
    2,
  );
  assert.equal(fixture.automation.starts, 2);
  assert.equal(await scheduler.tick(), 'SKIPPED');
  assert.equal(fixture.automation.starts, 2);
});

test('Scheduler finalizes expired RETRY_WAIT in the database without opening Browser', async (context) => {
  const fixture = runnerFixture(context);
  const { record } = createStaleRunningRecord(fixture);
  fixture.sendRecords.recoverInterruptedBeforeSend(record.id, {
    maxAttempts: 3,
    nextRetryAt: new Date('2026-08-23T12:01:00.000Z'),
    now: new Date('2026-08-23T12:00:00.000Z'),
  });
  fixture.setClock(new Date('2026-08-23T13:00:00.000Z'));
  const scheduler = new TaskScheduler(fixture.account.id, fixture.schedules, fixture.runner, {
    now: () => fixture.getClock(),
  });

  assert.equal(await scheduler.tick(), 'SKIPPED');
  const expired = fixture.sendRecords.findById(record.id);
  assert.equal(expired?.status, 'FAILED');
  assert.equal(expired?.lastErrorCode, 'RETRY_WINDOW_EXPIRED');
  assert.equal(expired?.nextRetryAt, null);
  assert.equal(fixture.automation.starts, 0);
  assert.equal(fixture.automation.sends.length, 0);
});

test('a previous BusinessDate RETRY_WAIT is finalized instead of carried into today', async (context) => {
  const fixture = runnerFixture(context);
  const { record } = createStaleRunningRecord(fixture);
  fixture.sendRecords.recoverInterruptedBeforeSend(record.id, {
    maxAttempts: 3,
    nextRetryAt: new Date('2026-08-23T12:01:00.000Z'),
    now: new Date('2026-08-23T12:00:00.000Z'),
  });
  fixture.setClock(new Date('2026-08-24T01:00:00.000Z'));
  const scheduler = new TaskScheduler(fixture.account.id, fixture.schedules, fixture.runner, {
    now: () => fixture.getClock(),
  });

  assert.equal(await scheduler.tick(), 'SKIPPED');
  assert.equal(fixture.sendRecords.findById(record.id)?.status, 'FAILED');
  assert.equal(fixture.sendRecords.findById(record.id)?.lastErrorCode, 'RETRY_WINDOW_EXPIRED');
  assert.equal(fixture.automation.starts, 0);
});

test('two retryable failures can succeed on the third and final Attempt', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = [
    { status: 'FAILED', failureCode: 'NETWORK_TRANSIENT' },
    { status: 'FAILED', failureCode: 'PAGE_LOAD_TIMEOUT' },
    { status: 'VERIFIED' },
  ];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  fixture.setClock(new Date('2026-08-23T12:01:00.000Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  fixture.setClock(new Date('2026-08-23T12:02:00.000Z'));
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SUCCESS');
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate)?.attemptCount,
    3,
  );
});

test('CONTACT_NOT_FOUND becomes final FAILED without send', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = [{ status: 'FAILED', failureCode: 'CONTACT_NOT_FOUND' }];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate)?.lastErrorCode,
    'CONTACT_NOT_FOUND',
  );
  assert.equal(fixture.automation.sends.length, 0);
});

test('SELECTOR_FAILURE becomes final FAILED without retry', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = [{ status: 'FAILED', failureCode: 'SELECTOR_FAILURE' }];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate)?.attemptCount,
    1,
  );
});

test('AUTH_EXPIRED stops the DailyRun and does not create a retry Attempt', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.auth = 'AUTH_EXPIRED';
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'AUTH_EXPIRED');
  assert.equal(
    fixture.dailyRuns.findByAccountAndBusinessDate(fixture.account.id, businessDate)?.status,
    'AUTH_EXPIRED',
  );
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate),
    undefined,
  );
});

test('AUTH_UNKNOWN fails safely and does not create a retry Attempt', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.auth = 'UNKNOWN';
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate),
    undefined,
  );
});

test('post-send VERIFY_FAILED is persisted as DELIVERY_UNKNOWN', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.sendResults = [
    { status: 'DELIVERY_UNKNOWN', failureCode: 'VERIFY_FAILED', sendAction: 'TRIGGERED' },
  ];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  assert.equal(
    fixture.sendRecords.findByFriendAndBusinessDate(fixture.friend.id, businessDate)?.status,
    'DELIVERY_UNKNOWN',
  );
});

test('Browser closes in finally after a retryable failure', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.openResults = [{ status: 'FAILED', failureCode: 'NETWORK_TRANSIENT' }];
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'RETRY_WAIT');
  assert.equal(fixture.automation.starts, 1);
  assert.equal(fixture.automation.closes, 1);
});

test('stale pre-send RUNNING at maxAttempts becomes final FAILED without Browser', async (context) => {
  const fixture = runnerFixture(context);
  const { record } = createStaleRunningRecord(fixture);
  const dueTwo = new Date('2026-08-23T12:01:00.000Z');
  fixture.sendRecords.scheduleRetry(record.id, {
    failureCode: 'NETWORK_TRANSIENT',
    maxAttempts: 3,
    nextRetryAt: dueTwo,
    now: new Date('2026-08-23T12:00:00.000Z'),
    externalActionConfirmedAbsent: true,
  });
  fixture.sendRecords.claimRetryAttempt(record.id, dueTwo, 3);
  const dueThree = new Date('2026-08-23T12:02:00.000Z');
  fixture.sendRecords.scheduleRetry(record.id, {
    failureCode: 'NETWORK_TRANSIENT',
    maxAttempts: 3,
    nextRetryAt: dueThree,
    now: dueTwo,
    externalActionConfirmedAbsent: true,
  });
  fixture.sendRecords.claimRetryAttempt(record.id, dueThree, 3);
  fixture.setClock(dueThree);

  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  const failed = fixture.sendRecords.findById(record.id);
  assert.equal(failed?.attemptCount, 3);
  assert.equal(failed?.status, 'FAILED');
  assert.equal(failed?.lastErrorCode, 'MAX_ATTEMPTS_EXHAUSTED');
  assert.equal(fixture.automation.starts, 0);
});
