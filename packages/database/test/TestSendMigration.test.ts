import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import {
  AccountRepository,
  AdminUserRepository,
  MessageTemplateRepository,
  ExecutionRunRepository,
  createDatabase,
} from '../src/index.js';
import { createV4DiscoveryDatabase } from './testDatabase.js';
test('0011 upgrades populated 0010 and preserves pre-existing TEST_SEND/scheduled-domain rows, repeat/reopen/FKs', (t) => {
  const f = createV4DiscoveryDatabase(t);
  const account = new AccountRepository(f.client).create({ name: 'Synthetic historical account' });
  const admin = new AdminUserRepository(f.client).create({
    username: 'history',
    passwordHash: 'fixture',
  });
  const template = new MessageTemplateRepository(f.client).create({
    name: 'Synthetic historical template',
    providerType: 'STATIC',
    messages: ['Synthetic historical message'],
  });
  const runs = new ExecutionRunRepository(f.client);
  const old = [0, 1].map((n) =>
    runs.create({
      kind: 'TEST_SEND',
      accountId: account.id,
      templateId: template.id,
      requestedByAdminUserId: admin.id,
      confirmedAt: new Date(),
      idempotencyKey: `historical-${n}`,
    }),
  );
  assert.equal(f.client.migrate().appliedMigrationCount, 13);
  assert.equal(f.client.migrate().appliedMigrationCount, 13);
  const reopened = createDatabase({ databasePath: f.databasePath });
  t.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 13);
  for (const r of old) assert.deepEqual(new ExecutionRunRepository(reopened).findById(r.id), r);
  const sql = new BetterSqlite3(f.databasePath);
  t.after(() => sql.close());
  assert.deepEqual(sql.pragma('foreign_key_check'), []);
  assert.equal(
    (sql.prepare('SELECT count(*) n FROM test_send_intents').get() as { n: number }).n,
    0,
  );
  const names = sql
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'test_send_%'")
    .all()
    .map((v) => (v as { name: string }).name);
  for (const name of [
    'test_send_intent_immutable',
    'test_send_record_guard',
    'test_send_run_guard',
    'test_send_intents_active_idx',
  ])
    assert.ok(names.includes(name));
});
