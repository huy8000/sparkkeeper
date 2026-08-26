import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';

import { parseBusinessDate, type BusinessDate } from '@sparkkeeper/shared';
import { eq } from 'drizzle-orm';

import {
  AccountRepository,
  accounts,
  createDatabase,
  DailyRunRepository,
  DailyRunRepositoryError,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

const BUSINESS_DATE = parseBusinessDate('2026-08-23');
const NEXT_BUSINESS_DATE = parseBusinessDate('2026-08-24');
const CREATED_AT = new Date('2026-08-23T10:00:00.000Z');
const STARTED_AT = new Date('2026-08-23T10:01:00.000Z');
const FINISHED_AT = new Date('2026-08-23T10:02:00.000Z');

test('creates a READY DailyRun with UUID and explicit UTC timestamps', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const run = new DailyRunRepository(client).createOrGet({
    accountId: account.id,
    businessDate: BUSINESS_DATE,
    now: CREATED_AT,
  });

  assert.match(run.id, /^[0-9a-f-]{36}$/i);
  assert.equal(run.accountId, account.id);
  assert.equal(run.businessDate, BUSINESS_DATE);
  assert.equal(run.status, 'READY');
  assert.equal(run.startedAt, null);
  assert.equal(run.finishedAt, null);
  assert.equal(run.createdAt.getTime(), CREATED_AT.getTime());
  assert.equal(run.updatedAt.getTime(), CREATED_AT.getTime());
});

test('findById returns a DailyRun', (context) => {
  const fixture = createDailyRunFixture(context);
  assert.deepEqual(fixture.repository.findById(fixture.run.id), fixture.run);
});

test('findById returns undefined for an unknown DailyRun', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.equal(new DailyRunRepository(client).findById('missing-daily-run'), undefined);
});

test('findByAccountAndBusinessDate returns the canonical DailyRun', (context) => {
  const fixture = createDailyRunFixture(context);
  assert.equal(
    fixture.repository.findByAccountAndBusinessDate(fixture.accountId, BUSINESS_DATE)?.id,
    fixture.run.id,
  );
});

test('listByAccountId returns ordered DailyRuns for only that Account', (context) => {
  const { client } = createTemporaryDatabase(context);
  const accountsRepository = new AccountRepository(client);
  const first = accountsRepository.create({ name: 'Test Account A' });
  const second = accountsRepository.create({ name: 'Test Account B' });
  const repository = new DailyRunRepository(client);
  repository.createOrGet({
    accountId: first.id,
    businessDate: NEXT_BUSINESS_DATE,
    now: CREATED_AT,
  });
  repository.createOrGet({ accountId: first.id, businessDate: BUSINESS_DATE, now: CREATED_AT });
  repository.createOrGet({ accountId: second.id, businessDate: BUSINESS_DATE, now: CREATED_AT });

  assert.deepEqual(
    repository.listByAccountId(first.id).map((run) => run.businessDate),
    [BUSINESS_DATE, NEXT_BUSINESS_DATE],
  );
});

test('list applies safe filters, newest-first ordering, and a bounded limit', (context) => {
  const { client } = createTemporaryDatabase(context);
  const accountsRepository = new AccountRepository(client);
  const first = accountsRepository.create({ name: 'Test Account A' });
  const second = accountsRepository.create({ name: 'Test Account B' });
  const repository = new DailyRunRepository(client);
  const older = repository.createOrGet({
    accountId: first.id,
    businessDate: BUSINESS_DATE,
    now: CREATED_AT,
  });
  const newer = repository.createOrGet({
    accountId: first.id,
    businessDate: NEXT_BUSINESS_DATE,
    now: CREATED_AT,
  });
  repository.createOrGet({
    accountId: second.id,
    businessDate: BUSINESS_DATE,
    now: CREATED_AT,
  });
  repository.markAuthExpired(newer.id, FINISHED_AT);

  assert.deepEqual(
    repository.list({ accountId: first.id }).map((run) => run.id),
    [newer.id, older.id],
  );
  assert.deepEqual(
    repository.list({ businessDate: BUSINESS_DATE }).map((run) => run.businessDate),
    [BUSINESS_DATE, BUSINESS_DATE],
  );
  assert.deepEqual(
    repository.list({ status: 'AUTH_EXPIRED' }).map((run) => run.id),
    [newer.id],
  );
  assert.deepEqual(
    repository.list({ limit: 1 }).map((run) => run.id),
    [newer.id],
  );
  assert.throws(() => repository.list({ limit: 101 }), DailyRunRepositoryError);
});

