import assert from 'node:assert/strict';
import { getTableColumns } from 'drizzle-orm';
import test from 'node:test';

import {
  AccountRepository,
  accounts,
  createDatabase,
  DatabaseMigrationError,
  FriendRepository,
  friends,
  MessageTemplateRepository,
  messageTemplates,
  type DatabaseClient,
} from '../src/index.js';
import {
  createTemporaryDatabase,
  createV1OneDatabase,
  createV1TwoDatabase,
} from './testDatabase.js';

test('fresh database migration creates all V1-3 tables and three journal entries', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  const result = client.migrate();
  const inspection = client.inspect();

  assert.deepEqual(result, {
    appliedMigrationCount: 3,
    accountsSchemaVerified: true,
    friendsSchemaVerified: true,
    messageTemplatesSchemaVerified: true,
  });
  assert.deepEqual(inspection.tables, [
    '__drizzle_migrations',
    'accounts',
    'friends',
    'message_templates',
  ]);
  assert.equal(inspection.appliedMigrationCount, 3);
  assert.equal(inspection.accountsSchemaCompatible, true);
  assert.equal(inspection.friendsSchemaCompatible, true);
  assert.equal(inspection.messageTemplatesSchemaCompatible, true);
});

test('running migrations twice is safe and does not duplicate the journal entry', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  client.migrate();
  const second = client.migrate();

  assert.equal(second.appliedMigrationCount, 3);
  assert.equal(client.inspect().appliedMigrationCount, 3);
});

test('migration state remains correct after close and reopen', (context) => {
  const temporary = createTemporaryDatabase(context, { migrate: false });
  temporary.client.migrate();
  temporary.client.close();

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const result = reopened.migrate();

  assert.equal(result.appliedMigrationCount, 3);
  assert.equal(reopened.inspect().accountsSchemaCompatible, true);
  assert.equal(reopened.inspect().friendsSchemaCompatible, true);
  assert.equal(reopened.inspect().messageTemplatesSchemaCompatible, true);
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

test('existing V1-1 database upgrades through V1-3 without losing account data', (context) => {
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

  assert.equal(migration.appliedMigrationCount, 3);
  assert.equal(client.inspect().appliedMigrationCount, 3);
  assert.equal(accountsRepository.findById(account.id)?.name, 'Upgrade Test Account');
  assert.equal(friend.accountId, account.id);

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const repeated = reopened.migrate();

  assert.equal(repeated.appliedMigrationCount, 3);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'Upgrade Test Account');
  assert.equal(
    new FriendRepository(reopened).findById(friend.id)?.displayName,
    'Upgrade Test User',
  );
  reopened.close();
});

test('existing V1-2 database upgrades to V1-3 and preserves Account/Friend data', (context) => {
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

  assert.equal(migration.appliedMigrationCount, 3);
  assert.equal(client.inspect().appliedMigrationCount, 3);
  assert.equal(accountsRepository.findById(account.id)?.name, 'V1-2 Test Account');
  assert.equal(friendsRepository.findById(alice.id)?.displayName, 'Alice');
  assert.equal(friendsRepository.findById(bob.id)?.displayName, 'Bob');
  assert.equal(template.messages[0], 'Hello');

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const repeated = reopened.migrate();

  assert.equal(repeated.appliedMigrationCount, 3);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'V1-2 Test Account');
  assert.equal(new FriendRepository(reopened).listByAccountId(account.id).length, 2);
  assert.equal(new MessageTemplateRepository(reopened).findById(template.id)?.messages[0], 'Hello');
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
