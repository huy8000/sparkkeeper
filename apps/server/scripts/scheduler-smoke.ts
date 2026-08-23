import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AccountRepository, createDatabase, ScheduleRepository } from '@sparkkeeper/database';
import type { BusinessDate } from '@sparkkeeper/shared';

import { TaskScheduler } from '../src/scheduler/TaskScheduler.js';

const directory = await mkdtemp(path.join(tmpdir(), 'sparkkeeper-scheduler-smoke-'));
const databasePath = path.join(directory, 'sparkkeeper.db');
let client = createDatabase({ databasePath });
try {
  assert.equal(client.migrate().appliedMigrationCount, 5);
  const account = new AccountRepository(client).create({
    name: 'Test Account',
    loginStatus: 'READY',
  });
  const schedule = new ScheduleRepository(client).create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Asia/Shanghai',
    now: new Date('2026-08-23T01:00:00Z'),
  });
  client.close();
  client = createDatabase({ databasePath });
  assert.equal(client.migrate().appliedMigrationCount, 5);
  assert.equal(new ScheduleRepository(client).findById(schedule.id)?.accountId, account.id);
  const calls: BusinessDate[] = [];
  const scheduler = new TaskScheduler(
    account.id,
    new ScheduleRepository(client),
    {
      run: async (_accountId, date) => {
        calls.push(date);
      },
    },
    { now: () => new Date('2026-08-23T01:30:00Z') },
  );
  assert.equal(await scheduler.tick(), 'TRIGGERED');
  assert.equal(await scheduler.tick(), 'SKIPPED');
  assert.deepEqual(calls, ['2026-08-23']);
  console.log(
    JSON.stringify({
      freshMigration: 'PASS',
      repeatedMigration: 'PASS',
      schedulePersistence: 'PASS',
      windowEvaluation: 'PASS',
      duplicateTick: 'BLOCKED',
      fakeAutomation: 'PASS',
      realSend: 'NONE',
      networkAccess: 'NONE',
    }),
  );
} finally {
  client.close();
  await rm(directory, { recursive: true, force: true });
}
