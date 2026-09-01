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

test('withBusyTimeout: restores PRAGMA on sync success, sync throw, Promise rejection, and thenable rejection', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  // 1. Initial timeout
  assert.equal(client.inspect().pragmas.busyTimeoutMs, DATABASE_BUSY_TIMEOUT_MS);

  // 2. Sync success callback
  const result = client.withBusyTimeout(123, () => {
    assert.equal(client.inspect().pragmas.busyTimeoutMs, 123);
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(client.inspect().pragmas.busyTimeoutMs, DATABASE_BUSY_TIMEOUT_MS);

  // 3. Sync throw callback
  assert.throws(
    () => {
      client.withBusyTimeout(234, () => {
        assert.equal(client.inspect().pragmas.busyTimeoutMs, 234);
        throw new Error('sync throw test');
      });
    },
    (err: unknown) => err instanceof Error && err.message === 'sync throw test',
  );
  assert.equal(client.inspect().pragmas.busyTimeoutMs, DATABASE_BUSY_TIMEOUT_MS);

  // 4. Promise-returning callback is synchronously rejected and restores timeout
  assert.throws(
    () => {
      client.withBusyTimeout(345, (() => {
        return Promise.resolve('async result');
      }) as unknown as () => string);
    },
    (err: unknown) =>
      err instanceof DatabaseClientError &&
      /does not support asynchronous or Promise-returning callbacks/i.test(err.message),
  );
  assert.equal(client.inspect().pragmas.busyTimeoutMs, DATABASE_BUSY_TIMEOUT_MS);

  // 5. Thenable object callback is synchronously rejected and restores timeout
  assert.throws(
    () => {
      client.withBusyTimeout(456, (() => {
        return { then: () => {} };
      }) as unknown as () => unknown);
    },
    (err: unknown) =>
      err instanceof DatabaseClientError &&
      /does not support asynchronous or Promise-returning callbacks/i.test(err.message),
  );
  assert.equal(client.inspect().pragmas.busyTimeoutMs, DATABASE_BUSY_TIMEOUT_MS);
});

test('withBusyTimeout: compile-time rejection of async and Promise-returning callbacks', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  // Compile-time allowed: Synchronous number callback
  const syncNum: number = client.withBusyTimeout(100, () => 123);
  assert.equal(syncNum, 123);

  // Compile-time allowed: Synchronous object callback
  const syncObj: { ok: boolean } = client.withBusyTimeout(100, () => ({ ok: true }));
  assert.deepEqual(syncObj, { ok: true });

  // Compile-time allowed: Synchronous union callback (number | string)
  const syncUnion: number | string = client.withBusyTimeout(100, () =>
    Math.random() > 0.5 ? 123 : 'abc',
  );
  assert.ok(typeof syncUnion === 'number' || typeof syncUnion === 'string');

  // Compile-time REJECTED: async callback
  assert.throws(() => {
    // @ts-expect-error async function returns Promise<number>, which must be rejected at compile time
    client.withBusyTimeout(100, async () => 123);
  }, DatabaseClientError);

  // Compile-time REJECTED: explicit Promise return
  assert.throws(() => {
    // @ts-expect-error Promise-returning function must be rejected at compile time
    client.withBusyTimeout(100, () => Promise.resolve(123));
  }, DatabaseClientError);

  // Compile-time REJECTED: explicit PromiseLike / thenable return
  assert.throws(() => {
    // @ts-expect-error Thenable-returning function must be rejected at compile time
    client.withBusyTimeout(100, () => ({ then() {} }));
  }, DatabaseClientError);

  // Compile-time REJECTED: union of number | Promise<number>
  assert.throws(() => {
    // @ts-expect-error Union return type containing Promise must be rejected at compile time
    client.withBusyTimeout(100, (): number | Promise<number> => Promise.resolve(456));
  }, DatabaseClientError);

  // Compile-time REJECTED: union of string | PromiseLike<string>
  assert.throws(() => {
    // @ts-expect-error Union return type containing PromiseLike must be rejected at compile time
    client.withBusyTimeout(100, (): string | PromiseLike<string> => ({ then() {} }));
  }, DatabaseClientError);

  // Compile-time REJECTED: union of number | string | Promise<void>
  assert.throws(() => {
    // @ts-expect-error Union return type containing Promise must be rejected at compile time
    client.withBusyTimeout(100, (): number | string | Promise<void> => Promise.resolve());
  }, DatabaseClientError);
});
