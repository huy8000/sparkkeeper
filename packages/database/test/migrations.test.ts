import assert from 'node:assert/strict';
import { parseBusinessDate } from '@sparkkeeper/shared';
import { getTableColumns } from 'drizzle-orm';
import test from 'node:test';

import {
  AccountRepository,
  accounts,
  createDatabase,
  DailyRunRepository,
  dailyRuns,
  DatabaseMigrationError,
  FriendRepository,
  friends,
  MessageTemplateRepository,
  messageTemplates,
  SendRecordRepository,
  sendRecords,
  ScheduleRepository,
  schedules,
  type DatabaseClient,
} from '../src/index.js';
import {
  createTemporaryDatabase,
  createV1OneDatabase,
  createV1TwoDatabase,
  createV1ThreeDatabase,
  createV1FourDatabase,
} from './testDatabase.js';

test('fresh database migration creates all V1-5 tables and five journal entries', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  const result = client.migrate();
  const inspection = client.inspect();

  assert.deepEqual(result, {
    appliedMigrationCount: 5,
    accountsSchemaVerified: true,
    dailyRunsSchemaVerified: true,
    friendsSchemaVerified: true,
    messageTemplatesSchemaVerified: true,
    sendRecordsSchemaVerified: true,
    schedulesSchemaVerified: true,
  });
  assert.deepEqual(inspection.tables, [
    '__drizzle_migrations',
    'accounts',
    'daily_runs',
    'friends',
    'message_templates',
    'schedules',
    'send_records',
  ]);
  assert.equal(inspection.appliedMigrationCount, 5);
  assert.equal(inspection.accountsSchemaCompatible, true);
  assert.equal(inspection.dailyRunsSchemaCompatible, true);
  assert.equal(inspection.friendsSchemaCompatible, true);
  assert.equal(inspection.messageTemplatesSchemaCompatible, true);
  assert.equal(inspection.sendRecordsSchemaCompatible, true);
  assert.equal(inspection.schedulesSchemaCompatible, true);
});

test('running migrations twice is safe and does not duplicate the journal entry', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  client.migrate();
  const second = client.migrate();

  assert.equal(second.appliedMigrationCount, 5);
  assert.equal(client.inspect().appliedMigrationCount, 5);
});

test('migration state remains correct after close and reopen', (context) => {
  const temporary = createTemporaryDatabase(context, { migrate: false });
  temporary.client.migrate();
  temporary.client.close();

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const result = reopened.migrate();

  assert.equal(result.appliedMigrationCount, 5);
  assert.equal(reopened.inspect().accountsSchemaCompatible, true);
  assert.equal(reopened.inspect().dailyRunsSchemaCompatible, true);
  assert.equal(reopened.inspect().friendsSchemaCompatible, true);
  assert.equal(reopened.inspect().messageTemplatesSchemaCompatible, true);
  assert.equal(reopened.inspect().sendRecordsSchemaCompatible, true);
  assert.equal(reopened.inspect().schedulesSchemaCompatible, true);
  reopened.close();
});

test('migrated SQLite columns align with the Drizzle accounts definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(accounts)).map((column) => column.name);
  const sqliteColumnNames = client.inspect().accountColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'name',
    'enabled',
    'login_status',
    'last_login_at',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle friends definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(friends)).map((column) => column.name);
  const sqliteColumnNames = client.inspect().friendColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'account_id',
    'display_name',
    'remark_name',
    'short_id',
    'unique_id',
    'sec_uid',
    'match_field',
    'match_key',
    'enabled',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle daily_runs definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(dailyRuns)).map((column) => column.name);
  const sqliteColumnNames = client.inspect().dailyRunColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'account_id',
    'business_date',
    'status',
    'started_at',
    'finished_at',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle message_templates definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(messageTemplates)).map(
    (column) => column.name,
  );
  const sqliteColumnNames = client.inspect().messageTemplateColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'name',
    'provider_type',
    'content',
    'enabled',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle send_records definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(sendRecords)).map(
    (column) => column.name,
  );
  const sqliteColumnNames = client.inspect().sendRecordColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'daily_run_id',
    'friend_id',
    'business_date',
    'message_template_id',
    'message_text',
    'status',
    'started_at',
    'finished_at',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle schedules definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(schedules)).map((column) => column.name);
  const sqliteColumnNames = client.inspect().scheduleColumns.map((column) => column.name);
  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'account_id',
    'start_time',
    'end_time',
    'timezone',
    'enabled',
    'created_at',
    'updated_at',
  ]);
});

