import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MessageEngine, RandomProvider, StaticProvider } from '@sparkkeeper/message-engine';

import {
  AccountRepository,
  createDatabase,
  FriendRepository,
  MessageTemplateRepository,
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

  assert.equal(firstMigration.appliedMigrationCount, 3);
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
  const messageTemplatesRepository = new MessageTemplateRepository(client);
  const staticTemplate = messageTemplatesRepository.create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  const randomTemplate = messageTemplatesRepository.create({
    name: 'Random Test Template',
    providerType: 'RANDOM',
    messages: ['Message A', 'Message B'],
  });

  client.close();
  client = createDatabase({ databasePath });
  const secondMigration = client.migrate();
  const reopenedAccount = new AccountRepository(client).findById(account.id);
  const reopenedFriends = new FriendRepository(client);
  const reopenedTemplates = new MessageTemplateRepository(client);
  const persistedStatic = reopenedTemplates.findById(staticTemplate.id);
  const persistedRandom = reopenedTemplates.findById(randomTemplate.id);

  assert.equal(secondMigration.appliedMigrationCount, 3);
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
  assert.ok(persistedStatic);
  assert.ok(persistedRandom);

  const engine = new MessageEngine([new StaticProvider(), new RandomProvider(() => 0.999_999)]);
  assert.equal(await engine.build(persistedStatic), 'Hello');
  assert.equal(await engine.build(persistedRandom), 'Message B');

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
    staticTemplate: 'VERIFIED',
    randomTemplate: 'VERIFIED',
    messageEngine: 'VERIFIED',
    networkAccess: 'NONE',
  };
} finally {
  client?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({ ...smokeResult, cleanup: 'PASS' }));
