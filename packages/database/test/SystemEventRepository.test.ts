import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { parseBusinessDate } from '@sparkkeeper/shared';
import { eq } from 'drizzle-orm';

import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  dailyRuns,
  FriendRepository,
  friends,
  MAX_SYSTEM_EVENT_LIMIT,
  SystemEventRepository,
  SystemEventRepositoryError,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

function createContext(context: TestContext) {
  const temporary = createTemporaryDatabase(context);
  const account = new AccountRepository(temporary.client).create({ name: 'Test Account' });
  const friend = new FriendRepository(temporary.client).create({
    accountId: account.id,
    displayName: 'Test User',
  });
  const run = new DailyRunRepository(temporary.client).createOrGet({
    accountId: account.id,
    businessDate: parseBusinessDate('2026-08-23'),
    now: new Date('2026-08-23T10:00:00.000Z'),
  });
  return { ...temporary, account, friend, run };
}

test('creates and finds a fully contextual SystemEvent', (context) => {
  const fixture = createContext(context);
  const repository = new SystemEventRepository(fixture.client);
  const created = repository.create({
    eventType: 'SELECTOR_FAILURE',
    level: 'ERROR',
    runId: fixture.run.id,
    accountId: fixture.account.id,
    friendId: fixture.friend.id,
    attempt: 2,
    errorCode: 'SELECTOR_FAILURE',
    message: 'Selector resolution failed',
    screenshotPath: `screenshots/2026-08-23/${fixture.run.id}/selector-failure.png`,
    tracePath: `traces/2026-08-23/${fixture.run.id}/failure.zip`,
    now: new Date('2026-08-23T10:01:00.000Z'),
  });

  assert.equal(repository.findById(created.id)?.eventType, 'SELECTOR_FAILURE');
  assert.equal(created.runId, fixture.run.id);
  assert.equal(created.accountId, fixture.account.id);
  assert.equal(created.friendId, fixture.friend.id);
  assert.equal(created.attempt, 2);
  assert.equal(created.errorCode, 'SELECTOR_FAILURE');
  assert.equal(
    created.screenshotPath,
    `screenshots/2026-08-23/${fixture.run.id}/selector-failure.png`,
  );
  assert.equal(created.tracePath, `traces/2026-08-23/${fixture.run.id}/failure.zip`);
  assert.equal(created.createdAt.toISOString(), '2026-08-23T10:01:00.000Z');
});

test('supports a system-level event without Run, Account, or Friend', (context) => {
  const { client } = createTemporaryDatabase(context);
  const created = new SystemEventRepository(client).create({
    eventType: 'OBSERVABILITY_ERROR',
    level: 'ERROR',
    message: 'Evidence capture unavailable',
  });

  assert.equal(created.runId, null);
  assert.equal(created.accountId, null);
  assert.equal(created.friendId, null);
});

test('lists recent events newest-first with an explicit limit', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new SystemEventRepository(client);
  for (let index = 0; index < 3; index += 1) {
    repository.create({
      eventType: 'TASK_FAILED',
      level: 'ERROR',
      message: `Safe failure ${index}`,
      now: new Date(Date.parse('2026-08-23T10:00:00.000Z') + index),
    });
  }

  assert.deepEqual(
    repository.listRecent(2).map((event) => event.message),
    ['Safe failure 2', 'Safe failure 1'],
  );
});

test('rejects unbounded or invalid recent-event limits', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new SystemEventRepository(client);

  assert.throws(() => repository.listRecent(0), SystemEventRepositoryError);
  assert.throws(
    () => repository.listRecent(MAX_SYSTEM_EVENT_LIMIT + 1),
    SystemEventRepositoryError,
  );
});

test('lists only events for the requested Run', (context) => {
  const fixture = createContext(context);
  const other = new DailyRunRepository(fixture.client).createOrGet({
    accountId: fixture.account.id,
    businessDate: parseBusinessDate('2026-08-24'),
    now: new Date('2026-08-24T10:00:00.000Z'),
  });
  const repository = new SystemEventRepository(fixture.client);
  repository.create({
    eventType: 'TASK_FAILED',
    level: 'ERROR',
    runId: fixture.run.id,
    message: 'First Run failed',
  });
  repository.create({
    eventType: 'TASK_FAILED',
    level: 'ERROR',
    runId: other.id,
    message: 'Second Run failed',
  });

  assert.deepEqual(
    repository.listByRunId(fixture.run.id).map((event) => event.runId),
    [fixture.run.id],
  );
});

