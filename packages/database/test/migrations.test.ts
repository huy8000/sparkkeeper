import assert from 'node:assert/strict';
import { parseBusinessDate } from '@sparkkeeper/shared';
import BetterSqlite3 from 'better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import test from 'node:test';

import {
  AccountRepository,
  accounts,
  createDatabase,
  DailyRunRepository,
  dailyRuns,
  DatabaseMigrationError,
  FriendRepository,
  friends,
  MessageTemplateRepository,
  messageTemplates,
  notificationConfigs,
  SendRecordRepository,
  sendRecords,
  ScheduleRepository,
  schedules,
  SystemEventRepository,
  systemEvents,
  adminUsers,
  adminSessions,
  accountLoginSessions,
  avatarAssets,
  contactSyncRuns,
  contacts,
  contactIdentities,
  sendTasks,
  sendTaskTargets,
  executionRuns,
  targetSendRecords,
  deliveryResolutions,
  auditEvents,
  legacyFriendBindings,
  legacyScheduleImports,
  type DatabaseClient,
} from '../src/index.js';
import {
  createTemporaryDatabase,
  createV1OneDatabase,
  createV1TwoDatabase,
  createV1ThreeDatabase,
  createV1FourDatabase,
  createV1FiveDatabase,
  createV1SixDatabase,
  createV1EightDatabase,
  insertLegacyAccount,
} from './testDatabase.js';

test('fresh database migration creates all V4 tables and nine journal entries', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  const result = client.migrate();
  const inspection = client.inspect();

  assert.deepEqual(result, {
    appliedMigrationCount: 9,
    accountsSchemaVerified: true,
    dailyRunsSchemaVerified: true,
    friendsSchemaVerified: true,
    messageTemplatesSchemaVerified: true,
    notificationConfigsSchemaVerified: true,
    sendRecordsSchemaVerified: true,
    schedulesSchemaVerified: true,
    systemEventsSchemaVerified: true,
    adminUsersSchemaVerified: true,
    adminSessionsSchemaVerified: true,
    accountLoginSessionsSchemaVerified: true,
    avatarAssetsSchemaVerified: true,
    contactSyncRunsSchemaVerified: true,
    contactsSchemaVerified: true,
    contactIdentitiesSchemaVerified: true,
    sendTasksSchemaVerified: true,
    sendTaskTargetsSchemaVerified: true,
    executionRunsSchemaVerified: true,
    targetSendRecordsSchemaVerified: true,
    deliveryResolutionsSchemaVerified: true,
    auditEventsSchemaVerified: true,
    legacyFriendBindingsSchemaVerified: true,
    legacyScheduleImportsSchemaVerified: true,
  });
  assert.deepEqual(inspection.tables, [
    '__drizzle_migrations',
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
  ]);
  assert.equal(inspection.appliedMigrationCount, 9);
  assert.equal(inspection.accountsSchemaCompatible, true);
  assert.equal(inspection.dailyRunsSchemaCompatible, true);
  assert.equal(inspection.friendsSchemaCompatible, true);
  assert.equal(inspection.messageTemplatesSchemaCompatible, true);
  assert.equal(inspection.notificationConfigsSchemaCompatible, true);
  assert.equal(inspection.sendRecordsSchemaCompatible, true);
  assert.equal(inspection.schedulesSchemaCompatible, true);
  assert.equal(inspection.systemEventsSchemaCompatible, true);
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
});

test('running migrations twice is safe and does not duplicate the journal entry', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });

  client.migrate();
  const second = client.migrate();

  assert.equal(second.appliedMigrationCount, 9);
  assert.equal(client.inspect().appliedMigrationCount, 9);
});

test('migration state remains correct after close and reopen', (context) => {
  const temporary = createTemporaryDatabase(context, { migrate: false });
  temporary.client.migrate();
  temporary.client.close();

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const result = reopened.migrate();

  assert.equal(result.appliedMigrationCount, 9);
  assert.equal(reopened.inspect().accountsSchemaCompatible, true);
  assert.equal(reopened.inspect().dailyRunsSchemaCompatible, true);
  assert.equal(reopened.inspect().friendsSchemaCompatible, true);
  assert.equal(reopened.inspect().messageTemplatesSchemaCompatible, true);
  assert.equal(reopened.inspect().sendRecordsSchemaCompatible, true);
  assert.equal(reopened.inspect().schedulesSchemaCompatible, true);
  assert.equal(reopened.inspect().systemEventsSchemaCompatible, true);
  assert.equal(reopened.inspect().adminUsersSchemaCompatible, true);
  assert.equal(reopened.inspect().contactsSchemaCompatible, true);
  assert.equal(reopened.inspect().sendTasksSchemaCompatible, true);
  assert.equal(reopened.inspect().executionRunsSchemaCompatible, true);
  reopened.close();
});

test('migrated SQLite columns align with the Drizzle accounts definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(accounts)).map((column) => column.name);
  const sqliteColumnNames = client.inspect().accountColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
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
  ]);
});

