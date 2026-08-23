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
  readonly dailyRunColumns: readonly DatabaseColumnState[];
  readonly friendColumns: readonly DatabaseColumnState[];
  readonly messageTemplateColumns: readonly DatabaseColumnState[];
  readonly sendRecordColumns: readonly DatabaseColumnState[];
  readonly accountsSchemaCompatible: boolean;
  readonly dailyRunsSchemaCompatible: boolean;
  readonly friendsSchemaCompatible: boolean;
  readonly messageTemplatesSchemaCompatible: boolean;
  readonly sendRecordsSchemaCompatible: boolean;
}

export interface DatabaseMigrationResult {
  readonly appliedMigrationCount: number;
  readonly accountsSchemaVerified: true;
  readonly dailyRunsSchemaVerified: true;
  readonly friendsSchemaVerified: true;
  readonly messageTemplatesSchemaVerified: true;
  readonly sendRecordsSchemaVerified: true;
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

const EXPECTED_FRIEND_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'display_name', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'remark_name', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'short_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'unique_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'sec_uid', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'match_field', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'match_key', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_DAILY_RUN_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'business_date', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'finished_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_MESSAGE_TEMPLATE_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'name', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'provider_type', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'content', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_SEND_RECORD_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'daily_run_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'friend_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'business_date', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'message_template_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'message_text', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'finished_at', type: 'INTEGER', notNull: false, primaryKey: false },
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
    if (
      !inspection.accountsSchemaCompatible ||
      !inspection.dailyRunsSchemaCompatible ||
      !inspection.friendsSchemaCompatible ||
      !inspection.messageTemplatesSchemaCompatible ||
      !inspection.sendRecordsSchemaCompatible
    ) {
      throw new DatabaseSchemaError(
        'Database migrations completed, but the database tables are incompatible with the Drizzle schema.',
      );
    }

    return {
      appliedMigrationCount: inspection.appliedMigrationCount,
      accountsSchemaVerified: true,
      dailyRunsSchemaVerified: true,
      friendsSchemaVerified: true,
      messageTemplatesSchemaVerified: true,
      sendRecordsSchemaVerified: true,
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
    const dailyRunColumns = tableNames.includes('daily_runs') ? this.readDailyRunColumns() : [];
    const friendColumns = tableNames.includes('friends') ? this.readFriendColumns() : [];
    const messageTemplateColumns = tableNames.includes('message_templates')
      ? this.readMessageTemplateColumns()
      : [];
    const sendRecordColumns = tableNames.includes('send_records')
      ? this.readSendRecordColumns()
      : [];

    return {
      databasePath: this.databasePath,
      pragmas: readPragmaState(this.sqlite),
      tables: tableNames,
      appliedMigrationCount: tableNames.includes('__drizzle_migrations')
        ? this.readMigrationCount()
        : 0,
      accountColumns,
      dailyRunColumns,
      friendColumns,
      messageTemplateColumns,
      sendRecordColumns,
      accountsSchemaCompatible: accountColumnsMatch(accountColumns),
      dailyRunsSchemaCompatible: dailyRunColumnsMatch(dailyRunColumns),
      friendsSchemaCompatible: friendColumnsMatch(friendColumns),
      messageTemplatesSchemaCompatible: messageTemplateColumnsMatch(messageTemplateColumns),
      sendRecordsSchemaCompatible: sendRecordColumnsMatch(sendRecordColumns),
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

  private readFriendColumns(): DatabaseColumnState[] {
    const rows = this.sqlite.pragma('table_info(friends)') as SqliteTableInfoRow[];
    return rows.map((row) => ({
      name: row.name,
      type: row.type.toUpperCase(),
      notNull: row.notnull === 1,
      primaryKey: row.pk === 1,
    }));
  }

  private readDailyRunColumns(): DatabaseColumnState[] {
    const rows = this.sqlite.pragma('table_info(daily_runs)') as SqliteTableInfoRow[];
    return rows.map((row) => ({
      name: row.name,
      type: row.type.toUpperCase(),
      notNull: row.notnull === 1,
      primaryKey: row.pk === 1,
    }));
  }

  private readMessageTemplateColumns(): DatabaseColumnState[] {
    const rows = this.sqlite.pragma('table_info(message_templates)') as SqliteTableInfoRow[];
    return rows.map((row) => ({
      name: row.name,
      type: row.type.toUpperCase(),
      notNull: row.notnull === 1,
      primaryKey: row.pk === 1,
    }));
  }

  private readSendRecordColumns(): DatabaseColumnState[] {
    const rows = this.sqlite.pragma('table_info(send_records)') as SqliteTableInfoRow[];
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
  return columnsMatch(actual, EXPECTED_ACCOUNT_COLUMNS);
}

function friendColumnsMatch(actual: readonly DatabaseColumnState[]): boolean {
  return columnsMatch(actual, EXPECTED_FRIEND_COLUMNS);
}

function dailyRunColumnsMatch(actual: readonly DatabaseColumnState[]): boolean {
  return columnsMatch(actual, EXPECTED_DAILY_RUN_COLUMNS);
}

function messageTemplateColumnsMatch(actual: readonly DatabaseColumnState[]): boolean {
  return columnsMatch(actual, EXPECTED_MESSAGE_TEMPLATE_COLUMNS);
}

function sendRecordColumnsMatch(actual: readonly DatabaseColumnState[]): boolean {
  return columnsMatch(actual, EXPECTED_SEND_RECORD_COLUMNS);
}

function columnsMatch(
  actual: readonly DatabaseColumnState[],
  expectedColumns: readonly DatabaseColumnState[],
): boolean {
  return (
    actual.length === expectedColumns.length &&
    actual.every((column, index) => {
      const expected = expectedColumns[index];
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