test('rejects unsupported level and event type at runtime', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new SystemEventRepository(client);

  assert.throws(
    () =>
      repository.create({
        eventType: 'TASK_FAILED',
        level: 'DEBUG' as never,
        message: 'Safe failure',
      }),
    /level is unsupported/i,
  );
  assert.throws(
    () =>
      repository.create({
        eventType: 'UNKNOWN_EVENT' as never,
        level: 'ERROR',
        message: 'Safe failure',
      }),
    /type is unsupported/i,
  );
});

test('rejects invalid Attempts and blank messages', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new SystemEventRepository(client);

  assert.throws(
    () =>
      repository.create({
        eventType: 'TASK_FAILED',
        level: 'ERROR',
        attempt: 0,
        message: 'Safe failure',
      }),
    /positive integer/i,
  );
  assert.throws(
    () => repository.create({ eventType: 'TASK_FAILED', level: 'ERROR', message: '   ' }),
    /must not be empty/i,
  );
});

test('rejects absolute and traversal evidence paths', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new SystemEventRepository(client);
  for (const screenshotPath of [
    '/tmp/evidence.png',
    '../browser-profile/evidence.png',
    'screenshots/../browser-profile/evidence.png',
    'C:\\evidence.png',
  ]) {
    assert.throws(
      () =>
        repository.create({
          eventType: 'SELECTOR_FAILURE',
          level: 'ERROR',
          message: 'Selector resolution failed',
          screenshotPath,
        }),
      /safe relative path/i,
    );
  }
});

test('foreign keys reject unknown contextual identifiers', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new SystemEventRepository(client);

  assert.throws(
    () =>
      repository.create({
        eventType: 'TASK_FAILED',
        level: 'ERROR',
        accountId: 'missing-account',
        message: 'Daily run failed',
      }),
    /failed to create systemevent/i,
  );
});

test('deleting a Friend retains its SystemEvent and nulls the foreign key', (context) => {
  const fixture = createContext(context);
  const repository = new SystemEventRepository(fixture.client);
  const event = repository.create({
    eventType: 'CONTACT_NOT_FOUND',
    level: 'WARN',
    accountId: fixture.account.id,
    runId: fixture.run.id,
    friendId: fixture.friend.id,
    message: 'Contact resolution failed',
  });

  fixture.client.orm.delete(friends).where(eq(friends.id, fixture.friend.id)).run();
  assert.equal(repository.findById(event.id)?.friendId, null);
  assert.equal(repository.findById(event.id)?.runId, fixture.run.id);
});

test('deleting a DailyRun retains its SystemEvent and nulls the foreign key', (context) => {
  const fixture = createContext(context);
  const repository = new SystemEventRepository(fixture.client);
  const event = repository.create({
    eventType: 'TASK_FAILED',
    level: 'ERROR',
    accountId: fixture.account.id,
    runId: fixture.run.id,
    message: 'Daily run failed',
  });

  fixture.client.orm.delete(dailyRuns).where(eq(dailyRuns.id, fixture.run.id)).run();
  assert.equal(repository.findById(event.id)?.runId, null);
  assert.equal(repository.findById(event.id)?.accountId, fixture.account.id);
});

test('SystemEvent persists across close, reopen, and repeated migrate', (context) => {
  const temporary = createTemporaryDatabase(context);
  const repository = new SystemEventRepository(temporary.client);
  const event = repository.create({
    eventType: 'AUTH_EXPIRED',
    level: 'ERROR',
    message: 'Authentication expired',
  });
  temporary.client.close();

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 8);
  assert.equal(
    new SystemEventRepository(reopened).findById(event.id)?.message,
    'Authentication expired',
  );
  reopened.close();
});
