import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createDatabase,
  DATABASE_BUSY_TIMEOUT_MS,
  DATABASE_SYNCHRONOUS_MODE,
  DatabaseClientError,
  DatabaseInitializationError,
  resolveDatabasePath,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

test('resolves the default database below the project data directory', () => {
  assert.equal(
    resolveDatabasePath({ cwd: '/workspace/sparkkeeper', environment: {} }),
    path.resolve('/workspace/sparkkeeper/data/sparkkeeper.db'),
  );
});

test('resolves the database from DATA_DIR', () => {
  assert.equal(
    resolveDatabasePath({
      cwd: '/workspace/sparkkeeper',
      environment: { DATA_DIR: './runtime-data' },
    }),
    path.resolve('/workspace/sparkkeeper/runtime-data/sparkkeeper.db'),
  );
});

test('programmatic database path override takes precedence over DATA_DIR', () => {
  assert.equal(
    resolveDatabasePath({
      cwd: '/workspace/sparkkeeper',
      databasePath: './temporary/test.db',
      environment: { DATA_DIR: './ignored' },
    }),
    path.resolve('/workspace/sparkkeeper/temporary/test.db'),
  );
});

test('database creation ensures the parent directory exists', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-database-parent-test-'));
  const nestedDirectory = path.join(directory, 'nested', 'data');
  const databasePath = path.join(nestedDirectory, 'sparkkeeper.db');
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const client = createDatabase({ databasePath });
  context.after(() => client.close());

  assert.equal(existsSync(nestedDirectory), true);
  assert.equal(existsSync(databasePath), true);
});

test('database creation reports a meaningful directory creation error', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-database-dir-error-'));
  const blockingFile = path.join(directory, 'blocking-file');
  writeFileSync(blockingFile, 'controlled test file');
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  assert.throws(
    () => createDatabase({ databasePath: path.join(blockingFile, 'sparkkeeper.db') }),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseInitializationError);
      assert.match(error.message, /create the database directory/i);
      return true;
    },
  );
});

test('database creation reports a meaningful SQLite open error', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-database-open-error-'));
  const databasePath = path.join(directory, 'directory-not-a-file');
  mkdirSync(databasePath);
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  assert.throws(
    () => createDatabase({ databasePath }),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseInitializationError);
      assert.match(error.message, /open SQLite database/i);
      return true;
    },
  );
});

test('database initialization applies and verifies the required PRAGMAs', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });
  const state = client.inspect().pragmas;

  assert.deepEqual(state, {
    journalMode: 'wal',
    foreignKeys: 1,
    busyTimeoutMs: DATABASE_BUSY_TIMEOUT_MS,
    synchronous: DATABASE_SYNCHRONOUS_MODE,
  });
});

test('database ping is a lightweight read and fails after close', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.equal(client.ping(), true);
  client.close();
  assert.throws(() => client.ping(), DatabaseClientError);
});

test('database close is idempotent and closed clients fail clearly', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  client.close();
  client.close();

  assert.equal(client.isOpen(), false);
  assert.throws(() => client.inspect(), DatabaseClientError);
});
