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
import { parseBusinessDate, parseScheduleTime } from '@sparkkeeper/shared';

import type {
  AutomationAuthResult,
  AutomationSendResult,
  ContactOpenResult,
  DailyTaskAutomation,
} from '../src/application/DailyTaskAutomation.js';
import { DailyTaskRunner } from '../src/application/DailyTaskRunner.js';
import { resolveSchedulerConfig } from '../src/config/SchedulerConfig.js';
import { evaluateScheduleWindow } from '../src/scheduler/ScheduleWindow.js';
import { TaskScheduler, type SchedulerTimer } from '../src/scheduler/TaskScheduler.js';

const businessDate = parseBusinessDate('2026-08-23');
const fixedNow = new Date('2026-08-23T01:30:00.000Z'); // 09:30 Asia/Shanghai

class FakeAutomation implements DailyTaskAutomation {
  auth: AutomationAuthResult = 'READY';
  open: ContactOpenResult = 'VERIFIED';
  send: AutomationSendResult = { status: 'SUCCESS', sendAttemptCount: 1 };
  starts = 0;
  closes = 0;
  opens: string[] = [];
  sends: string[] = [];
  async start() {
    this.starts += 1;
  }
  async checkAuth() {
    return this.auth;
  }
  async resolveAndOpen(friend: Friend) {
    this.opens.push(friend.displayName);
    return this.open;
  }
  async sendAndVerify(friend: Friend, record: SendRecord) {
    this.sends.push(`${friend.displayName}:${record.messageText}`);
    return this.send;
  }
  async close() {
    this.closes += 1;
  }
}

function databaseFixture(context: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-scheduler-test-'));
  const client = createDatabase({ databasePath: path.join(directory, 'sparkkeeper.db') });
  client.migrate();
  context.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return client;
}

function runnerFixture(context: TestContext, friendCount = 2) {
  const client = databaseFixture(context);
  const accounts = new AccountRepository(client);
  const schedules = new ScheduleRepository(client);
  const friends = new FriendRepository(client);
  const templates = new MessageTemplateRepository(client);
  const dailyRuns = new DailyRunRepository(client);
  const sendRecords = new SendRecordRepository(client);
  const account = accounts.create({ name: 'Test Account', loginStatus: 'READY' });
  schedules.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Asia/Shanghai',
    now: fixedNow,
  });
  for (let index = 0; index < friendCount; index += 1) {
    friends.create({ accountId: account.id, displayName: `Test User ${index + 1}`, enabled: true });
  }
  const template = templates.create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  const automation = new FakeAutomation();
  const runner = new DailyTaskRunner({
    accountId: account.id,
    messageTemplateId: template.id,
    allowRealSend: true,
    automation,
    accounts,
    schedules,
    friends,
    templates,
    dailyRuns,
    sendRecords,
    now: () => fixedNow,
  });
  return {
    client,
    account,
    template,
    automation,
    runner,
    accounts,
    schedules,
    friends,
    templates,
    dailyRuns,
    sendRecords,
  };
}

test('schedule window is inclusive at start and exclusive at end', () => {
  const start = parseScheduleTime('09:00');
  const end = parseScheduleTime('10:00');
  assert.equal(
    evaluateScheduleWindow(new Date('2026-08-23T01:00:00Z'), 'Asia/Shanghai', start, end).position,
    'IN_WINDOW',
  );
  assert.equal(
    evaluateScheduleWindow(new Date('2026-08-23T02:00:00Z'), 'Asia/Shanghai', start, end).position,
    'AFTER_WINDOW',
  );
});

test('schedule window uses configured timezone and resolves business date', () => {
  const result = evaluateScheduleWindow(
    new Date('2026-08-22T16:30:00Z'),
    'Asia/Shanghai',
    parseScheduleTime('00:00'),
    parseScheduleTime('01:00'),
  );
  assert.equal(result.position, 'IN_WINDOW');
  assert.equal(result.businessDate, '2026-08-23');
  assert.equal(result.localTime, '00:30');
});

test('scheduler config is disabled and unauthorized by default', () => {
  assert.deepEqual(resolveSchedulerConfig({}), {
    enabled: false,
    allowRealSend: false,
    accountId: undefined,
    messageTemplateId: undefined,
  });
});

test('scheduler config requires explicit Account and real-send Template', () => {
  assert.throws(() => resolveSchedulerConfig({ SCHEDULER_ENABLED: 'true' }), /ACCOUNT_ID/);
  assert.throws(
    () =>
      resolveSchedulerConfig({
        SCHEDULER_ENABLED: 'true',
        SCHEDULER_ACCOUNT_ID: 'account',
        SCHEDULER_ALLOW_REAL_SEND: 'true',
      }),
    /MESSAGE_TEMPLATE_ID/,
  );
  assert.throws(() => resolveSchedulerConfig({ SCHEDULER_ENABLED: 'yes' }), /true or false/);
});

