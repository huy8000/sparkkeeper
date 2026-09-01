import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';

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
  return createHistoricalDatabase(context, 'v1-one', 1);
}

export function createV1TwoDatabase(context: TestContext): TemporaryDatabase {
  return createHistoricalDatabase(context, 'v1-two', 2);
}

export function createV1ThreeDatabase(context: TestContext): TemporaryDatabase {
  return createHistoricalDatabase(context, 'v1-three', 3);
}

export function createV1FourDatabase(context: TestContext): TemporaryDatabase {
  return createHistoricalDatabase(context, 'v1-four', 4);
}

export function createV1FiveDatabase(context: TestContext): TemporaryDatabase {
  return createHistoricalDatabase(context, 'v1-five', 5);
}

export function createV1SixDatabase(context: TestContext): TemporaryDatabase {
  return createHistoricalDatabase(context, 'v1-six', 6);
}

export function createV1SevenDatabase(context: TestContext): TemporaryDatabase {
  return createHistoricalDatabase(context, 'v1-seven', 7);
}

export function createV1EightDatabase(context: TestContext): TemporaryDatabase {
  return createHistoricalDatabase(context, 'v1-eight', 8);
}

export function insertLegacyAccount(
  databasePath: string,
  input: { id?: string; name: string; loginStatus?: string; nowMs?: number },
): { id: string; name: string } {
  const id = input.id ?? randomUUID();
  const nowMs = input.nowMs ?? Date.now();
  const sqlite = new BetterSqlite3(databasePath);
  try {
    sqlite
      .prepare(
        `insert into accounts (id, name, enabled, login_status, last_login_at, created_at, updated_at)
         values (?, ?, 1, ?, null, ?, ?)`,
      )
      .run(id, input.name, input.loginStatus ?? 'UNKNOWN', nowMs, nowMs);
    return { id, name: input.name };
  } finally {
    sqlite.close();
  }
}

function createHistoricalDatabase(
  context: TestContext,
  label: string,
  migrationCount: number,
): TemporaryDatabase {
  const directory = mkdtempSync(path.join(tmpdir(), `sparkkeeper-${label}-database-test-`));
  const databasePath = path.join(directory, 'sparkkeeper.db');
  const migrationsDirectory = path.join(directory, `${label}-migrations`);
  const metadataDirectory = path.join(migrationsDirectory, 'meta');
  mkdirSync(metadataDirectory, { recursive: true });

  const journal = JSON.parse(
    readFileSync(path.join(DEFAULT_MIGRATIONS_DIRECTORY, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string }> };
  const entries = journal.entries.slice(0, migrationCount);
  for (const entry of entries) {
    copyFileSync(
      path.join(DEFAULT_MIGRATIONS_DIRECTORY, `${entry.tag}.sql`),
      path.join(migrationsDirectory, `${entry.tag}.sql`),
    );
  }
  writeFileSync(
    path.join(metadataDirectory, '_journal.json'),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
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
