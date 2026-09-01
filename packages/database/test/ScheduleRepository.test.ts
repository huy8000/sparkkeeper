import assert from 'node:assert/strict';
import test from 'node:test';
import { eq } from 'drizzle-orm';

import {
  AccountRepository,
  accounts,
  createDatabase,
  ScheduleRepository,
  ScheduleRepositoryError,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

const now = new Date('2026-08-23T00:00:00.000Z');
const later = new Date('2026-08-23T01:00:00.000Z');

function fixture(context: Parameters<typeof createTemporaryDatabase>[0]) {
  const temporary = createTemporaryDatabase(context);
  const accounts = new AccountRepository(temporary.client);
  const account = accounts.create({ name: 'Test Account', loginStatus: 'READY', now });
  return { ...temporary, account, repository: new ScheduleRepository(temporary.client) };
}

test('creates and finds a Schedule by id and Account', (context) => {
  const { account, repository } = fixture(context);
  const schedule = repository.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:30',
    timezone: 'Asia/Shanghai',
    now,
  });
  assert.equal(schedule.enabled, true);
  assert.equal(schedule.maxAttempts, 3);
  assert.equal(schedule.retryIntervalSeconds, 60);
  assert.equal(repository.findById(schedule.id)?.startTime, '09:00');
  assert.equal(repository.findByAccountId(account.id)?.id, schedule.id);
  assert.equal(schedule.createdAt.getTime(), now.getTime());
});

test('lists schedules and filters disabled schedules', (context) => {
  const { client, account, repository } = fixture(context);
  const second = new AccountRepository(client).create({
    name: 'Second Account',
    loginStatus: 'UNKNOWN',
    now,
  });
  repository.create({ accountId: account.id, startTime: '09:00', endTime: '10:00', now });
  repository.create({
    accountId: second.id,
    startTime: '11:00',
    endTime: '12:00',
    enabled: false,
    now,
  });
  assert.equal(repository.list().length, 2);
  assert.deepEqual(
    repository.listEnabled().map((item) => item.accountId),
    [account.id],
  );
});

test('updates the complete window, timezone, enabled flag and timestamp', (context) => {
  const { account, repository } = fixture(context);
  const schedule = repository.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    now,
  });
  const updated = repository.update(schedule.id, {
    startTime: '13:00',
    endTime: '14:00',
    timezone: 'UTC',
    enabled: false,
    now: later,
  });
  assert.equal(updated?.startTime, '13:00');
  assert.equal(updated?.endTime, '14:00');
  assert.equal(updated?.timezone, 'UTC');
  assert.equal(updated?.enabled, false);
  assert.equal(updated?.updatedAt.getTime(), later.getTime());
});

test('creates and updates bounded retry configuration', (context) => {
  const { account, repository } = fixture(context);
  const schedule = repository.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    maxAttempts: 5,
    retryIntervalSeconds: 30,
    now,
  });
  assert.equal(schedule.maxAttempts, 5);
  assert.equal(schedule.retryIntervalSeconds, 30);

  const updated = repository.update(schedule.id, {
    maxAttempts: 2,
    retryIntervalSeconds: 120,
    now: later,
  });
  assert.equal(updated?.maxAttempts, 2);
  assert.equal(updated?.retryIntervalSeconds, 120);
});

test('rejects unbounded Attempt and retry interval configuration', (context) => {
  const { account, repository } = fixture(context);
  for (const retry of [
    { maxAttempts: 0 },
    { maxAttempts: 6 },
    { retryIntervalSeconds: 0 },
    { retryIntervalSeconds: 86_401 },
  ]) {
    assert.throws(
      () =>
        repository.create({
          accountId: account.id,
          startTime: '09:00',
          endTime: '10:00',
          ...retry,
          now,
        }),
      (error: unknown) =>
        error instanceof ScheduleRepositoryError && error.code === 'INVALID_RETRY_CONFIG',
    );
  }
});

test('returns undefined for missing find and update', (context) => {
  const { repository } = fixture(context);
  assert.equal(repository.findById('missing'), undefined);
  assert.equal(repository.findByAccountId('missing'), undefined);
  assert.equal(repository.update('missing', { enabled: false, now }), undefined);
});

for (const [startTime, endTime, code] of [
  ['9:00', '10:00', 'INVALID_TIME'],
  ['24:00', '25:00', 'INVALID_TIME'],
  ['10:00', '10:00', 'INVALID_WINDOW'],
  ['22:00', '06:00', 'INVALID_WINDOW'],
] as const) {
  test(`rejects invalid schedule window ${startTime}-${endTime}`, (context) => {
    const { account, repository } = fixture(context);
    assert.throws(
      () => repository.create({ accountId: account.id, startTime, endTime, now }),
      (error: unknown) => error instanceof ScheduleRepositoryError && error.code === code,
    );
  });
}

test('rejects invalid timezone and timestamp', (context) => {
  const { account, repository } = fixture(context);
  assert.throws(
    () =>
      repository.create({
        accountId: account.id,
        startTime: '09:00',
        endTime: '10:00',
        timezone: 'Not/AZone',
        now,
      }),
    (error: unknown) =>
      error instanceof ScheduleRepositoryError && error.code === 'INVALID_TIMEZONE',
  );
  assert.throws(
    () =>
      repository.create({
        accountId: account.id,
        startTime: '09:00',
        endTime: '10:00',
        now: new Date(Number.NaN),
      }),
    (error: unknown) =>
      error instanceof ScheduleRepositoryError && error.code === 'INVALID_TIMESTAMP',
  );
});

test('defaults timezone to the shared application timezone', (context) => {
  const { account, repository } = fixture(context);
  assert.equal(
    repository.create({ accountId: account.id, startTime: '09:00', endTime: '10:00', now })
      .timezone,
    'Asia/Shanghai',
  );
});

test('enforces one schedule per Account', (context) => {
  const { account, repository } = fixture(context);
  repository.create({ accountId: account.id, startTime: '09:00', endTime: '10:00', now });
  assert.throws(
    () => repository.create({ accountId: account.id, startTime: '11:00', endTime: '12:00', now }),
    (error: unknown) =>
      error instanceof ScheduleRepositoryError && error.code === 'DATABASE_OPERATION_FAILED',
  );
});

test('enforces Account foreign key and cascades deletion', (context) => {
  const { client, account, repository } = fixture(context);
  assert.throws(
    () => repository.create({ accountId: 'missing', startTime: '09:00', endTime: '10:00', now }),
    (error: unknown) =>
      error instanceof ScheduleRepositoryError && error.code === 'ACCOUNT_NOT_FOUND',
  );
  const schedule = repository.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    now,
  });
  client.orm.delete(accounts).where(eq(accounts.id, account.id)).run();
  assert.equal(repository.findById(schedule.id), undefined);
});

test('persists Schedule through close, reopen and repeated migrate', (context) => {
  const temporary = createTemporaryDatabase(context);
  const account = new AccountRepository(temporary.client).create({
    name: 'Persistence Account',
    loginStatus: 'READY',
    now,
  });
  const schedule = new ScheduleRepository(temporary.client).create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    now,
  });
  temporary.client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 9);
  assert.equal(new ScheduleRepository(reopened).findById(schedule.id)?.accountId, account.id);
});
