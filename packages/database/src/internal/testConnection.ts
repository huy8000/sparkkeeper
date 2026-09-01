/**
 * Internal test-only helper for accessing the physical SQLite connection of a DatabaseClient.
 * This file is NOT exported in packages/database/src/index.ts (not part of public API).
 */
import type BetterSqlite3 from 'better-sqlite3';
import type { DatabaseClient } from '../client/DatabaseClient.js';

export function getInternalSqliteDriverForTest(client: DatabaseClient): BetterSqlite3.Database {
  return (client as unknown as { sqlite: BetterSqlite3.Database }).sqlite;
}