test('scheduler triggers once per business date and ignores repeated ticks', async () => {
  let calls = 0;
  const schedule = {
    accountId: 'account',
    enabled: true,
    timezone: 'Asia/Shanghai',
    startTime: parseScheduleTime('09:00'),
    endTime: parseScheduleTime('10:00'),
  };
  const scheduler = new TaskScheduler(
    'account',
    { findByAccountId: () => schedule } as never,
    {
      run: async () => {
        calls += 1;
      },
    },
    { now: () => fixedNow },
  );
  assert.equal(await scheduler.tick(), 'TRIGGERED');
  assert.equal(await scheduler.tick(), 'SKIPPED');
  assert.equal(calls, 1);
});

test('scheduler skips missing, disabled and out-of-window schedules', async () => {
  let calls = 0;
  const runner = {
    run: async () => {
      calls += 1;
    },
  };
  assert.equal(
    await new TaskScheduler('a', { findByAccountId: () => undefined }, runner).tick(),
    'SKIPPED',
  );
  const disabled = {
    accountId: 'a',
    enabled: false,
    timezone: 'UTC',
    startTime: parseScheduleTime('00:00'),
    endTime: parseScheduleTime('23:59'),
  };
  assert.equal(
    await new TaskScheduler('a', { findByAccountId: () => disabled } as never, runner).tick(),
    'SKIPPED',
  );
  const outside = {
    ...disabled,
    enabled: true,
    startTime: parseScheduleTime('09:00'),
    endTime: parseScheduleTime('10:00'),
  };
  assert.equal(
    await new TaskScheduler('a', { findByAccountId: () => outside } as never, runner, {
      now: () => new Date('2026-08-23T12:00:00Z'),
    }).tick(),
    'SKIPPED',
  );
  assert.equal(calls, 0);
});

test('scheduler prevents overlapping ticks', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const schedule = {
    accountId: 'a',
    enabled: true,
    timezone: 'Asia/Shanghai',
    startTime: parseScheduleTime('09:00'),
    endTime: parseScheduleTime('10:00'),
  };
  const scheduler = new TaskScheduler(
    'a',
    { findByAccountId: () => schedule } as never,
    { run: async () => blocked },
    { now: () => fixedNow },
  );
  const first = scheduler.tick();
  assert.equal(await scheduler.tick(), 'SKIPPED');
  release();
  assert.equal(await first, 'TRIGGERED');
});

test('scheduler start installs one timer and stop clears it', async () => {
  let installed = 0;
  let cleared = 0;
  const timer: SchedulerTimer = {
    setInterval: () => {
      installed += 1;
      return 'timer';
    },
    clearInterval: () => {
      cleared += 1;
    },
  };
  const scheduler = new TaskScheduler(
    'a',
    { findByAccountId: () => undefined },
    { run: async () => undefined },
    { now: () => fixedNow },
    timer,
  );
  scheduler.start();
  scheduler.start();
  await scheduler.stop();
  assert.equal(installed, 1);
  assert.equal(cleared, 1);
});

test('started scheduler routes trigger failures to its bounded error handler', async () => {
  const errors: unknown[] = [];
  const timer: SchedulerTimer = { setInterval: () => 'timer', clearInterval: () => undefined };
  const schedule = {
    accountId: 'a',
    enabled: true,
    timezone: 'Asia/Shanghai',
    startTime: parseScheduleTime('09:00'),
    endTime: parseScheduleTime('10:00'),
  };
  const scheduler = new TaskScheduler(
    'a',
    { findByAccountId: () => schedule } as never,
    {
      run: async () => {
        throw new Error('controlled failure');
      },
    },
    { now: () => fixedNow },
    timer,
    60_000,
    (error) => errors.push(error),
  );
  scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await scheduler.stop();
  assert.equal(errors.length, 1);
});

test('DailyTaskRunner sends enabled Friends sequentially and closes one browser', async (context) => {
  const fixture = runnerFixture(context);
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SUCCESS');
  assert.deepEqual(
    fixture.automation.sends,
    fixture.friends
      .listEnabledByAccountId(fixture.account.id)
      .map((friend) => `${friend.displayName}:Hello`),
  );
  assert.equal(fixture.automation.starts, 1);
  assert.equal(fixture.automation.closes, 1);
  assert.equal(
    fixture.dailyRuns.findByAccountAndBusinessDate(fixture.account.id, businessDate)?.status,
    'SUCCESS',
  );
});

test('DailyTaskRunner zero enabled Friends is a successful no-op', async (context) => {
  const fixture = runnerFixture(context, 0);
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SUCCESS');
  assert.deepEqual(fixture.automation.sends, []);
});

test('DailyTaskRunner skips a completed DailyRun without browser startup', async (context) => {
  const fixture = runnerFixture(context, 0);
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SUCCESS');
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SKIPPED');
  assert.equal(fixture.automation.starts, 1);
});

test('DailyTaskRunner rejects unauthorized execution before browser startup', async (context) => {
  const fixture = runnerFixture(context);
  const runner = new DailyTaskRunner({
    accountId: fixture.account.id,
    messageTemplateId: fixture.template.id,
    allowRealSend: false,
    automation: fixture.automation,
    accounts: fixture.accounts,
    schedules: fixture.schedules,
    friends: fixture.friends,
    templates: fixture.templates,
    dailyRuns: fixture.dailyRuns,
    sendRecords: fixture.sendRecords,
  });
  await assert.rejects(() => runner.run(fixture.account.id, businessDate), /not authorized/);
  assert.equal(fixture.automation.starts, 0);
});

