import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { AccountRepository, openDatabaseReadOnly } from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

test('read-only database access inspects V1 state without changing business database bytes', (context) => {
  const temporary = createTemporaryDatabase(context);
  new AccountRepository(temporary.client).create({ name: 'Test Account' });
  temporary.client.close();
  const beforeHash = sha256(temporary.databasePath);

  const client = openDatabaseReadOnly({ databasePath: temporary.databasePath });
  const inspection = client.inspect();
  client.close();

  assert.equal(inspection.appliedMigrationCount, 8);
  assert.equal(inspection.pragmas.journalMode, 'wal');
  assert.equal(inspection.pragmas.foreignKeys, 1);
  assert.equal(inspection.pragmas.busyTimeoutMs, 5_000);
  assert.equal(inspection.pragmas.synchronous, 2);
  assert.equal(sha256(temporary.databasePath), beforeHash);
});

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