test('migrated SQLite columns align with the Drizzle friends definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(friends)).map((column) => column.name);
  const sqliteColumnNames = client.inspect().friendColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'account_id',
    'display_name',
    'remark_name',
    'short_id',
    'unique_id',
    'sec_uid',
    'match_field',
    'match_key',
    'enabled',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle daily_runs definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(dailyRuns)).map((column) => column.name);
  const sqliteColumnNames = client.inspect().dailyRunColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'account_id',
    'business_date',
    'status',
    'started_at',
    'finished_at',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle message_templates definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(messageTemplates)).map(
    (column) => column.name,
  );
  const sqliteColumnNames = client.inspect().messageTemplateColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'name',
    'provider_type',
    'content',
    'enabled',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle notification_configs definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(notificationConfigs)).map(
    (column) => column.name,
  );
  const sqliteColumnNames = client.inspect().notificationConfigColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'enabled',
    'provider',
    'webhook_url',
    'notify_auth_expired',
    'notify_task_failed',
    'notify_consecutive_failure',
    'notify_delivery_unknown',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle send_records definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(sendRecords)).map(
    (column) => column.name,
  );
  const sqliteColumnNames = client.inspect().sendRecordColumns.map((column) => column.name);

  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'daily_run_id',
    'friend_id',
    'business_date',
    'message_template_id',
    'message_text',
    'status',
    'attempt_count',
    'next_retry_at',
    'last_error_code',
    'sent_at',
    'send_action_started_at',
    'started_at',
    'finished_at',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle schedules definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(schedules)).map((column) => column.name);
  const sqliteColumnNames = client.inspect().scheduleColumns.map((column) => column.name);
  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'account_id',
    'start_time',
    'end_time',
    'timezone',
    'max_attempts',
    'retry_interval_seconds',
    'enabled',
    'created_at',
    'updated_at',
  ]);
});

test('migrated SQLite columns align with the Drizzle system_events definition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const drizzleColumnNames = Object.values(getTableColumns(systemEvents)).map(
    (column) => column.name,
  );
  const sqliteColumnNames = client.inspect().systemEventColumns.map((column) => column.name);
  assert.deepEqual(sqliteColumnNames, drizzleColumnNames);
  assert.deepEqual(sqliteColumnNames, [
    'id',
    'event_type',
    'level',
    'run_id',
    'account_id',
    'friend_id',
    'attempt',
    'error_code',
    'message',
    'screenshot_path',
    'trace_path',
    'created_at',
  ]);
});

