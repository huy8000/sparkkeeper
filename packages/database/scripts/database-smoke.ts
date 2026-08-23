import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AccountRepository, createDatabase, type DatabaseClient } from '../src/index.js';

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sparkkeeper-database-smoke-'));
const databasePath = path.join(temporaryDirectory, 'sparkkeeper.db');
let client: DatabaseClient | undefined;
let smokeResult: Record<string, string | number> | undefined;

try {
  client = createDatabase({ databasePath });
  const firstMigration = client.migrate();
  const firstInspection = client.inspect();

  assert.equal(firstMigration.appliedMigrationCount, 1);
  assert.equal(firstInspection.pragmas.journalMode, 'wal');
  assert.equal(firstInspection.pragmas.foreignKeys, 1);

  const repository = new AccountRepository(client);
  const created = repository.create({
    name: 'Test Account',
    enabled: true,
    loginStatus: 'READY',
  });

  client.close();
  client = createDatabase({ databasePath });
  const secondMigration = client.migrate();
  const reopened = new AccountRepository(client).findById(created.id);

  assert.equal(secondMigration.appliedMigrationCount, 1);
  assert.equal(reopened?.name, 'Test Account');
  assert.equal(reopened?.loginStatus, 'READY');

  smokeResult = {
    freshMigration: 'PASS',
    journalMode: 'wal',
    foreignKeys: 1,
    createAccount: 'PASS',
    closeReopen: 'PASS',
    repeatedMigration: 'PASS',
    persistence: 'PASS',
  };
} finally {
  client?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(JSON.stringify({ ...smokeResult, cleanup: 'PASS' }));
