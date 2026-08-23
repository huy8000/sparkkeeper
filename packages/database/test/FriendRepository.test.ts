import assert from 'node:assert/strict';
import test from 'node:test';

import { eq } from 'drizzle-orm';

import {
  AccountRepository,
  accounts,
  createDatabase,
  FriendRepository,
  FriendRepositoryError,
  friends,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

test('creates a Friend with UUID, defaults, and UTC millisecond timestamps', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Alice',
  });

  assert.match(friend.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(friend.accountId, account.id);
  assert.equal(friend.displayName, 'Alice');
  assert.equal(friend.matchField, 'displayName');
  assert.equal(friend.matchKey, 'Alice');
  assert.equal(friend.enabled, true);
  assert.ok(friend.createdAt instanceof Date);
  assert.ok(friend.updatedAt instanceof Date);
  assert.equal(friend.createdAt.getTime(), friend.updatedAt.getTime());
});

test('findById returns a created Friend', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  const created = repository.create({ accountId: account.id, displayName: 'Alice' });

  assert.deepEqual(repository.findById(created.id), created);
});

test('findById returns undefined for an unknown Friend id', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.equal(new FriendRepository(client).findById('missing-friend-id'), undefined);
});

test('one Account can persist multiple Friends', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  repository.create({ accountId: account.id, displayName: 'Alice' });
  repository.create({ accountId: account.id, displayName: 'Bob' });
  repository.create({ accountId: account.id, displayName: 'Test User' });

  assert.deepEqual(
    new Set(repository.listByAccountId(account.id).map((friend) => friend.displayName)),
    new Set(['Alice', 'Bob', 'Test User']),
  );
});

test('listByAccountId isolates Friends belonging to different Accounts', (context) => {
  const { client } = createTemporaryDatabase(context);
  const accountsRepository = new AccountRepository(client);
  const accountA = accountsRepository.create({ name: 'Test Account A' });
  const accountB = accountsRepository.create({ name: 'Test Account B' });
  const repository = new FriendRepository(client);
  repository.create({ accountId: accountA.id, displayName: 'Alice' });
  repository.create({ accountId: accountB.id, displayName: 'Bob' });

  assert.deepEqual(
    repository.listByAccountId(accountA.id).map((friend) => friend.displayName),
    ['Alice'],
  );
  assert.deepEqual(
    repository.listByAccountId(accountB.id).map((friend) => friend.displayName),
    ['Bob'],
  );
});

test('listEnabledByAccountId excludes disabled Friends', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  repository.create({ accountId: account.id, displayName: 'Alice' });
  repository.create({ accountId: account.id, displayName: 'Bob', enabled: false });

  assert.deepEqual(
    repository.listEnabledByAccountId(account.id).map((friend) => friend.displayName),
    ['Alice'],
  );
});

test('create trims displayName and converts blank optional fields to null', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: '  Alice  ',
    remarkName: '   ',
    shortId: '',
    uniqueId: null,
  });

  assert.equal(friend.displayName, 'Alice');
  assert.equal(friend.remarkName, null);
  assert.equal(friend.shortId, null);
  assert.equal(friend.uniqueId, null);
  assert.equal(friend.secUid, null);
});

test('create rejects an empty displayName', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });

  assert.throws(
    () =>
      new FriendRepository(client).create({
        accountId: account.id,
        displayName: '   ',
      }),
    (error: unknown) => {
      assert.ok(error instanceof FriendRepositoryError);
      assert.equal(error.operation, 'create');
      assert.match(error.message, /displayName must not be empty/);
      return true;
    },
  );
});

test('create selects the strongest available identity and derives matchKey', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Alice',
    shortId: ' short-test-id ',
    uniqueId: ' unique-test-id ',
    secUid: ' secure-test-id ',
  });

  assert.equal(friend.matchField, 'secUid');
  assert.equal(friend.matchKey, 'secure-test-id');
});

test('create supports an explicit available match field without accepting matchKey', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: ' Alice ',
    secUid: ' secure-test-id ',
    matchField: 'displayName',
  });

  assert.equal(friend.matchField, 'displayName');
  assert.equal(friend.matchKey, 'Alice');
});

test('create rejects an explicit match field whose identity is absent', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });

  assert.throws(
    () =>
      new FriendRepository(client).create({
        accountId: account.id,
        displayName: 'Alice',
        matchField: 'secUid',
      }),
    FriendRepositoryError,
  );
});

