import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AccountRepository,
  createDatabase,
  FriendRepository,
  type DatabaseClient,
} from '../src/index.js';

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sparkkeeper-database-smoke-'));
const databasePath = path.join(temporaryDirectory, 'sparkkeeper.db');
let client: DatabaseClient | undefined;
let smokeResult: Record<string, string | number> | undefined;

try {
  client = createDatabase({ databasePath });
  const firstMigration = client.migrate();
  const firstInspection = client.inspect();

  assert.equal(firstMigration.appliedMigrationCount, 2);
  assert.equal(firstInspection.pragmas.journalMode, 'wal');
  assert.equal(firstInspection.pragmas.foreignKeys, 1);

  const accountsRepository = new AccountRepository(client);
  const account = accountsRepository.create({
    name: 'Test Account',
    enabled: true,
    loginStatus: 'READY',
  });
  const friendsRepository = new FriendRepository(client);
  const alice = friendsRepository.create({
    accountId: account.id,
    displayName: 'Alice',
  });
  friendsRepository.create({
    accountId: account.id,
    displayName: 'Bob',
    enabled: false,
  });

  client.close();
  client = createDatabase({ databasePath });
  const secondMigration = client.migrate();
  const reopenedAccount = new AccountRepository(client).findById(account.id);
  const reopenedFriends = new FriendRepository(client);

  assert.equal(secondMigration.appliedMigrationCount, 2);
  assert.equal(reopenedAccount?.name, 'Test Account');
  assert.equal(reopenedAccount?.loginStatus, 'READY');
  assert.equal(reopenedFriends.findById(alice.id)?.displayName, 'Alice');
  assert.deepEqual(
    new Set(reopenedFriends.listByAccountId(account.id).map((friend) => friend.displayName)),
    new Set(['Alice', 'Bob']),
  );
  assert.deepEqual(
    reopenedFriends.listEnabledByAccountId(account.id).map((friend) => friend.displayName),
    ['Alice'],
  );

  smokeResult = {
    freshMigration: 'PASS',
    journalMode: 'wal',
    foreignKeys: 1,
    createAccount: 'PASS',
    createFriends: 'PASS',
    enabledFiltering: 'PASS',
    closeReopen: 'PASS',
    repeatedMigration: 'PASS',
    persistence: 'PASS',
  };
} finally {
  client?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({ ...smokeResult, cleanup: 'PASS' }));