test('AUTH_EXPIRED updates Account and DailyRun and closes browser', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.auth = 'AUTH_EXPIRED';
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'AUTH_EXPIRED');
  assert.equal(fixture.accounts.findById(fixture.account.id)?.loginStatus, 'AUTH_EXPIRED');
  assert.equal(
    fixture.dailyRuns.findByAccountAndBusinessDate(fixture.account.id, businessDate)?.status,
    'AUTH_EXPIRED',
  );
  assert.equal(fixture.automation.closes, 1);
});

test('UNKNOWN auth fails DailyRun without resolving or sending', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.auth = 'UNKNOWN';
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  assert.deepEqual(fixture.automation.opens, []);
  assert.deepEqual(fixture.automation.sends, []);
});

test('contact resolution failure marks snapshot FAILED before any send', async (context) => {
  const fixture = runnerFixture(context, 1);
  fixture.automation.open = 'AMBIGUOUS';
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  const records = fixture.sendRecords.listByFriendId(
    fixture.friends.listByAccountId(fixture.account.id)[0]!.id,
  );
  assert.equal(records[0]?.status, 'FAILED');
  assert.deepEqual(fixture.automation.sends, []);
});

test('DELIVERY_UNKNOWN stops later Friends and is never retried', async (context) => {
  const fixture = runnerFixture(context);
  fixture.automation.send = { status: 'DELIVERY_UNKNOWN', sendAttemptCount: 1 };
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  assert.equal(fixture.automation.sends.length, 1);
  assert.equal(
    fixture.sendRecords.listByDailyRunId(
      fixture.dailyRuns.findByAccountAndBusinessDate(fixture.account.id, businessDate)!.id,
    )[0]?.status,
    'DELIVERY_UNKNOWN',
  );
});

test('RUNNING SendRecord recovery is blocked and other Friends continue safely', async (context) => {
  const fixture = runnerFixture(context);
  const run = fixture.dailyRuns.createOrGet({
    accountId: fixture.account.id,
    businessDate,
    now: fixedNow,
  });
  fixture.dailyRuns.markRunning(run.id, fixedNow);
  const allFriends = fixture.friends.listByAccountId(fixture.account.id);
  const first = allFriends[0]!;
  const remaining = allFriends[1]!;
  const prepared = fixture.sendRecords.prepare({
    dailyRunId: run.id,
    friendId: first.id,
    businessDate,
    messageTemplateId: fixture.template.id,
    messageText: 'Snapshot',
    now: fixedNow,
  });
  fixture.sendRecords.claimForExecution(prepared.record.id, fixedNow);
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'FAILED');
  assert.equal(fixture.sendRecords.findById(prepared.record.id)?.status, 'RUNNING');
  assert.deepEqual(fixture.automation.sends, [`${remaining.displayName}:Hello`]);
});

test('READY SendRecord reuses persisted message snapshot', async (context) => {
  const fixture = runnerFixture(context, 1);
  const run = fixture.dailyRuns.createOrGet({
    accountId: fixture.account.id,
    businessDate,
    now: fixedNow,
  });
  const friend = fixture.friends.listByAccountId(fixture.account.id)[0]!;
  fixture.sendRecords.prepare({
    dailyRunId: run.id,
    friendId: friend.id,
    businessDate,
    messageTemplateId: fixture.template.id,
    messageText: 'Persisted Snapshot',
    now: fixedNow,
  });
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SUCCESS');
  assert.deepEqual(fixture.automation.sends, ['Test User 1:Persisted Snapshot']);
});

test('SUCCESS SendRecord is idempotently skipped during RUNNING recovery', async (context) => {
  const fixture = runnerFixture(context, 1);
  const run = fixture.dailyRuns.createOrGet({
    accountId: fixture.account.id,
    businessDate,
    now: fixedNow,
  });
  fixture.dailyRuns.markRunning(run.id, fixedNow);
  const friend = fixture.friends.listByAccountId(fixture.account.id)[0]!;
  const record = fixture.sendRecords.prepare({
    dailyRunId: run.id,
    friendId: friend.id,
    businessDate,
    messageTemplateId: fixture.template.id,
    messageText: 'Snapshot',
    now: fixedNow,
  }).record;
  fixture.sendRecords.claimForExecution(record.id, fixedNow);
  fixture.sendRecords.markSuccess(record.id, fixedNow);
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SUCCESS');
  assert.deepEqual(fixture.automation.sends, []);
});

test('disabled Friends are excluded from execution', async (context) => {
  const fixture = runnerFixture(context, 1);
  fixture.friends.update(fixture.friends.listByAccountId(fixture.account.id)[0]!.id, {
    enabled: false,
  });
  assert.equal(await fixture.runner.run(fixture.account.id, businessDate), 'SUCCESS');
  assert.deepEqual(fixture.automation.sends, []);
});