test('createOrGet twice for one Account/date returns one unchanged row', (context) => {
  const fixture = createDailyRunFixture(context);
  const second = fixture.repository.createOrGet({
    accountId: fixture.accountId,
    businessDate: BUSINESS_DATE,
    now: FINISHED_AT,
  });

  assert.equal(second.id, fixture.run.id);
  assert.equal(second.createdAt.getTime(), CREATED_AT.getTime());
  assert.equal(fixture.repository.listByAccountId(fixture.accountId).length, 1);
});

test('different business dates are allowed for one Account', (context) => {
  const fixture = createDailyRunFixture(context);
  fixture.repository.createOrGet({
    accountId: fixture.accountId,
    businessDate: NEXT_BUSINESS_DATE,
    now: CREATED_AT,
  });
  assert.equal(fixture.repository.listByAccountId(fixture.accountId).length, 2);
});

test('different Accounts may have DailyRuns on the same business date', (context) => {
  const { client } = createTemporaryDatabase(context);
  const accountsRepository = new AccountRepository(client);
  const first = accountsRepository.create({ name: 'Test Account A' });
  const second = accountsRepository.create({ name: 'Test Account B' });
  const repository = new DailyRunRepository(client);

  assert.notEqual(
    repository.createOrGet({ accountId: first.id, businessDate: BUSINESS_DATE, now: CREATED_AT })
      .id,
    repository.createOrGet({ accountId: second.id, businessDate: BUSINESS_DATE, now: CREATED_AT })
      .id,
  );
});

test('an unknown Account fails through the active DailyRun foreign key', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.throws(
    () =>
      new DailyRunRepository(client).createOrGet({
        accountId: 'missing-account',
        businessDate: BUSINESS_DATE,
        now: CREATED_AT,
      }),
    DailyRunRepositoryError,
  );
});

test('createOrGet rejects an invalid runtime BusinessDate', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  assert.throws(
    () =>
      new DailyRunRepository(client).createOrGet({
        accountId: account.id,
        businessDate: '2026-02-30' as BusinessDate,
        now: CREATED_AT,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DailyRunRepositoryError);
      assert.equal(error.code, 'INVALID_BUSINESS_DATE');
      return true;
    },
  );
});

test('markRunning performs READY to RUNNING with startedAt', (context) => {
  const fixture = createDailyRunFixture(context);
  const running = fixture.repository.markRunning(fixture.run.id, STARTED_AT);
  assert.equal(running.status, 'RUNNING');
  assert.equal(running.startedAt?.getTime(), STARTED_AT.getTime());
  assert.equal(running.finishedAt, null);
  assert.equal(running.updatedAt.getTime(), STARTED_AT.getTime());
});

test('claimForExecution grants READY DailyRun execution only once', (context) => {
  const fixture = createDailyRunFixture(context);
  const first = fixture.repository.claimForExecution(fixture.run.id, STARTED_AT);
  const second = fixture.repository.claimForExecution(fixture.run.id, STARTED_AT);
  assert.equal(first.type, 'CLAIMED');
  assert.equal(second.type, 'NOT_CLAIMABLE');
  assert.equal(second.type === 'NOT_CLAIMABLE' ? second.run.status : undefined, 'RUNNING');
});

test('claimForExecution reports a missing DailyRun without creating one', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.deepEqual(new DailyRunRepository(client).claimForExecution('missing', STARTED_AT), {
    type: 'NOT_FOUND',
  });
});

