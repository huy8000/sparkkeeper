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
} from '@sparkkeeper/database';

import type { DailyTaskAutomation } from '../src/application/DailyTaskAutomation.js';
import { DailyTaskRunner } from '../src/application/DailyTaskRunner.js';
import { TaskScheduler } from '../src/scheduler/TaskScheduler.js';

class SmokeAutomation implements DailyTaskAutomation {
  sendCount = 0;
  startCount = 0;
  closeCount = 0;
  async start() {
    this.startCount += 1;
  }
  async checkAuth() {
    return 'READY' as const;
  }
  async resolveAndOpen() {
    return { status: 'VERIFIED' as const };
  }
  async sendAndVerify() {
    this.sendCount += 1;
    return { status: 'SUCCESS' as const, sendAction: 'TRIGGERED' as const };
  }
  async close() {
    this.closeCount += 1;
  }
}

const directory = await mkdtemp(path.join(tmpdir(), 'sparkkeeper-scheduler-smoke-'));
const databasePath = path.join(directory, 'sparkkeeper.db');
let client: DatabaseClient = createDatabase({ databasePath });

try {
  assert.equal(client.migrate().appliedMigrationCount, 8);
  const account = new AccountRepository(client).create({
    name: 'Test Account',
    loginStatus: 'READY',
  });
  const friends = new FriendRepository(client);
  friends.create({ accountId: account.id, displayName: 'Alice' });
  friends.create({ accountId: account.id, displayName: 'Bob' });
  const template = new MessageTemplateRepository(client).create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Test message'],
  });
  const schedules = new ScheduleRepository(client);
  const schedule = schedules.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Asia/Shanghai',
    now: new Date('2026-08-23T01:00:00Z'),
  });
  const firstAutomation = new SmokeAutomation();
  let clock = new Date('2026-08-23T01:30:00Z');
  const firstRunner = createRunner(client, account.id, template.id, firstAutomation, () => clock);
  const firstScheduler = new TaskScheduler(account.id, schedules, firstRunner, {
    now: () => clock,
  });
  assert.equal(await firstScheduler.tick(), 'TRIGGERED');
  assert.equal(await firstScheduler.tick(), 'SKIPPED');
  assert.equal(firstAutomation.sendCount, 2);
  assert.equal(firstAutomation.startCount, 1);
  assert.equal(firstAutomation.closeCount, 1);

  client.close();
  client = createDatabase({ databasePath });
  assert.equal(client.migrate().appliedMigrationCount, 8);
  assert.equal(new ScheduleRepository(client).findById(schedule.id)?.accountId, account.id);
  const restartAutomation = new SmokeAutomation();
  const restartRunner = createRunner(
    client,
    account.id,
    template.id,
    restartAutomation,
    () => clock,
  );
  const restartedScheduler = new TaskScheduler(
    account.id,
    new ScheduleRepository(client),
    restartRunner,
    { now: () => clock },
  );
  assert.equal(await restartedScheduler.tick(), 'SKIPPED');
  assert.equal(restartAutomation.sendCount, 0);

  clock = new Date('2026-08-24T01:30:00Z');
  assert.equal(await restartedScheduler.tick(), 'TRIGGERED');
  assert.equal(restartAutomation.sendCount, 2);
  assert.equal(new DailyRunRepository(client).listByAccountId(account.id).length, 2);
  const firstFriend = new FriendRepository(client).listByAccountId(account.id)[0]!;
  assert.equal(new SendRecordRepository(client).listByFriendId(firstFriend.id).length, 2);

  console.log(
    JSON.stringify({
      scheduleWindow: 'VERIFIED',
      dailyTrigger: 'VERIFIED',
      sameDayIdempotency: 'VERIFIED',
      restartRecovery: 'VERIFIED',
      nextDayTrigger: 'VERIFIED',
      freshMigration: 'PASS',
      repeatedMigration: 'PASS',
      closeReopen: 'PASS',
      fakeAutomation: 'PASS',
      schedulerSmoke: 'VERIFIED',
      realSend: 'NONE',
      networkAccess: 'NONE',
    }),
  );
} finally {
  client.close();
  await rm(directory, { recursive: true, force: true });
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