test('existing V1-1 database upgrades through V1-4 without losing account data', (context) => {
  const temporary = createV1OneDatabase(context);
  const { client } = temporary;
  const accountsRepository = new AccountRepository(client);
  const account = accountsRepository.create({ name: 'Upgrade Test Account', loginStatus: 'READY' });

  const before = client.inspect();
  assert.equal(before.appliedMigrationCount, 1);
  assert.equal(before.accountsSchemaCompatible, true);
  assert.equal(before.friendsSchemaCompatible, false);
  assert.equal(before.tables.includes('friends'), false);

  const migration = client.migrate();
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Upgrade Test User',
  });

  assert.equal(migration.appliedMigrationCount, 5);
  assert.equal(client.inspect().appliedMigrationCount, 5);
  assert.equal(accountsRepository.findById(account.id)?.name, 'Upgrade Test Account');
  assert.equal(friend.accountId, account.id);

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const repeated = reopened.migrate();

  assert.equal(repeated.appliedMigrationCount, 5);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'Upgrade Test Account');
  assert.equal(
    new FriendRepository(reopened).findById(friend.id)?.displayName,
    'Upgrade Test User',
  );
  reopened.close();
});

test('existing V1-2 database upgrades through V1-4 and preserves Account/Friend data', (context) => {
  const temporary = createV1TwoDatabase(context);
  const { client } = temporary;
  const accountsRepository = new AccountRepository(client);
  const friendsRepository = new FriendRepository(client);
  const account = accountsRepository.create({ name: 'V1-2 Test Account', loginStatus: 'READY' });
  const alice = friendsRepository.create({ accountId: account.id, displayName: 'Alice' });
  const bob = friendsRepository.create({ accountId: account.id, displayName: 'Bob' });

  const before = client.inspect();
  assert.equal(before.appliedMigrationCount, 2);
  assert.equal(before.accountsSchemaCompatible, true);
  assert.equal(before.friendsSchemaCompatible, true);
  assert.equal(before.messageTemplatesSchemaCompatible, false);
  assert.equal(before.tables.includes('message_templates'), false);

  const migration = client.migrate();
  const template = new MessageTemplateRepository(client).create({
    name: 'Upgrade Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });

  assert.equal(migration.appliedMigrationCount, 5);
  assert.equal(client.inspect().appliedMigrationCount, 5);
  assert.equal(accountsRepository.findById(account.id)?.name, 'V1-2 Test Account');
  assert.equal(friendsRepository.findById(alice.id)?.displayName, 'Alice');
  assert.equal(friendsRepository.findById(bob.id)?.displayName, 'Bob');
  assert.equal(template.messages[0], 'Hello');

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const repeated = reopened.migrate();

  assert.equal(repeated.appliedMigrationCount, 5);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'V1-2 Test Account');
  assert.equal(new FriendRepository(reopened).listByAccountId(account.id).length, 2);
  assert.equal(new MessageTemplateRepository(reopened).findById(template.id)?.messages[0], 'Hello');
  reopened.close();
});

test('existing V1-3 database upgrades to V1-4 and preserves Account/Friend/Template data', (context) => {
  const temporary = createV1ThreeDatabase(context);
  const { client } = temporary;
  const accountsRepository = new AccountRepository(client);
  const account = accountsRepository.create({ name: 'V1-3 Test Account', loginStatus: 'READY' });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Alice',
  });
  const template = new MessageTemplateRepository(client).create({
    name: 'V1-3 Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });

  const before = client.inspect();
  assert.equal(before.appliedMigrationCount, 3);
  assert.equal(before.dailyRunsSchemaCompatible, false);
  assert.equal(before.sendRecordsSchemaCompatible, false);
  assert.equal(before.tables.includes('daily_runs'), false);
  assert.equal(before.tables.includes('send_records'), false);

  const migration = client.migrate();
  const businessDate = parseBusinessDate('2026-08-23');
  const now = new Date('2026-08-23T10:00:00.000Z');
  const dailyRun = new DailyRunRepository(client).createOrGet({
    accountId: account.id,
    businessDate,
    now,
  });
  const prepared = new SendRecordRepository(client).prepare({
    dailyRunId: dailyRun.id,
    friendId: friend.id,
    businessDate,
    messageTemplateId: template.id,
    messageText: 'Hello',
    now,
  });

  assert.equal(migration.appliedMigrationCount, 5);
  assert.equal(client.inspect().appliedMigrationCount, 5);
  assert.equal(accountsRepository.findById(account.id)?.name, 'V1-3 Test Account');
  assert.equal(new FriendRepository(client).findById(friend.id)?.displayName, 'Alice');
  assert.equal(
    new MessageTemplateRepository(client).findById(template.id)?.name,
    'V1-3 Test Template',
  );
  assert.equal(prepared.type, 'PREPARED');

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const repeated = reopened.migrate();

  assert.equal(repeated.appliedMigrationCount, 5);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'V1-3 Test Account');
  assert.equal(new FriendRepository(reopened).findById(friend.id)?.displayName, 'Alice');
  assert.equal(
    new MessageTemplateRepository(reopened).findById(template.id)?.name,
    'V1-3 Test Template',
  );
  assert.equal(new DailyRunRepository(reopened).findById(dailyRun.id)?.businessDate, businessDate);
  assert.equal(
    new SendRecordRepository(reopened).findById(prepared.record.id)?.messageText,
    'Hello',
  );
  reopened.close();
});

