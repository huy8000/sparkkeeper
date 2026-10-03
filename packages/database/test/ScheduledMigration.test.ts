import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { AccountRepository, createDatabase } from '../src/index.js';
import { createV4TestSendDatabase } from './testDatabase.js';
test('0012 upgrades populated 0011 without rewriting history; fresh/repeat/reopen/FKs and guards', (t) => {
  const f = createV4TestSendDatabase(t),
    row = new AccountRepository(f.client).create({ name: 'Synthetic prior Account' });
  assert.equal(f.client.migrate().appliedMigrationCount, 13);
  assert.equal(f.client.migrate().appliedMigrationCount, 13);
  const reopened = createDatabase({ databasePath: f.databasePath });
  t.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 13);
  assert.deepEqual(new AccountRepository(reopened).findById(row.id), row);
  const db = new BetterSqlite3(f.databasePath);
  t.after(() => db.close());
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(
    (db.prepare('SELECT count(*) n FROM scheduled_run_snapshots').get() as { n: number }).n,
    0,
  );
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'scheduled_%'")
    .all()
    .map((r) => (r as { name: string }).name);
  for (const name of [
    'scheduled_snapshot_immutable',
    'scheduled_record_guard',
    'scheduled_run_guard',
    'scheduled_snapshots_active_idx',
    'scheduled_snapshots_task_date_idx',
  ])
    assert.ok(names.includes(name));
});