test('update adds a stronger identity and recomputes the preferred match', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  const created = repository.create({ accountId: account.id, displayName: 'Alice' });
  const updated = repository.update(created.id, { uniqueId: ' unique-test-id ' });

  assert.equal(updated?.uniqueId, 'unique-test-id');
  assert.equal(updated?.matchField, 'uniqueId');
  assert.equal(updated?.matchKey, 'unique-test-id');
  assert.ok((updated?.updatedAt.getTime() ?? 0) >= created.updatedAt.getTime());
});

test('update can explicitly bind an available lower-priority identity', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  const created = repository.create({
    accountId: account.id,
    displayName: 'Alice',
    secUid: 'secure-test-id',
  });
  const updated = repository.update(created.id, { matchField: 'displayName' });

  assert.equal(updated?.matchField, 'displayName');
  assert.equal(updated?.matchKey, 'Alice');
});

test('enabled-only update preserves the current identity binding', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  const created = repository.create({
    accountId: account.id,
    displayName: 'Alice',
    uniqueId: 'unique-test-id',
  });
  const updated = repository.update(created.id, { enabled: false });

  assert.equal(updated?.enabled, false);
  assert.equal(updated?.matchField, 'uniqueId');
  assert.equal(updated?.matchKey, 'unique-test-id');
});

test('clearing the strongest identity falls back to the next available identity', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  const created = repository.create({
    accountId: account.id,
    displayName: 'Alice',
    remarkName: 'Test Remark',
    uniqueId: 'unique-test-id',
  });
  const updated = repository.update(created.id, { uniqueId: '  ' });

  assert.equal(updated?.uniqueId, null);
  assert.equal(updated?.matchField, 'remarkName');
  assert.equal(updated?.matchKey, 'Test Remark');
});

test('update returns undefined for an unknown Friend id', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.equal(
    new FriendRepository(client).update('missing-friend-id', { enabled: false }),
    undefined,
  );
});

test('update rejects an empty patch', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  const created = repository.create({ accountId: account.id, displayName: 'Alice' });

  assert.throws(() => repository.update(created.id, {}), FriendRepositoryError);
});

test('unknown accountId fails through the active SQLite foreign key', (context) => {
  const { client } = createTemporaryDatabase(context);

  assert.throws(
    () =>
      new FriendRepository(client).create({
        accountId: 'missing-account-id',
        displayName: 'Alice',
      }),
    (error: unknown) => {
      assert.ok(error instanceof FriendRepositoryError);
      assert.equal(error.operation, 'create');
      assert.match(String(error.cause), /FOREIGN KEY constraint failed/i);
      return true;
    },
  );
});

test('duplicate displayName values are allowed within one Account', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  repository.create({ accountId: account.id, displayName: 'Alice' });
  repository.create({ accountId: account.id, displayName: 'Alice' });

  assert.equal(repository.listByAccountId(account.id).length, 2);
});

test('duplicate optional identity values are allowed without unproven uniqueness scope', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  const sharedIdentity = {
    accountId: account.id,
    displayName: 'Alice',
    remarkName: 'Test Remark',
    shortId: 'short-test-id',
    uniqueId: 'unique-test-id',
    secUid: 'secure-test-id',
  } as const;

  repository.create(sharedIdentity);
  repository.create({ ...sharedIdentity, displayName: 'Bob' });

  assert.equal(repository.listByAccountId(account.id).length, 2);
});

test('deleting an Account cascades to its owned Friends', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const repository = new FriendRepository(client);
  const friend = repository.create({ accountId: account.id, displayName: 'Alice' });

  client.orm.delete(accounts).where(eq(accounts.id, account.id)).run();

  assert.equal(repository.findById(friend.id), undefined);
});

test('database CHECK constraints reject an inconsistent match field and key', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const now = new Date();

  assert.throws(() =>
    client.orm
      .insert(friends)
      .values({
        id: '00000000-0000-4000-8000-000000000001',
        accountId: account.id,
        displayName: 'Alice',
        matchField: 'displayName',
        matchKey: 'Bob',
        createdAt: now,
        updatedAt: now,
      })
      .run(),
  );
});

test('Friend persists after close, reopen, and repeated migration', (context) => {
  const temporary = createTemporaryDatabase(context);
  const account = new AccountRepository(temporary.client).create({ name: 'Test Account' });
  const created = new FriendRepository(temporary.client).create({
    accountId: account.id,
    displayName: 'Alice',
    enabled: false,
  });
  temporary.client.close();

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const migration = reopened.migrate();
  const persisted = new FriendRepository(reopened).findById(created.id);

  assert.equal(migration.appliedMigrationCount, 4);
  assert.equal(persisted?.displayName, 'Alice');
  assert.equal(persisted?.enabled, false);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'Test Account');
  reopened.close();
});
