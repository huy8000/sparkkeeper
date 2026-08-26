import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
  type DatabaseClient,
  type SendRecord,
} from '@sparkkeeper/database';
import { parseBusinessDate, type RetryFailureCode } from '@sparkkeeper/shared';

import type {
  AutomationSendResult,
  ContactOpenResult,
  DailyTaskAutomation,
} from '../src/application/DailyTaskAutomation.js';
import { DailyTaskRunner } from '../src/application/DailyTaskRunner.js';
import { TaskScheduler } from '../src/scheduler/TaskScheduler.js';

const businessDate = parseBusinessDate('2026-08-23');
const start = new Date('2026-08-23T11:30:00.000Z');

class FakeAutomation implements DailyTaskAutomation {
  starts = 0;
  sends = 0;
  closes = 0;

  constructor(
    private readonly openResults: ContactOpenResult[] = [],
    private readonly sendResults: AutomationSendResult[] = [],
  ) {}

  async start(): Promise<void> {
    this.starts += 1;
  }

  async checkAuth() {
    return 'READY' as const;
  }

  async resolveAndOpen(): Promise<ContactOpenResult> {
    return this.openResults.shift() ?? { status: 'VERIFIED' };
  }

  async sendAndVerify(): Promise<AutomationSendResult> {
    this.sends += 1;
    return this.sendResults.shift() ?? { status: 'SUCCESS', sendAction: 'TRIGGERED' };
  }

  async close(): Promise<void> {
    this.closes += 1;
  }
}

interface Scenario {
  readonly accountId: string;
  readonly friendId: string;
  readonly templateId: string;
  readonly automation: FakeAutomation;
  readonly scheduler: TaskScheduler;
  setClock(value: Date): void;
}

const directory = await mkdtemp(path.join(tmpdir(), 'sparkkeeper-retry-smoke-'));
const databasePath = path.join(directory, 'sparkkeeper.db');
let client: DatabaseClient = createDatabase({ databasePath });

try {
  assert.equal(client.migrate().appliedMigrationCount, 8);

  const alice = createScenario(client, 'Test Account A', 'Alice', {
    openResults: [failedOpen('NETWORK_TRANSIENT'), { status: 'VERIFIED' }],
  });
  assert.equal(await alice.scheduler.tick(), 'TRIGGERED');
  let record = findRecord(client, alice.friendId);
  assert.equal(record.status, 'RETRY_WAIT');
  assert.equal(record.attemptCount, 1);
  const aliceStartsBeforeEarlyTick = alice.automation.starts;
  alice.setClock(new Date('2026-08-23T11:30:59.000Z'));
  await alice.scheduler.tick();
  assert.equal(alice.automation.starts, aliceStartsBeforeEarlyTick);
  assert.equal(findRecord(client, alice.friendId).attemptCount, 1);
  alice.setClock(new Date('2026-08-23T11:31:00.000Z'));
  assert.equal(await alice.scheduler.tick(), 'TRIGGERED');
  record = findRecord(client, alice.friendId);
  assert.equal(record.status, 'SUCCESS');
  assert.equal(record.attemptCount, 2);

  const bob = createScenario(client, 'Test Account B', 'Bob', {
    openResults: [
      failedOpen('NETWORK_TRANSIENT'),
      failedOpen('NETWORK_TRANSIENT'),
      failedOpen('NETWORK_TRANSIENT'),
    ],
  });
  assert.equal(await bob.scheduler.tick(), 'TRIGGERED');
  bob.setClock(new Date('2026-08-23T11:31:00.000Z'));
  assert.equal(await bob.scheduler.tick(), 'TRIGGERED');
  bob.setClock(new Date('2026-08-23T11:32:00.000Z'));
  assert.equal(await bob.scheduler.tick(), 'TRIGGERED');
  record = findRecord(client, bob.friendId);
  assert.equal(record.status, 'FAILED');
  assert.equal(record.attemptCount, 3);
  assert.equal(record.lastErrorCode, 'MAX_ATTEMPTS_EXHAUSTED');

  const charlie = createScenario(client, 'Test Account C', 'Charlie', {
    sendResults: [
      {
        status: 'DELIVERY_UNKNOWN',
        failureCode: 'VERIFY_FAILED',
        sendAction: 'UNKNOWN',
      },
    ],
  });
  assert.equal(await charlie.scheduler.tick(), 'TRIGGERED');
  record = findRecord(client, charlie.friendId);
  assert.equal(record.status, 'DELIVERY_UNKNOWN');
  assert.equal(record.attemptCount, 1);
  charlie.setClock(new Date('2026-08-23T11:31:00.000Z'));
  assert.equal(await charlie.scheduler.tick(), 'SKIPPED');
  assert.equal(charlie.automation.sends, 1);

  const crash = createCrashScenario(client);
  client.close();
  client = createDatabase({ databasePath });
  assert.equal(client.migrate().appliedMigrationCount, 8);
  assert.equal(findRecord(client, alice.friendId).status, 'SUCCESS');
  assert.equal(findRecord(client, bob.friendId).status, 'FAILED');
  assert.equal(findRecord(client, charlie.friendId).status, 'DELIVERY_UNKNOWN');

  const crashAutomation = new FakeAutomation();
  const crashRunner = createRunner(
    client,
    crash.accountId,
    crash.templateId,
    crashAutomation,
    () => start,
  );
  assert.equal(await crashRunner.run(crash.accountId, businessDate), 'FAILED');
  const recoveredBefore = new SendRecordRepository(client).findById(crash.beforeRecordId);
  const recoveredAfter = new SendRecordRepository(client).findById(crash.afterRecordId);
  assert.equal(recoveredBefore?.status, 'RETRY_WAIT');
  assert.equal(recoveredBefore?.attemptCount, 1);
  assert.equal(recoveredAfter?.status, 'DELIVERY_UNKNOWN');
  assert.equal(recoveredAfter?.attemptCount, 1);
  assert.equal(crashAutomation.starts, 0);
  assert.equal(crashAutomation.sends, 0);

  console.log('Retry policy: VERIFIED');
  console.log('Attempt counting: VERIFIED');
  console.log('Retry wait: VERIFIED');
  console.log('Due retry claim: VERIFIED');
  console.log('Max attempts: VERIFIED');
  console.log('Delivery uncertainty guard: VERIFIED');
  console.log('Restart recovery: VERIFIED');
  console.log('Retry smoke: VERIFIED');
} finally {
  client.close();
  await rm(directory, { recursive: true, force: true });
}

