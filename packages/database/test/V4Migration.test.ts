import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';

import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  FriendRepository,
  ScheduleRepository,
  AccountRepository,
} from '../src/index.js';
import {
  createTemporaryDatabase,
  createV1EightDatabase,
  insertLegacyAccount,
} from './testDatabase.js';

test('V4Migration: fresh database migration creates all 23 tables with PRAGMA state', (context) => {
  const { client, databasePath } = createTemporaryDatabase(context, { migrate: false });

  const result = client.migrate();
  const inspection = client.inspect();

  assert.equal(result.appliedMigrationCount, 9);
  assert.equal(inspection.appliedMigrationCount, 9);
  assert.equal(inspection.pragmas.journalMode, 'wal');
  assert.equal(inspection.pragmas.foreignKeys, 1);
  assert.equal(inspection.tables.length, 24);

  // Check that all 15 new V4 tables are schema compatible
  assert.equal(inspection.adminUsersSchemaCompatible, true);
  assert.equal(inspection.adminSessionsSchemaCompatible, true);
  assert.equal(inspection.accountLoginSessionsSchemaCompatible, true);
  assert.equal(inspection.avatarAssetsSchemaCompatible, true);
  assert.equal(inspection.contactSyncRunsSchemaCompatible, true);
  assert.equal(inspection.contactsSchemaCompatible, true);
  assert.equal(inspection.contactIdentitiesSchemaCompatible, true);
  assert.equal(inspection.sendTasksSchemaCompatible, true);
  assert.equal(inspection.sendTaskTargetsSchemaCompatible, true);
  assert.equal(inspection.executionRunsSchemaCompatible, true);
  assert.equal(inspection.targetSendRecordsSchemaCompatible, true);
  assert.equal(inspection.deliveryResolutionsSchemaCompatible, true);
  assert.equal(inspection.auditEventsSchemaCompatible, true);
  assert.equal(inspection.legacyFriendBindingsSchemaCompatible, true);
  assert.equal(inspection.legacyScheduleImportsSchemaCompatible, true);

  // Foreign keys on key tables
  const sqlite = new BetterSqlite3(databasePath, { readonly: true });
  try {
    const adminSessionFks = sqlite.pragma('foreign_key_list(admin_sessions)') as Array<{
      table: string;
    }>;
    assert.ok(adminSessionFks.some((fk) => fk.table === 'admin_users'));

    const contactFks = sqlite.pragma('foreign_key_list(contacts)') as Array<{ table: string }>;
    assert.ok(contactFks.some((fk) => fk.table === 'accounts'));
    assert.ok(contactFks.some((fk) => fk.table === 'avatar_assets'));
    assert.ok(contactFks.some((fk) => fk.table === 'contact_sync_runs'));

    const targetSendRecordFks = sqlite.pragma('foreign_key_list(target_send_records)') as Array<{
      table: string;
    }>;
    assert.ok(targetSendRecordFks.some((fk) => fk.table === 'execution_runs'));
    assert.ok(targetSendRecordFks.some((fk) => fk.table === 'contacts'));
  } finally {
    sqlite.close();
  }
});