test('migrated SQLite columns align with V4 Drizzle definitions', (context) => {
  const { client } = createTemporaryDatabase(context);
  const inspect = client.inspect();

  assert.deepEqual(
    inspect.adminUserColumns.map((c) => c.name),
    Object.values(getTableColumns(adminUsers)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.adminSessionColumns.map((c) => c.name),
    Object.values(getTableColumns(adminSessions)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.accountLoginSessionColumns.map((c) => c.name),
    Object.values(getTableColumns(accountLoginSessions)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.avatarAssetColumns.map((c) => c.name),
    Object.values(getTableColumns(avatarAssets)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.contactSyncRunColumns.map((c) => c.name),
    Object.values(getTableColumns(contactSyncRuns)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.contactColumns.map((c) => c.name),
    Object.values(getTableColumns(contacts)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.contactIdentityColumns.map((c) => c.name),
    Object.values(getTableColumns(contactIdentities)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.sendTaskColumns.map((c) => c.name),
    Object.values(getTableColumns(sendTasks)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.sendTaskTargetColumns.map((c) => c.name),
    Object.values(getTableColumns(sendTaskTargets)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.executionRunColumns.map((c) => c.name),
    Object.values(getTableColumns(executionRuns)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.targetSendRecordColumns.map((c) => c.name),
    Object.values(getTableColumns(targetSendRecords)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.deliveryResolutionColumns.map((c) => c.name),
    Object.values(getTableColumns(deliveryResolutions)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.auditEventColumns.map((c) => c.name),
    Object.values(getTableColumns(auditEvents)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.legacyFriendBindingColumns.map((c) => c.name),
    Object.values(getTableColumns(legacyFriendBindings)).map((c) => c.name),
  );
  assert.deepEqual(
    inspect.legacyScheduleImportColumns.map((c) => c.name),
    Object.values(getTableColumns(legacyScheduleImports)).map((c) => c.name),
  );
});

test('existing V1-1 database upgrades through V4 without losing account data', (context) => {
  const temporary = createV1OneDatabase(context);
  const { client } = temporary;
  const account = insertLegacyAccount(temporary.databasePath, {
    name: 'Upgrade Test Account',
    loginStatus: 'READY',
  });

  const before = client.inspect();
  assert.equal(before.appliedMigrationCount, 1);
  assert.equal(before.friendsSchemaCompatible, false);
  assert.equal(before.tables.includes('friends'), false);

  const migration = client.migrate();
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Upgrade Test User',
  });

  assert.equal(migration.appliedMigrationCount, 9);
  assert.equal(client.inspect().appliedMigrationCount, 9);
  assert.equal(new AccountRepository(client).findById(account.id)?.name, 'Upgrade Test Account');
  assert.equal(friend.accountId, account.id);

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const repeated = reopened.migrate();

  assert.equal(repeated.appliedMigrationCount, 9);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'Upgrade Test Account');
  assert.equal(
    new FriendRepository(reopened).findById(friend.id)?.displayName,
    'Upgrade Test User',
  );
  reopened.close();
});

test('existing V1-2 database upgrades through V4 and preserves Account/Friend data', (context) => {
  const temporary = createV1TwoDatabase(context);
  const { client } = temporary;
  const account = insertLegacyAccount(temporary.databasePath, {
    name: 'V1-2 Test Account',
    loginStatus: 'READY',
  });
  const friendsRepository = new FriendRepository(client);
  const alice = friendsRepository.create({ accountId: account.id, displayName: 'Alice' });
  const bob = friendsRepository.create({ accountId: account.id, displayName: 'Bob' });

  const before = client.inspect();
  assert.equal(before.appliedMigrationCount, 2);
  assert.equal(before.friendsSchemaCompatible, true);
  assert.equal(before.messageTemplatesSchemaCompatible, false);
  assert.equal(before.tables.includes('message_templates'), false);

  const migration = client.migrate();
  const templatesRepository = new MessageTemplateRepository(client);
  const template = templatesRepository.create({
    name: 'V1-2 Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });

  assert.equal(migration.appliedMigrationCount, 9);
  assert.equal(client.inspect().appliedMigrationCount, 9);
  assert.equal(new AccountRepository(client).findById(account.id)?.name, 'V1-2 Test Account');
  assert.equal(friendsRepository.findById(alice.id)?.displayName, 'Alice');
  assert.equal(friendsRepository.findById(bob.id)?.displayName, 'Bob');
  assert.equal(template.messages[0], 'Hello');

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const repeated = reopened.migrate();

  assert.equal(repeated.appliedMigrationCount, 9);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'V1-2 Test Account');
  assert.equal(new FriendRepository(reopened).listByAccountId(account.id).length, 2);
  assert.equal(new MessageTemplateRepository(reopened).findById(template.id)?.messages[0], 'Hello');
  reopened.close();
});

test('existing V1-3 database upgrades through V4 and preserves Account/Friend/Template data', (context) => {
  const temporary = createV1ThreeDatabase(context);
  const { client } = temporary;
  const account = insertLegacyAccount(temporary.databasePath, {
    name: 'V1-3 Test Account',
    loginStatus: 'READY',
  });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Alice',
  });
  const template = new MessageTemplateRepository(client).create({
    name: 'V1-3 Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });

  const before = client.inspect();
  assert.equal(before.appliedMigrationCount, 3);
  assert.equal(before.dailyRunsSchemaCompatible, false);
  assert.equal(before.sendRecordsSchemaCompatible, false);
  assert.equal(before.tables.includes('daily_runs'), false);
  assert.equal(before.tables.includes('send_records'), false);

  const migration = client.migrate();
  const businessDate = parseBusinessDate('2026-08-23');
  const now = new Date('2026-08-23T10:00:00.000Z');
  const dailyRun = new DailyRunRepository(client).createOrGet({
    accountId: account.id,
    businessDate,
    now,
  });
  const prepared = new SendRecordRepository(client).prepare({
    dailyRunId: dailyRun.id,
    friendId: friend.id,
    businessDate,
    messageTemplateId: template.id,
    messageText: 'Hello',
    now,
  });

  assert.equal(migration.appliedMigrationCount, 9);
  assert.equal(client.inspect().appliedMigrationCount, 9);
  assert.equal(new AccountRepository(client).findById(account.id)?.name, 'V1-3 Test Account');
  assert.equal(new FriendRepository(client).findById(friend.id)?.displayName, 'Alice');
  assert.equal(
    new MessageTemplateRepository(client).findById(template.id)?.name,
    'V1-3 Test Template',
  );
  assert.equal(prepared.type, 'PREPARED');

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const repeated = reopened.migrate();

  assert.equal(repeated.appliedMigrationCount, 9);
  assert.equal(new AccountRepository(reopened).findById(account.id)?.name, 'V1-3 Test Account');
  assert.equal(new FriendRepository(reopened).findById(friend.id)?.displayName, 'Alice');
  assert.equal(
    new MessageTemplateRepository(reopened).findById(template.id)?.name,
    'V1-3 Test Template',
  );
  assert.equal(new DailyRunRepository(reopened).findById(dailyRun.id)?.businessDate, businessDate);
  assert.equal(
    new SendRecordRepository(reopened).findById(prepared.record.id)?.messageText,
    'Hello',
  );
  reopened.close();
});

test('existing V1-4 database upgrades through V4 and preserves all idempotency data', (context) => {
  const temporary = createV1FourDatabase(context);
  const { client } = temporary;
  const now = new Date('2026-08-23T00:00:00.000Z');
  const account = insertLegacyAccount(temporary.databasePath, {
    name: 'V1-4 Account',
    loginStatus: 'READY',
    nowMs: now.getTime(),
  });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Alice',
    now,
  });
  const template = new MessageTemplateRepository(client).create({
    name: 'Template',
    providerType: 'STATIC',
    messages: ['Hello'],
    now,
  });
  const businessDate = parseBusinessDate('2026-08-23');
  const run = new DailyRunRepository(client).createOrGet({
    accountId: account.id,
    businessDate,
    now,
  });
  const legacyRecordId = 'record-v1-4';
  const legacySqlite = new BetterSqlite3(temporary.databasePath);
  try {
    legacySqlite
      .prepare(
        `insert into send_records (id, daily_run_id, friend_id, business_date, message_template_id, message_text, status, started_at, finished_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'Hello', 'READY', null, null, ?, ?)`,
      )
      .run(
        legacyRecordId,
        run.id,
        friend.id,
        businessDate,
        template.id,
        now.getTime(),
        now.getTime(),
      );
  } finally {
    legacySqlite.close();
  }
  assert.equal(client.inspect().appliedMigrationCount, 4);
  assert.equal(client.inspect().schedulesSchemaCompatible, false);

  assert.equal(client.migrate().appliedMigrationCount, 9);
  const schedule = new ScheduleRepository(client).create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Asia/Shanghai',
    now,
  });
  assert.equal(new AccountRepository(client).findById(account.id)?.name, 'V1-4 Account');
  assert.equal(new FriendRepository(client).findById(friend.id)?.displayName, 'Alice');
  assert.equal(new MessageTemplateRepository(client).findById(template.id)?.messages[0], 'Hello');
  assert.equal(new DailyRunRepository(client).findById(run.id)?.businessDate, businessDate);
  assert.equal(new SendRecordRepository(client).findById(legacyRecordId)?.messageText, 'Hello');

  client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  assert.equal(reopened.migrate().appliedMigrationCount, 9);
  assert.equal(new ScheduleRepository(reopened).findById(schedule.id)?.startTime, '09:00');
  assert.equal(new SendRecordRepository(reopened).findById(legacyRecordId)?.messageText, 'Hello');
  reopened.close();
});

test('existing V1-5 database upgrades all legacy SendRecord states with conservative retry backfill', (context) => {
  const temporary = createV1FiveDatabase(context);
  temporary.client.close();
  const nowMs = Date.parse('2026-08-23T12:00:00.000Z');
  const finishedMs = Date.parse('2026-08-23T12:01:00.000Z');
  const sqlite = new BetterSqlite3(temporary.databasePath);
  try {
    const insertFixture = sqlite.transaction(() => {
      sqlite
        .prepare(
          `insert into accounts (id, name, enabled, login_status, last_login_at, created_at, updated_at)
           values ('account-v1-5', 'Test Account', 1, 'READY', null, ?, ?)`,
        )
        .run(nowMs, nowMs);
      sqlite
        .prepare(
          `insert into message_templates (id, name, provider_type, content, enabled, created_at, updated_at)
           values ('template-v1-5', 'Test Template', 'STATIC', '["Message A"]', 1, ?, ?)`,
        )
        .run(nowMs, nowMs);
      sqlite
        .prepare(
          `insert into daily_runs (id, account_id, business_date, status, started_at, finished_at, created_at, updated_at)
           values ('run-v1-5', 'account-v1-5', '2026-08-23', 'RUNNING', ?, null, ?, ?)`,
        )
        .run(nowMs, nowMs, nowMs);
      sqlite
        .prepare(
          `insert into schedules (id, account_id, start_time, end_time, timezone, enabled, created_at, updated_at)
           values ('schedule-v1-5', 'account-v1-5', '19:30', '21:00', 'Asia/Shanghai', 1, ?, ?)`,
        )
        .run(nowMs, nowMs);

      const statuses = ['READY', 'RUNNING', 'SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN'] as const;
      for (const [index, status] of statuses.entries()) {
        const friendId = `friend-v1-5-${index}`;
        sqlite
          .prepare(
            `insert into friends (id, account_id, display_name, remark_name, short_id, unique_id, sec_uid, match_field, match_key, enabled, created_at, updated_at)
             values (?, 'account-v1-5', ?, null, null, null, null, 'displayName', ?, 1, ?, ?)`,
          )
          .run(friendId, `Test User ${index + 1}`, `Test User ${index + 1}`, nowMs, nowMs);
        sqlite
          .prepare(
            `insert into send_records (id, daily_run_id, friend_id, business_date, message_template_id, message_text, status, started_at, finished_at, created_at, updated_at)
             values (?, 'run-v1-5', ?, '2026-08-23', 'template-v1-5', 'Message A', ?, ?, ?, ?, ?)`,
          )
          .run(
            `record-v1-5-${index}`,
            friendId,
            status,
            status === 'READY' ? null : nowMs,
            status === 'READY' || status === 'RUNNING' ? null : finishedMs,
            nowMs,
            finishedMs,
          );
      }
    });
    insertFixture();
  } finally {
    sqlite.close();
  }

  const client = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => client.close());
  assert.equal(client.inspect().appliedMigrationCount, 5);
  assert.equal(client.inspect().sendRecordsSchemaCompatible, false);
  assert.equal(client.inspect().schedulesSchemaCompatible, false);

  assert.equal(client.migrate().appliedMigrationCount, 9);
  const repository = new SendRecordRepository(client);
  const records = Array.from({ length: 5 }, (_, index) =>
    repository.findById(`record-v1-5-${index}`),
  );
  assert.deepEqual(
    records.map((record) => record?.attemptCount),
    [0, 1, 1, 1, 1],
  );
  assert.equal(records[0]?.sendActionStartedAt, null);
  assert.notEqual(records[1]?.sendActionStartedAt, null);
  assert.equal(records[2]?.sentAt?.getTime(), finishedMs);
  assert.equal(records[3]?.lastErrorCode, null);
  assert.equal(records[4]?.lastErrorCode, 'DELIVERY_UNKNOWN');
  assert.notEqual(records[4]?.sendActionStartedAt, null);
  const schedule = new ScheduleRepository(client).findById('schedule-v1-5');
  assert.equal(schedule?.maxAttempts, 3);
  assert.equal(schedule?.retryIntervalSeconds, 60);
  assert.equal(new AccountRepository(client).findById('account-v1-5')?.name, 'Test Account');
  assert.equal(new FriendRepository(client).listByAccountId('account-v1-5').length, 5);
  assert.equal(
    new MessageTemplateRepository(client).findById('template-v1-5')?.name,
    'Test Template',
  );
  assert.equal(new DailyRunRepository(client).findById('run-v1-5')?.status, 'RUNNING');

  const structure = new BetterSqlite3(temporary.databasePath, { readonly: true });
  try {
    const foreignKeys = structure.pragma('foreign_key_list(send_records)') as Array<{
      table: string;
      on_delete: string;
    }>;
    assert.deepEqual(foreignKeys.map(({ table, on_delete }) => [table, on_delete]).sort(), [
      ['daily_runs', 'CASCADE'],
      ['friends', 'NO ACTION'],
      ['message_templates', 'SET NULL'],
    ]);
    const indexes = structure.pragma('index_list(send_records)') as Array<{
      name: string;
      unique: number;
    }>;
    assert.deepEqual(
      indexes
        .filter((index) => index.name.startsWith('send_records_'))
        .map(({ name, unique }) => [name, unique])
        .sort(),
      [
        ['send_records_daily_run_friend_unique', 1],
        ['send_records_friend_business_date_unique', 1],
      ],
    );
  } finally {
    structure.close();
  }

  assert.equal(client.migrate().appliedMigrationCount, 9);
  assert.equal(repository.findById('record-v1-5-4')?.messageText, 'Message A');
});

test('existing V1-6 database upgrades to V4 and preserves all business states', (context) => {
  const temporary = createV1SixDatabase(context);
  const { client } = temporary;
  const now = new Date('2026-08-23T10:00:00.000Z');
  const businessDate = parseBusinessDate('2026-08-23');
  const account = insertLegacyAccount(temporary.databasePath, {
    name: 'V1-6 Test Account',
    loginStatus: 'READY',
    nowMs: now.getTime(),
  });
  const friendsRepository = new FriendRepository(client);
  const templatesRepository = new MessageTemplateRepository(client);
  const runsRepository = new DailyRunRepository(client);
  const recordsRepository = new SendRecordRepository(client);
  const template = templatesRepository.create({
    name: 'V1-6 Test Template',
    providerType: 'STATIC',
    messages: ['Message A'],
  });
  const schedule = new ScheduleRepository(client).create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '11:00',
    timezone: 'Asia/Shanghai',
    now,
  });
  const run = runsRepository.createOrGet({ accountId: account.id, businessDate, now });
  runsRepository.claimForExecution(run.id, now);
  const friendsForStatus = ['SUCCESS', 'FAILED', 'RETRY_WAIT', 'DELIVERY_UNKNOWN'].map((status) =>
    friendsRepository.create({ accountId: account.id, displayName: `Test User ${status}` }),
  );
  const records = friendsForStatus.map(
    (friend) =>
      recordsRepository.prepare({
        dailyRunId: run.id,
        friendId: friend.id,
        businessDate,
        messageTemplateId: template.id,
        messageText: 'Message A',
        now,
      }).record,
  );
  for (const record of records) recordsRepository.claimInitialAttempt(record.id, now, 3);
  recordsRepository.markSendActionStarted(records[0]!.id, now);
  recordsRepository.markSuccess(records[0]!.id, now);
  recordsRepository.markFinalFailed(records[1]!.id, now, 'CONTACT_NOT_FOUND');
  recordsRepository.scheduleRetry(records[2]!.id, {
    failureCode: 'NETWORK_TRANSIENT',
    maxAttempts: 3,
    nextRetryAt: new Date('2026-08-23T10:01:00.000Z'),
    now,
    externalActionConfirmedAbsent: true,
  });
  recordsRepository.markSendActionStarted(records[3]!.id, now);
  recordsRepository.markDeliveryUnknown(records[3]!.id, now);

  assert.equal(client.inspect().appliedMigrationCount, 6);
  assert.equal(client.inspect().systemEventsSchemaCompatible, false);
  assert.equal(client.migrate().appliedMigrationCount, 9);

  const event = new SystemEventRepository(client).create({
    eventType: 'DELIVERY_UNKNOWN',
    level: 'ERROR',
    accountId: account.id,
    runId: run.id,
    friendId: friendsForStatus[3]!.id,
    attempt: 1,
    errorCode: 'DELIVERY_UNKNOWN',
    message: 'Delivery result is uncertain',
    now,
  });
  assert.equal(new AccountRepository(client).findById(account.id)?.name, 'V1-6 Test Account');
  assert.equal(friendsRepository.listByAccountId(account.id).length, 4);
  assert.equal(templatesRepository.findById(template.id)?.messages[0], 'Message A');
  assert.equal(new ScheduleRepository(client).findById(schedule.id)?.maxAttempts, 3);
  assert.equal(runsRepository.findById(run.id)?.status, 'RUNNING');
  assert.deepEqual(
    records.map((record) => recordsRepository.findById(record.id)?.status),
    ['SUCCESS', 'FAILED', 'RETRY_WAIT', 'DELIVERY_UNKNOWN'],
  );
  assert.equal(new SystemEventRepository(client).findById(event.id)?.runId, run.id);
  assert.equal(client.migrate().appliedMigrationCount, 9);
  assert.equal(
    new SystemEventRepository(client).findById(event.id)?.message,
    'Delivery result is uncertain',
  );
});

test('existing V1-8 (V3 base) database upgrades to V4 and backfills bridge records deterministically', (context) => {
  const temporary = createV1EightDatabase(context);
  const { client } = temporary;
  const now = new Date('2026-08-23T10:00:00.000Z');
  const account = insertLegacyAccount(temporary.databasePath, {
    id: 'legacy-acc-1',
    name: 'V3 Legacy Account',
    loginStatus: 'READY',
    nowMs: now.getTime(),
  });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Legacy Friend Alice',
    now,
  });
  const schedule = new ScheduleRepository(client).create({
    accountId: account.id,
    startTime: '08:30',
    endTime: '09:30',
    timezone: 'Asia/Shanghai',
    maxAttempts: 4,
    retryIntervalSeconds: 90,
    now,
  });

  const before = client.inspect();
  assert.equal(before.appliedMigrationCount, 8);
  assert.equal(before.adminUsersSchemaCompatible, false);
  assert.equal(before.legacyFriendBindingsSchemaCompatible, false);

  const migration = client.migrate();
  assert.equal(migration.appliedMigrationCount, 9);
  assert.equal(migration.legacyFriendBindingsSchemaVerified, true);
  assert.equal(migration.legacyScheduleImportsSchemaVerified, true);

  const sqlite = new BetterSqlite3(temporary.databasePath, { readonly: true });
  try {
    const bindingRow = sqlite
      .prepare('select * from legacy_friend_bindings where friend_id = ?')
      .get(friend.id) as
      | {
          id: string;
          friend_id: string;
          account_id: string;
          status: string;
          contact_id: string | null;
        }
      | undefined;
    assert.ok(bindingRow);
    assert.equal(bindingRow.id, `v4:legacy-friend-binding:${friend.id}`);
    assert.equal(bindingRow.account_id, account.id);
    assert.equal(bindingRow.status, 'PENDING');
    assert.equal(bindingRow.contact_id, null);

    const importRow = sqlite
      .prepare('select * from legacy_schedule_imports where schedule_id = ?')
      .get(schedule.id) as
      | {
          id: string;
          schedule_id: string;
          account_id: string;
          status: string;
          start_time: string;
          end_time: string;
          timezone: string;
          max_attempts: number;
          retry_interval_seconds: number;
        }
      | undefined;
    assert.ok(importRow);
    assert.equal(importRow.id, `v4:legacy-schedule-import:${schedule.id}`);
    assert.equal(importRow.account_id, account.id);
    assert.equal(importRow.status, 'PENDING');
    assert.equal(importRow.start_time, '08:30');
    assert.equal(importRow.end_time, '09:30');
    assert.equal(importRow.timezone, 'Asia/Shanghai');
    assert.equal(importRow.max_attempts, 4);
    assert.equal(importRow.retry_interval_seconds, 90);
  } finally {
    sqlite.close();
  }

  // Running migration again is idempotent
  const repeated = client.migrate();
  assert.equal(repeated.appliedMigrationCount, 9);
});

test('existing V1-8 database fully populated with all 8 legacy domains preserves all fields and backfills correctly', (context) => {
  const temporary = createV1EightDatabase(context);
  const { client } = temporary;
  const now = new Date('2026-08-25T12:00:00.000Z');
  const nowMs = now.getTime();

  // 1. Domain: accounts
  const acc1 = insertLegacyAccount(temporary.databasePath, {
    id: 'legacy-acc-full-1',
    name: 'Legacy Account Full 1',
    loginStatus: 'READY',
    nowMs,
  });
  const acc2 = insertLegacyAccount(temporary.databasePath, {
    id: 'legacy-acc-full-2',
    name: 'Legacy Account Full 2',
    loginStatus: 'AUTH_EXPIRED',
    nowMs,
  });

  // 2. Domain: friends
  const friendRepo = new FriendRepository(client);
  const f1 = friendRepo.create({
    accountId: acc1.id,
    displayName: 'Friend One',
    remarkName: 'Remark One',
    uniqueId: 'uniq_111',
    now,
  });
  const f2 = friendRepo.create({
    accountId: acc1.id,
    displayName: 'Friend Two',
    secUid: 'sec_222',
    now,
  });
  const f3 = friendRepo.create({
    accountId: acc2.id,
    displayName: 'Friend Three',
    shortId: 'short_333',
    now,
  });

  // 3. Domain: message_templates
  const templateRepo = new MessageTemplateRepository(client);
  const t1 = templateRepo.create({
    name: 'Template Morning',
    providerType: 'STATIC',
    messages: ['Hello {name}!'],
    now,
  });
  const t2 = templateRepo.create({
    name: 'Template Evening',
    providerType: 'STATIC',
    messages: ['Good evening {name}!'],
    now,
  });

  // 4. Domain: daily_runs
  const dailyRunRepo = new DailyRunRepository(client);
  const run1 = dailyRunRepo.createOrGet({
    accountId: acc1.id,
    businessDate: '2026-08-25',
    now,
  });
  dailyRunRepo.createOrGet({
    accountId: acc2.id,
    businessDate: '2026-08-25',
    now,
  });

  // 5. Domain: schedules
  const scheduleRepo = new ScheduleRepository(client);
  const s1 = scheduleRepo.create({
    accountId: acc1.id,
    startTime: '07:00',
    endTime: '08:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 3,
    retryIntervalSeconds: 60,
    now,
  });
  const s2 = scheduleRepo.create({
    accountId: acc2.id,
    startTime: '19:00',
    endTime: '20:00',
    timezone: 'UTC',
    maxAttempts: 5,
    retryIntervalSeconds: 120,
    now,
  });

  // 6. Domain: notification_configs
  const sqliteBefore = new BetterSqlite3(temporary.databasePath);
  sqliteBefore
    .prepare(
      'INSERT INTO notification_configs (id, enabled, provider, webhook_url, notify_auth_expired, notify_task_failed, notify_consecutive_failure, notify_delivery_unknown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(1, 1, 'WEBHOOK', 'https://example.com/webhook', 1, 1, 1, 1, nowMs, nowMs);

  // 7. Domain: send_records
  const sendRecordRepo = new SendRecordRepository(client);
  const prep1 = sendRecordRepo.prepare({
    dailyRunId: run1.id,
    friendId: f1.id,
    businessDate: parseBusinessDate('2026-08-25'),
    messageTemplateId: t1.id,
    messageText: 'Hello Friend One!',
    now,
  });
  assert.equal(prep1.type, 'PREPARED');
  const rec1 = prep1.record;
  sendRecordRepo.claimForExecution(rec1.id, now);
  sendRecordRepo.markSuccess(rec1.id, now);

  const prep2 = sendRecordRepo.prepare({
    dailyRunId: run1.id,
    friendId: f2.id,
    businessDate: parseBusinessDate('2026-08-25'),
    messageTemplateId: t2.id,
    messageText: 'Good evening Friend Two!',
    now,
  });
  assert.equal(prep2.type, 'PREPARED');

  // 8. Domain: system_events
  const eventRepo = new SystemEventRepository(client);
  eventRepo.create({
    level: 'INFO',
    eventType: 'RUN_STARTED',
    accountId: acc1.id,
    runId: run1.id,
    message: 'Run 1 started',
    now,
  });
  eventRepo.create({
    level: 'WARN',
    eventType: 'DELIVERY_UNKNOWN',
    accountId: acc1.id,
    friendId: f1.id,
    runId: run1.id,
    message: 'Delivery delayed',
    now,
  });

  // Snapshot before migration across all 8 tables
  const accountsBefore = sqliteBefore
    .prepare(
      'SELECT id, name, enabled, login_status, last_login_at, created_at, updated_at FROM accounts ORDER BY id',
    )
    .all();
  const friendsBefore = sqliteBefore
    .prepare(
      'SELECT id, account_id, display_name, remark_name, short_id, unique_id, sec_uid, match_field, match_key, enabled, created_at, updated_at FROM friends ORDER BY id',
    )
    .all();
  const templatesBefore = sqliteBefore
    .prepare(
      'SELECT id, name, provider_type, content, enabled, created_at, updated_at FROM message_templates ORDER BY id',
    )
    .all();
  const dailyRunsBefore = sqliteBefore
    .prepare(
      'SELECT id, account_id, business_date, status, started_at, finished_at, created_at, updated_at FROM daily_runs ORDER BY id',
    )
    .all();
  const schedulesBefore = sqliteBefore
    .prepare(
      'SELECT id, account_id, start_time, end_time, timezone, max_attempts, retry_interval_seconds, enabled, created_at, updated_at FROM schedules ORDER BY id',
    )
    .all();
  const notificationsBefore = sqliteBefore
    .prepare(
      'SELECT id, enabled, provider, webhook_url, notify_auth_expired, notify_task_failed, notify_consecutive_failure, notify_delivery_unknown, created_at, updated_at FROM notification_configs ORDER BY id',
    )
    .all();
  const sendRecordsBefore = sqliteBefore
    .prepare(
      'SELECT id, daily_run_id, friend_id, business_date, message_template_id, message_text, status, attempt_count, next_retry_at, last_error_code, sent_at, send_action_started_at, started_at, finished_at, created_at, updated_at FROM send_records ORDER BY id',
    )
    .all();
  const eventsBefore = sqliteBefore
    .prepare(
      'SELECT id, event_type, level, run_id, account_id, friend_id, attempt, error_code, message, screenshot_path, trace_path, created_at FROM system_events ORDER BY id',
    )
    .all();

  sqliteBefore.close();

  // Execute V4 migration (0008)
  const migrationResult = client.migrate();
  assert.equal(migrationResult.appliedMigrationCount, 9);

  // Verify all 8 legacy domains preserved identically
  const sqliteAfter = new BetterSqlite3(temporary.databasePath, { readonly: true });
  try {
    const accountsAfter = sqliteAfter
      .prepare(
        'SELECT id, name, enabled, login_status, last_login_at, created_at, updated_at FROM accounts ORDER BY id',
      )
      .all();
    assert.deepEqual(accountsAfter, accountsBefore);

    const friendsAfter = sqliteAfter
      .prepare(
        'SELECT id, account_id, display_name, remark_name, short_id, unique_id, sec_uid, match_field, match_key, enabled, created_at, updated_at FROM friends ORDER BY id',
      )
      .all();
    assert.deepEqual(friendsAfter, friendsBefore);

    const templatesAfter = sqliteAfter
      .prepare(
        'SELECT id, name, provider_type, content, enabled, created_at, updated_at FROM message_templates ORDER BY id',
      )
      .all();
    assert.deepEqual(templatesAfter, templatesBefore);

    const dailyRunsAfter = sqliteAfter
      .prepare(
        'SELECT id, account_id, business_date, status, started_at, finished_at, created_at, updated_at FROM daily_runs ORDER BY id',
      )
      .all();
    assert.deepEqual(dailyRunsAfter, dailyRunsBefore);

    const schedulesAfter = sqliteAfter
      .prepare(
        'SELECT id, account_id, start_time, end_time, timezone, max_attempts, retry_interval_seconds, enabled, created_at, updated_at FROM schedules ORDER BY id',
      )
      .all();
    assert.deepEqual(schedulesAfter, schedulesBefore);

    const notificationsAfter = sqliteAfter
      .prepare(
        'SELECT id, enabled, provider, webhook_url, notify_auth_expired, notify_task_failed, notify_consecutive_failure, notify_delivery_unknown, created_at, updated_at FROM notification_configs ORDER BY id',
      )
      .all();
    assert.deepEqual(notificationsAfter, notificationsBefore);

    const sendRecordsAfter = sqliteAfter
      .prepare(
        'SELECT id, daily_run_id, friend_id, business_date, message_template_id, message_text, status, attempt_count, next_retry_at, last_error_code, sent_at, send_action_started_at, started_at, finished_at, created_at, updated_at FROM send_records ORDER BY id',
      )
      .all();
    assert.deepEqual(sendRecordsAfter, sendRecordsBefore);

    const eventsAfter = sqliteAfter
      .prepare(
        'SELECT id, event_type, level, run_id, account_id, friend_id, attempt, error_code, message, screenshot_path, trace_path, created_at FROM system_events ORDER BY id',
      )
      .all();
    assert.deepEqual(eventsAfter, eventsBefore);

    // Verify Account V4 additions defaults
    const accV4Rows = sqliteAfter
      .prepare(
        'SELECT id, profile_state, lifecycle_status, avatar_remote_url, avatar_cache_key, douyin_unique_id, douyin_short_id, douyin_sec_uid, last_auth_check_at, last_contact_sync_at, unbound_at FROM accounts ORDER BY id',
      )
      .all() as Array<{
      id: string;
      profile_state: string;
      lifecycle_status: string;
      avatar_remote_url: string | null;
      avatar_cache_key: string | null;
      douyin_unique_id: string | null;
      douyin_short_id: string | null;
      douyin_sec_uid: string | null;
      last_auth_check_at: number | null;
      last_contact_sync_at: number | null;
      unbound_at: number | null;
    }>;
    assert.equal(accV4Rows.length, 2);
    for (const row of accV4Rows) {
      assert.equal(row.profile_state, 'MIGRATION_REQUIRED');
      assert.equal(row.lifecycle_status, 'ACTIVE');
      assert.equal(row.avatar_remote_url, null);
      assert.equal(row.avatar_cache_key, null);
      assert.equal(row.douyin_unique_id, null);
      assert.equal(row.douyin_short_id, null);
      assert.equal(row.douyin_sec_uid, null);
      assert.equal(row.last_auth_check_at, null);
      assert.equal(row.last_contact_sync_at, null);
      assert.equal(row.unbound_at, null);
    }

    // Verify Legacy Bridge tables backfilled
    const friendBindings = sqliteAfter
      .prepare(
        'SELECT friend_id, account_id, status, contact_id FROM legacy_friend_bindings ORDER BY friend_id',
      )
      .all() as Array<{
      friend_id: string;
      account_id: string;
      status: string;
      contact_id: string | null;
    }>;
    assert.equal(friendBindings.length, 3);
    const expectedFriendBindings = [
      { friend_id: f1.id, account_id: acc1.id, status: 'PENDING', contact_id: null },
      { friend_id: f2.id, account_id: acc1.id, status: 'PENDING', contact_id: null },
      { friend_id: f3.id, account_id: acc2.id, status: 'PENDING', contact_id: null },
    ].sort((a, b) => a.friend_id.localeCompare(b.friend_id));
    assert.deepEqual(friendBindings, expectedFriendBindings);

    const scheduleImports = sqliteAfter
      .prepare(
        'SELECT schedule_id, account_id, status, converted_task_id FROM legacy_schedule_imports ORDER BY schedule_id',
      )
      .all() as Array<{
      schedule_id: string;
      account_id: string;
      status: string;
      converted_task_id: string | null;
    }>;
    assert.equal(scheduleImports.length, 2);
    const expectedScheduleImports = [
      { schedule_id: s1.id, account_id: acc1.id, status: 'PENDING', converted_task_id: null },
      { schedule_id: s2.id, account_id: acc2.id, status: 'PENDING', converted_task_id: null },
    ].sort((a, b) => a.schedule_id.localeCompare(b.schedule_id));
    assert.deepEqual(scheduleImports, expectedScheduleImports);
  } finally {
    sqliteAfter.close();
  }

  // Idempotency: repeated migrate run
  const repeatMigrate = client.migrate();
  assert.equal(repeatMigrate.appliedMigrationCount, 9);
});

test('migration failure includes explicit migration context', (context) => {
  const { client } = createTemporaryDatabase(context, { migrate: false });
  const missingDirectory = '/path/that/does/not/contain/drizzle/migrations';
  client.close();

  const invalidClient: DatabaseClient = createDatabase({
    databasePath: client.databasePath,
    migrationsDirectory: missingDirectory,
  });
  context.after(() => invalidClient.close());

  assert.throws(
    () => invalidClient.migrate(),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseMigrationError);
      assert.match(error.message, /failed to apply database migrations/i);
      assert.match(error.message, /path\/that\/does\/not\/contain/i);
      return true;
    },
  );
  invalidClient.close();
});
