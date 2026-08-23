import assert from 'node:assert/strict';
import test from 'node:test';

import { AccountRepository, AccountRepositoryError, createDatabase } from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

test('creates an account with UUID, defaults, and UTC millisecond timestamps', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });

  assert.match(
    account.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(account.name, 'Test Account');
  assert.equal(account.enabled, true);
  assert.equal(account.loginStatus, 'UNKNOWN');
  assert.equal(account.lastLoginAt, null);
  assert.ok(account.createdAt instanceof Date);
  assert.ok(account.updatedAt instanceof Date);
  assert.equal(account.createdAt.getTime(), account.updatedAt.getTime());
});

test('findById returns the created account', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new AccountRepository(client);
  const created = repository.create({ name: 'Test Account', loginStatus: 'READY' });

  assert.deepEqual(repository.findById(created.id), created);
});

test('findById returns undefined for an unknown id', (context) => {
  const { client } = createTemporaryDatabase(context);

  assert.equal(new AccountRepository(client).findById('missing-account-id'), undefined);
});

test('list returns all persisted accounts', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new AccountRepository(client);
  repository.create({ name: 'Test Account One' });
  repository.create({ name: 'Test Account Two', enabled: false });

  const accounts = repository.list();

  assert.equal(accounts.length, 2);
  assert.deepEqual(
    new Set(accounts.map((account) => account.name)),
    new Set(['Test Account One', 'Test Account Two']),
  );
});

test('update changes enabled state, login status, login time, name, and updatedAt', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new AccountRepository(client);
  const created = repository.create({ name: 'Test Account' });
  const lastLoginAt = new Date('2026-01-02T03:04:05.678Z');

  const updated = repository.update(created.id, {
    name: 'Updated Test Account',
    enabled: false,
    loginStatus: 'AUTH_EXPIRED',
    lastLoginAt,
  });

  assert.equal(updated?.name, 'Updated Test Account');
  assert.equal(updated?.enabled, false);
  assert.equal(updated?.loginStatus, 'AUTH_EXPIRED');
  assert.equal(updated?.lastLoginAt?.toISOString(), lastLoginAt.toISOString());
  assert.ok((updated?.updatedAt.getTime() ?? 0) >= created.updatedAt.getTime());
});

test('update returns undefined for an unknown id', (context) => {
  const { client } = createTemporaryDatabase(context);

  assert.equal(
    new AccountRepository(client).update('missing-account-id', { enabled: false }),
    undefined,
  );
});

test('update rejects an empty patch', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new AccountRepository(client);
  const created = repository.create({ name: 'Test Account' });

  assert.throws(
    () => repository.update(created.id, {}),
    (error: unknown) => {
      assert.ok(error instanceof AccountRepositoryError);
      assert.equal(error.operation, 'update');
      assert.match(error.message, /at least one field/i);
      return true;
    },
  );
});

test('repository failures provide operation context without SQL parameters', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  assert.throws(
    () => new AccountRepository(client).create({ name: 'Test Account' }),
    (error: unknown) => {
      assert.ok(error instanceof AccountRepositoryError);
      assert.equal(error.operation, 'create');
      assert.equal(error.message, 'Failed to create account.');
      return true;
    },
  );
});

test('account data persists after close, reopen, and a second migration', (context) => {
  const temporary = createTemporaryDatabase(context);
  const created = new AccountRepository(temporary.client).create({
    name: 'Test Account',
    enabled: false,
    loginStatus: 'READY',
  });
  temporary.client.close();

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  reopened.migrate();
  const persisted = new AccountRepository(reopened).findById(created.id);

  assert.equal(persisted?.name, 'Test Account');
  assert.equal(persisted?.enabled, false);
  assert.equal(persisted?.loginStatus, 'READY');
  assert.equal(reopened.inspect().appliedMigrationCount, 2);
  reopened.close();
});