test('existing V1-4 database upgrades to V1-5 and preserves all idempotency data', (context) => {
  const temporary = createV1FourDatabase(context);
  const { client } = temporary;
  const now = new Date('2026-08-23T00:00:00.000Z');
  const account = new AccountRepository(client).create({
    name: 'V1-4 Account',
    loginStatus: 'READY',
    now,
  });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Alice',
    now,
  });
  const template = new MessageTemplateRepository(client).create({
    name: 'Template',
    providerType: 'STATIC',
    messages: ['Hello'],
    now,
  });
  const businessDate = parseBusinessDate('2026-08-23');
  const run = new DailyRunRepository(client).createOrGet({
    accountId: account.id,
    businessDate,
    now,
  });
  const record = new SendRecordRepository(client).prepare({
    dailyRunId: run.id,
    friendId: friend.id,
    businessDate,
    messageTemplateId: template.id,
    messageText: 'Hello',
    now,
  });
  assert.equal(client.inspect().appliedMigrationCount, 4);
  assert.equal(client.inspect().schedulesSchemaCompatible, false);

  assert.equal(client.migrate().appliedMigrationCount, 5);
  const schedule = new ScheduleRepository(client).create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Asia/Shanghai',
    now,
  });
  assert.equal(new AccountRepository(client).findById(account.id)?.name, 'V1-4 Account');
  assert.equal(new FriendRepository(client).findById(friend.id)?.displayName, 'Alice');
  assert.equal(new MessageTemplateRepository(client).findById(template.id)?.messages[0], 'Hello');
  assert.equal(new DailyRunRepository(client).findById(run.id)?.businessDate, businessDate);
  assert.equal(new SendRecordRepository(client).findById(record.record.id)?.messageText, 'Hello');

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 5);
  assert.equal(new ScheduleRepository(reopened).findById(schedule.id)?.startTime, '09:00');
  assert.equal(new SendRecordRepository(reopened).findById(record.record.id)?.messageText, 'Hello');
  reopened.close();
});

test('migration failure includes explicit migration context', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });
  const missingDirectory = '/path/that/does/not/contain/drizzle/migrations';
  client.close();

  const invalidClient: DatabaseClient = createDatabase({
    databasePath: client.databasePath,
    migrationsDirectory: missingDirectory,
  });
  context.after(() => invalidClient.close());

  assert.throws(
    () => invalidClient.migrate(),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseMigrationError);
      assert.match(error.message, /failed to apply database migrations/i);
      assert.match(error.message, /path\/that\/does\/not\/contain/i);
      return true;
    },
  );
  invalidClient.close();
});