test('markSuccess performs RUNNING to SUCCESS with finishedAt', (context) => {
  const fixture = createDailyRunFixture(context);
  fixture.repository.markRunning(fixture.run.id, STARTED_AT);
  const success = fixture.repository.markSuccess(fixture.run.id, FINISHED_AT);
  assert.equal(success.status, 'SUCCESS');
  assert.equal(success.finishedAt?.getTime(), FINISHED_AT.getTime());
});

test('markFailed performs RUNNING to FAILED', (context) => {
  const fixture = createDailyRunFixture(context);
  fixture.repository.markRunning(fixture.run.id, STARTED_AT);
  assert.equal(fixture.repository.markFailed(fixture.run.id, FINISHED_AT).status, 'FAILED');
});

test('markAuthExpired can finish READY or RUNNING DailyRuns', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new DailyRunRepository(client);
  const ready = repository.createOrGet({
    accountId: account.id,
    businessDate: BUSINESS_DATE,
    now: CREATED_AT,
  });
  const running = repository.createOrGet({
    accountId: account.id,
    businessDate: NEXT_BUSINESS_DATE,
    now: CREATED_AT,
  });
  repository.markRunning(running.id, STARTED_AT);

  assert.equal(repository.markAuthExpired(ready.id, FINISHED_AT).status, 'AUTH_EXPIRED');
  assert.equal(repository.markAuthExpired(running.id, FINISHED_AT).status, 'AUTH_EXPIRED');
});

test('SUCCESS is terminal and repeated markSuccess is idempotent', (context) => {
  const fixture = createDailyRunFixture(context);
  fixture.repository.markRunning(fixture.run.id, STARTED_AT);
  const success = fixture.repository.markSuccess(fixture.run.id, FINISHED_AT);
  const repeated = fixture.repository.markSuccess(
    fixture.run.id,
    new Date('2026-08-23T10:03:00.000Z'),
  );

  assert.equal(repeated.finishedAt?.getTime(), success.finishedAt?.getTime());
  assert.throws(
    () => fixture.repository.markFailed(fixture.run.id, FINISHED_AT),
    (error: unknown) => {
      assert.ok(error instanceof DailyRunRepositoryError);
      assert.equal(error.code, 'INVALID_STATE_TRANSITION');
      return true;
    },
  );
});

test('state updates distinguish not-found and invalid timestamps', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new DailyRunRepository(client);
  assert.throws(
    () => repository.markRunning('missing-daily-run', STARTED_AT),
    (error: unknown) => {
      assert.ok(error instanceof DailyRunRepositoryError);
      assert.equal(error.code, 'DAILY_RUN_NOT_FOUND');
      return true;
    },
  );
  assert.throws(
    () => repository.markRunning('missing-daily-run', new Date(Number.NaN)),
    (error: unknown) => {
      assert.ok(error instanceof DailyRunRepositoryError);
      assert.equal(error.code, 'INVALID_TIMESTAMP');
      return true;
    },
  );
});

test('deleting an Account cascades to its DailyRuns', (context) => {
  const fixture = createDailyRunFixture(context);
  fixture.client.orm.delete(accounts).where(eq(accounts.id, fixture.accountId)).run();
  assert.equal(fixture.repository.findById(fixture.run.id), undefined);
});

test('DailyRun persists after close, reopen, and repeated migrate', (context) => {
  const fixture = createDailyRunFixture(context);
  fixture.client.close();

  const reopened = createDatabase({ databasePath: fixture.databasePath });
  context.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 8);
  assert.equal(
    new DailyRunRepository(reopened).findById(fixture.run.id)?.businessDate,
    BUSINESS_DATE,
  );
  reopened.close();
});

function createDailyRunFixture(context: TestContext) {
  const temporary = createTemporaryDatabase(context);
  const account = new AccountRepository(temporary.client).create({ name: 'Test Account' });
  const repository = new DailyRunRepository(temporary.client);
  const run = repository.createOrGet({
    accountId: account.id,
    businessDate: BUSINESS_DATE,
    now: CREATED_AT,
  });
  return {
    ...temporary,
    accountId: account.id,
    repository,
    run,
  };
}
