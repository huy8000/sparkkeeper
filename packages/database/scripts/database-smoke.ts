import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MessageEngine, RandomProvider, StaticProvider } from '@sparkkeeper/message-engine';
import { parseBusinessDate } from '@sparkkeeper/shared';

import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  SendRecordRepository,
  type DatabaseClient,
} from '../src/index.js';

const firstBusinessDate = parseBusinessDate('2026-08-23');
const nextBusinessDate = parseBusinessDate('2026-08-24');
const createdAt = new Date('2026-08-23T00:00:00.000Z');
const claimedAt = new Date('2026-08-23T00:01:00.000Z');
const finishedAt = new Date('2026-08-23T00:02:00.000Z');

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sparkkeeper-database-smoke-'));
const databasePath = path.join(temporaryDirectory, 'sparkkeeper.db');
let client: DatabaseClient | undefined;
let smokeResult: Record<string, string | number> | undefined;

try {
  client = createDatabase({ databasePath });
  const firstMigration = client.migrate();
  const firstInspection = client.inspect();

  assert.equal(firstMigration.appliedMigrationCount, 4);
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
  const engine = new MessageEngine([new StaticProvider(), new RandomProvider(() => 0.999_999)]);
  const messageText = await engine.build(staticTemplate);
  const dailyRunsRepository = new DailyRunRepository(client);
  const firstRun = dailyRunsRepository.createOrGet({
    accountId: account.id,
    businessDate: firstBusinessDate,
    now: createdAt,
  });
  const repeatedRun = dailyRunsRepository.createOrGet({
    accountId: account.id,
    businessDate: firstBusinessDate,
    now: new Date('2026-08-23T00:00:01.000Z'),
  });
  assert.equal(repeatedRun.id, firstRun.id);

  const sendRecordsRepository = new SendRecordRepository(client);
  const prepared = sendRecordsRepository.prepare({
    dailyRunId: firstRun.id,
    friendId: alice.id,
    businessDate: firstBusinessDate,
    messageTemplateId: staticTemplate.id,
    messageText,
    now: createdAt,
  });
  assert.equal(prepared.type, 'PREPARED');
  const repeatedPreparation = sendRecordsRepository.prepare({
    dailyRunId: firstRun.id,
    friendId: alice.id,
    businessDate: firstBusinessDate,
    messageTemplateId: randomTemplate.id,
    messageText: 'Message B',
    now: new Date('2026-08-23T00:00:01.000Z'),
  });
  assert.equal(repeatedPreparation.type, 'ALREADY_PREPARED');
  assert.equal(repeatedPreparation.record.id, prepared.record.id);
  assert.equal(repeatedPreparation.record.messageText, messageText);
  assert.equal(
    sendRecordsRepository.claimForExecution(prepared.record.id, claimedAt).type,
    'CLAIMED',
  );
  assert.equal(
    sendRecordsRepository.claimForExecution(prepared.record.id, claimedAt).type,
    'NOT_CLAIMABLE',
  );
  sendRecordsRepository.markSuccess(prepared.record.id, finishedAt);

  client.close();
  client = createDatabase({ databasePath });
  const secondMigration = client.migrate();
  const reopenedAccount = new AccountRepository(client).findById(account.id);
  const reopenedFriends = new FriendRepository(client);
  const reopenedTemplates = new MessageTemplateRepository(client);
  const persistedStatic = reopenedTemplates.findById(staticTemplate.id);
  const persistedRandom = reopenedTemplates.findById(randomTemplate.id);

  assert.equal(secondMigration.appliedMigrationCount, 4);
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

  assert.equal(await engine.build(persistedStatic), 'Hello');
  assert.equal(await engine.build(persistedRandom), 'Message B');

  const reopenedRuns = new DailyRunRepository(client);
  const reopenedRecords = new SendRecordRepository(client);
  const persistedRun = reopenedRuns.findByAccountAndBusinessDate(account.id, firstBusinessDate);
  assert.equal(persistedRun?.id, firstRun.id);
  assert.equal(reopenedRuns.listByAccountId(account.id).length, 1);
  const persistedRecords = reopenedRecords.listByDailyRunId(firstRun.id);
  assert.equal(persistedRecords.length, 1);
  assert.equal(persistedRecords[0]?.status, 'SUCCESS');
  assert.equal(persistedRecords[0]?.messageText, messageText);

  const repeatedAfterReopen = reopenedRecords.prepare({
    dailyRunId: firstRun.id,
    friendId: alice.id,
    businessDate: firstBusinessDate,
    messageTemplateId: randomTemplate.id,
    messageText: 'Message A',
    now: new Date('2026-08-23T00:03:00.000Z'),
  });
  assert.equal(repeatedAfterReopen.type, 'ALREADY_PREPARED');
  assert.equal(repeatedAfterReopen.record.status, 'SUCCESS');
  assert.equal(repeatedAfterReopen.record.messageText, messageText);

  const nextRun = reopenedRuns.createOrGet({
    accountId: account.id,
    businessDate: nextBusinessDate,
    now: new Date('2026-08-24T00:00:00.000Z'),
  });
  const nextRecord = reopenedRecords.prepare({
    dailyRunId: nextRun.id,
    friendId: alice.id,
    businessDate: nextBusinessDate,
    messageTemplateId: randomTemplate.id,
    messageText: 'Message A',
    now: new Date('2026-08-24T00:00:00.000Z'),
  });
  assert.equal(nextRecord.type, 'PREPARED');
  assert.equal(nextRecord.record.status, 'READY');

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
    dailyRunIdempotency: 'VERIFIED',
    sendRecordIdempotency: 'VERIFIED',
    messageSnapshot: 'VERIFIED',
    conditionalClaim: 'VERIFIED',
    successTerminal: 'VERIFIED',
    nextBusinessDate: 'VERIFIED',
    networkAccess: 'NONE',
  };
} finally {
  client?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({ ...smokeResult, cleanup: 'PASS' }));
