import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as applyDrizzleMigrations } from 'drizzle-orm/better-sqlite3/migrator';

import { createDatabase, DEFAULT_MIGRATIONS_DIRECTORY, type DatabaseClient } from '../src/index.js';

export interface TemporaryDatabase {
  readonly client: DatabaseClient;
  readonly databasePath: string;
  readonly directory: string;
}

export function createTemporaryDatabase(
  context: TestContext,
  options: { readonly migrate?: boolean } = {},
): TemporaryDatabase {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-database-test-'));
  const databasePath = path.join(directory, 'sparkkeeper.db');
  const client = createDatabase({ databasePath });

  context.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });

  if (options.migrate ?? true) {
    client.migrate();
  }

  return { client, databasePath, directory };
}

export function createV1OneDatabase(context: TestContext): TemporaryDatabase {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-v1-one-database-test-'));
  const databasePath = path.join(directory, 'sparkkeeper.db');
  const migrationsDirectory = path.join(directory, 'v1-one-migrations');
  const metadataDirectory = path.join(migrationsDirectory, 'meta');
  mkdirSync(metadataDirectory, { recursive: true });

  copyFileSync(
    path.join(DEFAULT_MIGRATIONS_DIRECTORY, '0000_secret_redwing.sql'),
    path.join(migrationsDirectory, '0000_secret_redwing.sql'),
  );

  const journal = JSON.parse(
    readFileSync(path.join(DEFAULT_MIGRATIONS_DIRECTORY, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  writeFileSync(
    path.join(metadataDirectory, '_journal.json'),
    `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }, null, 2)}\n`,
  );

  const sqlite = new BetterSqlite3(databasePath);
  try {
    applyDrizzleMigrations(drizzle(sqlite), { migrationsFolder: migrationsDirectory });
  } finally {
    sqlite.close();
  }

  const client = createDatabase({ databasePath });
  context.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });

  return { client, databasePath, directory };
}
