import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { AccountRepository, AdminUserRepository, createDatabase } from '../src/index.js';
import { createV4OnboardingDatabase } from './testDatabase.js';

test('0010 upgrades populated 0009 without losing parent/identity/FK history or triggers', (t) => {
  const { client, databasePath } = createV4OnboardingDatabase(t);
  const account = new AccountRepository(client).create({ name: 'synthetic' });
  const admin = new AdminUserRepository(client).create({
    username: 'fixture',
    passwordHash: 'fixture',
  });
  const sqlite = new BetterSqlite3(databasePath);
  const run = randomUUID(),
    contact = randomUUID(),
    identity = randomUUID();
  sqlite
    .prepare(
      "INSERT INTO contact_sync_runs (id,account_id,requested_by_admin_user_id,status,is_complete,finished_at,created_at,updated_at) VALUES (?,?,?,'COMPLETE',1,1000,1000,1000)",
    )
    .run(run, account.id, admin.id);
  sqlite
    .prepare(
      "INSERT INTO contacts (id,account_id,type,display_name,discovered_at,last_seen_at,last_full_sync_id,missed_full_sync_count,created_at,updated_at) VALUES (?,?,'PERSON','synthetic',1000,1000,?,2,1000,1000)",
    )
    .run(contact, account.id, run);
  sqlite
    .prepare(
      "INSERT INTO contact_identities (id,account_id,contact_id,kind,value,normalized_value,source,is_preferred,first_observed_at,last_observed_at,created_at,updated_at) VALUES (?,?,?,'SEC_UID','synthetic-uid','synthetic-uid','DOM',1,1000,1000,1000,1000)",
    )
    .run(identity, account.id, contact);
  sqlite.exec(
    'CREATE TRIGGER fixture_contact_trigger AFTER UPDATE ON contacts BEGIN SELECT 1; END',
  );
  sqlite.exec('CREATE INDEX fixture_contact_index ON contacts (last_seen_at)');
  sqlite.close();
  const before = Date.now();
  assert.equal(client.migrate().appliedMigrationCount, 14);
  assert.equal(client.migrate().appliedMigrationCount, 14);
  const reopened = createDatabase({ databasePath });
  t.after(() => reopened.close());
  reopened.migrate();
  const check = new BetterSqlite3(databasePath);
  t.after(() => check.close());
  assert.deepEqual(check.pragma('foreign_key_check'), []);
  const row = check.prepare('SELECT * FROM contacts WHERE id=?').get(contact) as Record<
    string,
    unknown
  >;
  assert.equal(row.last_full_sync_id, run);
  assert.equal(row.missed_full_sync_count, 2);
  assert.ok((row.first_missing_at as number) >= before - 1000);
  assert.equal(row.updated_at, 1000);
  assert.equal(
    (
      check.prepare('SELECT contact_id FROM contact_identities WHERE id=?').get(identity) as {
        contact_id: string;
      }
    ).contact_id,
    contact,
  );
  assert.ok(
    check
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='fixture_contact_trigger'",
      )
      .get(),
  );
  assert.ok(
    check
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='fixture_contact_index'")
      .get(),
  );
});
test('0010 rejects dirty global active history and rolls back migration/data', (t) => {
  const { client, databasePath } = createV4OnboardingDatabase(t);
  const a = new AccountRepository(client).create({ name: 'synthetic' }),
    u = new AdminUserRepository(client).create({ username: 'fixture', passwordHash: 'fixture' });
  const db = new BetterSqlite3(databasePath);
  t.after(() => db.close());
  for (let i = 0; i < 2; i++)
    db.prepare(
      'INSERT INTO contact_sync_runs (id,account_id,requested_by_admin_user_id,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run(randomUUID(), a.id, u.id, 1000, 1000);
  assert.throws(() => client.migrate());
  assert.equal(
    (db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n,
    10,
  );
  assert.equal(
    (db.prepare('SELECT count(*) AS n FROM contact_sync_runs').get() as { n: number }).n,
    2,
  );
  assert.equal(client.inspect().pragmas.foreignKeys, 1);
});
