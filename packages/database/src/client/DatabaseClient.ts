import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as applyDrizzleMigrations } from 'drizzle-orm/better-sqlite3/migrator';

import { resolveDatabasePath, type ResolveDatabasePathOptions } from '../config/databaseConfig.js';
import * as schema from '../schema/index.js';
import {
  DatabaseClientError,
  DatabaseInitializationError,
  DatabaseMigrationError,
  DatabaseSchemaError,
} from './errors.js';

export const DATABASE_BUSY_TIMEOUT_MS = 5_000;
export const DATABASE_SYNCHRONOUS_MODE = 2;
export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../migrations', import.meta.url),
);

export interface CreateDatabaseOptions extends ResolveDatabasePathOptions {
  readonly migrationsDirectory?: string;
}

export interface DatabasePragmaState {
  readonly journalMode: string;
  readonly foreignKeys: number;
  readonly busyTimeoutMs: number;
  readonly synchronous: number;
}

export interface DatabaseColumnState {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
}

export interface DatabaseInspection {
  readonly databasePath: string;
  readonly pragmas: DatabasePragmaState;
  readonly tables: readonly string[];
  readonly appliedMigrationCount: number;
  readonly accountColumns: readonly DatabaseColumnState[];
  readonly accountsSchemaCompatible: boolean;
}

export interface DatabaseMigrationResult {
  readonly appliedMigrationCount: number;
  readonly accountsSchemaVerified: true;
}

interface SqliteCountRow {
  readonly count: number;
}

interface SqliteNameRow {
  readonly name: string;
}

interface SqliteTableInfoRow {
  readonly name: string;
  readonly type: string;
  readonly notnull: 0 | 1;
  readonly pk: 0 | 1;
}

const EXPECTED_ACCOUNT_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'name', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'login_status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'last_login_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

export class DatabaseClient {
  readonly databasePath: string;
  readonly orm: BetterSQLite3Database<typeof schema>;

  private readonly sqlite: BetterSqlite3.Database;
  private readonly migrationsDirectory: string;
  private closed = false;

  constructor(databasePath: string, sqlite: BetterSqlite3.Database, migrationsDirectory: string) {
    this.databasePath = databasePath;
    this.sqlite = sqlite;
    this.migrationsDirectory = migrationsDirectory;
    this.orm = drizzle({ client: sqlite, schema });
  }

  migrate(): DatabaseMigrationResult {
    this.assertOpen();

    try {
      applyDrizzleMigrations(this.orm, { migrationsFolder: this.migrationsDirectory });
    } catch (error) {
      throw new DatabaseMigrationError(
        `Failed to apply database migrations from "${this.migrationsDirectory}".`,
        error,
      );
    }

    const inspection = this.inspect();
    if (!inspection.accountsSchemaCompatible) {
      throw new DatabaseSchemaError(
        'Database migrations completed, but the accounts table is incompatible with the Drizzle schema.',
      );
    }

    return {
      appliedMigrationCount: inspection.appliedMigrationCount,
      accountsSchemaVerified: true,
    };
  }

  inspect(): DatabaseInspection {
    this.assertOpen();

    const tables = this.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
      )
      .all() as SqliteNameRow[];
    const tableNames = tables.map(({ name }) => name);
    const accountColumns = tableNames.includes('accounts') ? this.readAccountColumns() : [];

    return {
      databasePath: this.databasePath,
      pragmas: readPragmaState(this.sqlite),
      tables: tableNames,
      appliedMigrationCount: tableNames.includes('__drizzle_migrations')
        ? this.readMigrationCount()
        : 0,
      accountColumns,
      accountsSchemaCompatible: accountColumnsMatch(accountColumns),
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.sqlite.close();
    this.closed = true;
  }

  isOpen(): boolean {
    return !this.closed && this.sqlite.open;
  }

  private assertOpen(): void {
    if (!this.isOpen()) {
      throw new DatabaseClientError('Database client is closed.');
    }
  }

  private readMigrationCount(): number {
    const row = this.sqlite
      .prepare('select count(*) as count from "__drizzle_migrations"')
      .get() as SqliteCountRow;
    return row.count;
  }

  private readAccountColumns(): DatabaseColumnState[] {
    const rows = this.sqlite.pragma('table_info(accounts)') as SqliteTableInfoRow[];
    return rows.map((row) => ({
      name: row.name,
      type: row.type.toUpperCase(),
      notNull: row.notnull === 1,
      primaryKey: row.pk === 1,
    }));
  }
}

export function createDatabase(options: CreateDatabaseOptions = {}): DatabaseClient {
  const databasePath = resolveDatabasePath(options);
  const migrationsDirectory = path.resolve(
    options.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY,
  );

  try {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  } catch (error) {
    throw new DatabaseInitializationError(
      `Unable to create the database directory for "${databasePath}".`,
      error,
    );
  }

  let sqlite: BetterSqlite3.Database;
  try {
    sqlite = new BetterSqlite3(databasePath);
  } catch (error) {
    throw new DatabaseInitializationError(
      `Unable to open SQLite database "${databasePath}".`,
      error,
    );
  }

  try {
    applyPragmas(sqlite);
    return new DatabaseClient(databasePath, sqlite, migrationsDirectory);
  } catch (error) {
    sqlite.close();
    throw new DatabaseInitializationError(
      `Unable to initialize SQLite database "${databasePath}".`,
      error,
    );
  }
}

function applyPragmas(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma(`busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS}`);
  sqlite.pragma('synchronous = FULL');

  const state = readPragmaState(sqlite);
  if (
    state.journalMode !== 'wal' ||
    state.foreignKeys !== 1 ||
    state.busyTimeoutMs !== DATABASE_BUSY_TIMEOUT_MS ||
    state.synchronous !== DATABASE_SYNCHRONOUS_MODE
  ) {
    throw new DatabaseClientError(
      'SQLite PRAGMA initialization did not produce the required state.',
    );
  }
}

function readPragmaState(sqlite: BetterSqlite3.Database): DatabasePragmaState {
  return {
    journalMode: String(sqlite.pragma('journal_mode', { simple: true })).toLowerCase(),
    foreignKeys: Number(sqlite.pragma('foreign_keys', { simple: true })),
    busyTimeoutMs: Number(sqlite.pragma('busy_timeout', { simple: true })),
    synchronous: Number(sqlite.pragma('synchronous', { simple: true })),
  };
}

function accountColumnsMatch(actual: readonly DatabaseColumnState[]): boolean {
  return (
    actual.length === EXPECTED_ACCOUNT_COLUMNS.length &&
    actual.every((column, index) => {
      const expected = EXPECTED_ACCOUNT_COLUMNS[index];
      return (
        expected !== undefined &&
        column.name === expected.name &&
        column.type === expected.type &&
        column.notNull === expected.notNull &&
        column.primaryKey === expected.primaryKey
      );
    })
  );
}