test('V4Migration: upgrades V3 database non-destructively and executes backfills', (context) => {
  const temporary = createV1EightDatabase(context);
  const { client, databasePath } = temporary;
  const now = new Date('2026-08-31T08:00:00.000Z');

  // Insert V3 account, friend, schedule
  const account = insertLegacyAccount(databasePath, {
    id: 'v3-acc-test-1',
    name: 'V3 Account Non Destructive',
    loginStatus: 'READY',
    nowMs: now.getTime(),
  });

  const friendRepo = new FriendRepository(client);
  const friend1 = friendRepo.create({ accountId: account.id, displayName: 'Friend 1', now });
  const friend2 = friendRepo.create({ accountId: account.id, displayName: 'Friend 2', now });

  const scheduleRepo = new ScheduleRepository(client);
  const schedule1 = scheduleRepo.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 3,
    retryIntervalSeconds: 60,
    now,
  });

  const before = client.inspect();
  assert.equal(before.appliedMigrationCount, 8);
  assert.equal(before.adminUsersSchemaCompatible, false);

  // Perform migration to V4
  const migrationResult = client.migrate();
  assert.equal(migrationResult.appliedMigrationCount, 9);
  assert.equal(migrationResult.accountsSchemaVerified, true);
  assert.equal(migrationResult.legacyFriendBindingsSchemaVerified, true);
  assert.equal(migrationResult.legacyScheduleImportsSchemaVerified, true);

  // Existing account preserved with defaulted V4 columns
  const accountRepo = new AccountRepository(client);
  const updatedAccount = accountRepo.findById(account.id);
  assert.ok(updatedAccount);
  assert.equal(updatedAccount.name, 'V3 Account Non Destructive');
  assert.equal(updatedAccount.profileState, 'MIGRATION_REQUIRED');
  assert.equal(updatedAccount.lifecycleStatus, 'ACTIVE');
  assert.equal(updatedAccount.avatarRemoteUrl, null);
  assert.equal(updatedAccount.douyinSecUid, null);

  // Backfilled legacy friend bindings
  const sqlite = new BetterSqlite3(databasePath, { readonly: true });
  try {
    const bindings = sqlite
      .prepare('select * from legacy_friend_bindings where account_id = ? order by friend_id')
      .all(account.id) as Array<{ id: string; friend_id: string; status: string }>;

    assert.equal(bindings.length, 2);
    const b1 = bindings.find((b) => b.friend_id === friend1.id);
    const b2 = bindings.find((b) => b.friend_id === friend2.id);
    assert.ok(b1);
    assert.equal(b1.id, `v4:legacy-friend-binding:${friend1.id}`);
    assert.equal(b1.status, 'PENDING');
    assert.ok(b2);
    assert.equal(b2.id, `v4:legacy-friend-binding:${friend2.id}`);
    assert.equal(b2.status, 'PENDING');

    // Backfilled legacy schedule imports
    const imports = sqlite
      .prepare('select * from legacy_schedule_imports where account_id = ?')
      .all(account.id) as Array<{
      id: string;
      schedule_id: string;
      status: string;
      start_time: string;
    }>;

    assert.equal(imports.length, 1);
    assert.equal(imports[0]?.schedule_id, schedule1.id);
    assert.equal(imports[0]?.id, `v4:legacy-schedule-import:${schedule1.id}`);
    assert.equal(imports[0]?.status, 'PENDING');
    assert.equal(imports[0]?.start_time, '09:00');
  } finally {
    sqlite.close();
  }

  // Idempotency: re-running migration is safe and doesn't duplicate backfills
  const repeatMigration = client.migrate();
  assert.equal(repeatMigration.appliedMigrationCount, 9);

  const sqliteAfter = new BetterSqlite3(databasePath, { readonly: true });
  try {
    const countBindings = sqliteAfter
      .prepare('select count(*) as c from legacy_friend_bindings')
      .get() as { c: number };
    assert.equal(countBindings.c, 2);
  } finally {
    sqliteAfter.close();
  }
});

test('V4Migration: 0008 snapshot metadata matches V4 schema with 23 tables and 17 account columns', () => {
  const snapshotPath = path.join(DEFAULT_MIGRATIONS_DIRECTORY, 'meta', '0008_snapshot.json');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
    tables: Record<string, { columns: Record<string, unknown> }>;
  };

  const tables = Object.keys(snapshot.tables).sort();
  assert.equal(tables.length, 23);

  const expectedTables = [
    'account_login_sessions',
    'accounts',
    'admin_sessions',
    'admin_users',
    'audit_events',
    'avatar_assets',
    'contact_identities',
    'contact_sync_runs',
    'contacts',
    'daily_runs',
    'delivery_resolutions',
    'execution_runs',
    'friends',
    'legacy_friend_bindings',
    'legacy_schedule_imports',
    'message_templates',
    'notification_configs',
    'schedules',
    'send_records',
    'send_task_targets',
    'send_tasks',
    'system_events',
    'target_send_records',
  ].sort();

  assert.deepEqual(tables, expectedTables);

  const accountCols = Object.keys(snapshot.tables.accounts.columns).sort();
  assert.equal(accountCols.length, 17);

  const expectedAccountCols = [
    'id',
    'name',
    'enabled',
    'login_status',
    'last_login_at',
    'created_at',
    'updated_at',
    'avatar_remote_url',
    'avatar_cache_key',
    'douyin_unique_id',
    'douyin_short_id',
    'douyin_sec_uid',
    'profile_state',
    'lifecycle_status',
    'last_auth_check_at',
    'last_contact_sync_at',
    'unbound_at',
  ].sort();

  assert.deepEqual(accountCols, expectedAccountCols);
});