function createScenario(
  database: DatabaseClient,
  accountName: string,
  friendName: string,
  results: {
    readonly openResults?: ContactOpenResult[];
    readonly sendResults?: AutomationSendResult[];
  },
): Scenario {
  const accounts = new AccountRepository(database);
  const schedules = new ScheduleRepository(database);
  const friends = new FriendRepository(database);
  const templates = new MessageTemplateRepository(database);
  const account = accounts.create({ name: accountName, loginStatus: 'READY' });
  const friend = friends.create({ accountId: account.id, displayName: friendName });
  const template = templates.create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Test message'],
  });
  schedules.create({
    accountId: account.id,
    startTime: '19:30',
    endTime: '21:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 3,
    retryIntervalSeconds: 60,
    now: start,
  });
  const automation = new FakeAutomation(results.openResults, results.sendResults);
  let clock = start;
  const runner = createRunner(database, account.id, template.id, automation, () => clock);
  return {
    accountId: account.id,
    friendId: friend.id,
    templateId: template.id,
    automation,
    scheduler: new TaskScheduler(account.id, schedules, runner, { now: () => clock }),
    setClock(value: Date) {
      clock = value;
    },
  };
}

function createCrashScenario(database: DatabaseClient) {
  const accounts = new AccountRepository(database);
  const schedules = new ScheduleRepository(database);
  const friends = new FriendRepository(database);
  const templates = new MessageTemplateRepository(database);
  const runs = new DailyRunRepository(database);
  const records = new SendRecordRepository(database);
  const account = accounts.create({ name: 'Test Account D', loginStatus: 'READY' });
  const beforeFriend = friends.create({ accountId: account.id, displayName: 'Test User A' });
  const afterFriend = friends.create({ accountId: account.id, displayName: 'Test User B' });
  const template = templates.create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Test message'],
  });
  schedules.create({
    accountId: account.id,
    startTime: '19:30',
    endTime: '21:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 3,
    retryIntervalSeconds: 60,
    now: start,
  });
  const run = runs.createOrGet({ accountId: account.id, businessDate, now: start });
  runs.markRunning(run.id, start);
  const before = records.prepare({
    dailyRunId: run.id,
    friendId: beforeFriend.id,
    businessDate,
    messageTemplateId: template.id,
    messageText: 'Test message',
    now: start,
  }).record;
  const after = records.prepare({
    dailyRunId: run.id,
    friendId: afterFriend.id,
    businessDate,
    messageTemplateId: template.id,
    messageText: 'Test message',
    now: start,
  }).record;
  assert.equal(records.claimInitialAttempt(before.id, start, 3).type, 'CLAIMED');
  assert.equal(records.claimInitialAttempt(after.id, start, 3).type, 'CLAIMED');
  records.markSendActionStarted(after.id, new Date(start.getTime() + 1_000));
  return {
    accountId: account.id,
    templateId: template.id,
    beforeRecordId: before.id,
    afterRecordId: after.id,
  };
}

function createRunner(
  database: DatabaseClient,
  accountId: string,
  templateId: string,
  automation: DailyTaskAutomation,
  now: () => Date,
): DailyTaskRunner {
  return new DailyTaskRunner({
    accountId,
    messageTemplateId: templateId,
    allowRealSend: true,
    automation,
    accounts: new AccountRepository(database),
    schedules: new ScheduleRepository(database),
    friends: new FriendRepository(database),
    templates: new MessageTemplateRepository(database),
    dailyRuns: new DailyRunRepository(database),
    sendRecords: new SendRecordRepository(database),
    now,
  });
}

function failedOpen(failureCode: RetryFailureCode): ContactOpenResult {
  return { status: 'FAILED', failureCode };
}

function findRecord(database: DatabaseClient, friendId: string): SendRecord {
  const record = new SendRecordRepository(database).findByFriendAndBusinessDate(
    friendId,
    businessDate,
  );
  assert.ok(record);
  return record;
}
