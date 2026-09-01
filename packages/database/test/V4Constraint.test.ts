import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';

import {
  AccountRepository,
  AdminUserRepository,
  ContactIdentityRepository,
  ContactRepository,
  ExecutionRunRepository,
  MessageTemplateRepository,
  RepositoryError,
  SendTaskRepository,
  TargetSendRecordRepository,
  DeliveryResolutionRepository,
} from '../src/index.js';
import {
  createTemporaryDatabase,
  createV1EightDatabase,
  insertLegacyAccount,
} from './testDatabase.js';

test('V4Constraint: accounts partial unique index on douyin_sec_uid rejects non-null duplicates', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repo = new AccountRepository(client);

  const acc1 = repo.create({ name: 'Acc 1', douyinSecUid: 'sec-uid-unique-1' });
  assert.ok(acc1);

  // Rejects duplicate non-null sec_uid
  assert.throws(
    () => repo.create({ name: 'Acc 2', douyinSecUid: 'sec-uid-unique-1' }),
    /Failed to create account/,
  );

  // Allows multiple null sec_uid accounts
  const accNull1 = repo.create({ name: 'Acc Null 1', douyinSecUid: null });
  const accNull2 = repo.create({ name: 'Acc Null 2', douyinSecUid: null });
  assert.ok(accNull1);
  assert.ok(accNull2);
});

test('V4Constraint: admin_users allows only 1 ACTIVE admin via active singleton partial unique index', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repo = new AdminUserRepository(client);

  const admin1 = repo.create({
    username: 'admin_primary',
    passwordHash: 'hash1',
    status: 'ACTIVE',
  });
  assert.ok(admin1);

  // Inserting second ACTIVE admin is rejected by partial unique index
  assert.throws(
    () => repo.create({ username: 'admin_secondary', passwordHash: 'hash2', status: 'ACTIVE' }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );

  // Inserting DISABLED admin is allowed
  const disabledAdmin = repo.create({
    username: 'admin_disabled',
    passwordHash: 'hash3',
    status: 'DISABLED',
  });
  assert.ok(disabledAdmin);
});

test('V4Constraint: contact_identities enforces unique preferred active and unique stable active per account', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Main Account' });
  const contactRepo = new ContactRepository(client);

  const { contact: contact1 } = contactRepo.createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'User One',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_1001',
      source: 'PAGE_DATA',
    },
  });
  const { contact: contact2 } = contactRepo.createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'User Two',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_1002',
      source: 'PAGE_DATA',
    },
  });

  const identityRepo = new ContactIdentityRepository(client);

  // 1. Preferred active uniqueness per contact
  // Adding another preferred ACTIVE identity for same contact is rejected by DB index
  assert.throws(
    () =>
      identityRepo.create({
        accountId: account.id,
        contactId: contact1.id,
        kind: 'UNIQUE_ID',
        value: 'unique_1001',
        source: 'PAGE_DATA',
        isPreferred: true,
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'IDENTITY_CONFLICT',
  );

  // 2. Stable active identity uniqueness per (account_id, kind, normalized_value)
  // Attempting to attach same SEC_UID 'sec_1001' to contact2 in same account is rejected
  assert.throws(
    () =>
      identityRepo.create({
        accountId: account.id,
        contactId: contact2.id,
        kind: 'SEC_UID',
        value: 'sec_1001',
        source: 'PAGE_DATA',
        isPreferred: false,
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'IDENTITY_CONFLICT',
  );
});

test('V4Constraint: target_send_records unique indexes and schedule tuple constraints', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Target Account' });
  const template = new MessageTemplateRepository(client).create({
    name: 'Tpl',
    providerType: 'STATIC',
    messages: ['Hi'],
  });
  const { contact } = new ContactRepository(client).createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Contact 1',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_contact_1',
      source: 'LEGACY_MANUAL',
    },
  });
  const task = new SendTaskRepository(client).create({
    name: 'Morning Task',
    accountId: account.id,
    templateId: template.id,
    startTime: '08:00',
    endTime: '09:00',
    timezone: 'Asia/Shanghai',
    targetContactIds: [contact.id],
  }).task;

  const executionRepo = new ExecutionRunRepository(client);
  const run1 = executionRepo.create({
    kind: 'SCHEDULED_TASK',
    accountId: account.id,
    taskId: task.id,
    templateId: template.id,
    businessDate: '2026-08-31',
    idempotencyKey: 'scheduled:task-1:2026-08-31',
  });

  const recordRepo = new TargetSendRecordRepository(client);
  const rec1 = recordRepo.create({
    runId: run1.id,
    taskId: task.id,
    contactId: contact.id,
    businessDate: '2026-08-31',
    templateId: template.id,
    messageText: 'Hi',
    targetIdentityKindSnapshot: 'SEC_UID',
    targetIdentityValueDigest: 'digest_1',
  });
  assert.ok(rec1);

  // Duplicate (run_id, contact_id) is rejected
  assert.throws(
    () =>
      recordRepo.create({
        runId: run1.id,
        taskId: task.id,
        contactId: contact.id,
        businessDate: '2026-08-31',
        templateId: template.id,
        messageText: 'Hi again',
        targetIdentityKindSnapshot: 'SEC_UID',
        targetIdentityValueDigest: 'digest_1',
      }),
    /Failed to create target send record/,
  );

  // Duplicate (task_id, contact_id, business_date) across different runs is rejected
  const run2 = executionRepo.create({
    kind: 'SCHEDULED_TASK',
    accountId: account.id,
    taskId: task.id,
    templateId: template.id,
    businessDate: '2026-08-31',
    idempotencyKey: 'scheduled:task-1:2026-08-31-retry',
  });

  assert.throws(
    () =>
      recordRepo.create({
        runId: run2.id,
        taskId: task.id,
        contactId: contact.id,
        businessDate: '2026-08-31',
        templateId: template.id,
        messageText: 'Hi',
        targetIdentityKindSnapshot: 'SEC_UID',
        targetIdentityValueDigest: 'digest_1',
      }),
    /Failed to create target send record/,
  );
});

test('V4Constraint: delivery_resolutions requires exactly one source record and originalMachineStatus DELIVERY_UNKNOWN', (context) => {
  const { client } = createTemporaryDatabase(context);
  const admin = new AdminUserRepository(client).create({
    username: 'admin_res',
    passwordHash: 'hash',
  });
  const account = new AccountRepository(client).create({ name: 'Acc' });
  const template = new MessageTemplateRepository(client).create({
    name: 'Tpl',
    providerType: 'STATIC',
    messages: ['Hi'],
  });
  const { contact } = new ContactRepository(client).createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Contact Res',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_contact_res',
      source: 'LEGACY_MANUAL',
    },
  });
  const run = new ExecutionRunRepository(client).create({
    kind: 'TEST_SEND',
    accountId: account.id,
    templateId: template.id,
    requestedByAdminUserId: admin.id,
    idempotencyKey: 'test:res-1',
    confirmedAt: new Date(),
  });
  const targetRepo = new TargetSendRecordRepository(client);
  const record = targetRepo.create({
    runId: run.id,
    contactId: contact.id,
    messageText: 'Hi',
    targetIdentityKindSnapshot: 'SEC_UID',
    targetIdentityValueDigest: 'digest_res',
  });

  // Transition record to lawful DELIVERY_UNKNOWN state before resolution
  targetRepo.claimForExecution(record.id);
  targetRepo.recordSendActionStarted(record.id);
  targetRepo.markDeliveryUnknown(record.id);

  const resRepo = new DeliveryResolutionRepository(client);

  // Valid resolution on target send record
  const res1 = resRepo.create({
    targetSendRecordId: record.id,
    resolution: 'CONFIRMED_DELIVERED',
    resolvedByAdminUserId: admin.id,
    note: 'Verified manually.',
  });
  assert.ok(res1);
  assert.equal(res1.originalMachineStatus, 'DELIVERY_UNKNOWN');

  // Rejects resolving record that is not DELIVERY_UNKNOWN
  const { contact: contact2 } = new ContactRepository(client).createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Contact Res 2',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_contact_res_2',
      source: 'LEGACY_MANUAL',
    },
  });
  const recordReady = targetRepo.create({
    runId: run.id,
    contactId: contact2.id,
    messageText: 'Hi 2',
    targetIdentityKindSnapshot: 'SEC_UID',
    targetIdentityValueDigest: 'digest_res_2',
  });
  assert.throws(
    () =>
      resRepo.create({
        targetSendRecordId: recordReady.id,
        resolution: 'CONFIRMED_DELIVERED',
        resolvedByAdminUserId: admin.id,
      }),
    /Only 'DELIVERY_UNKNOWN' can be resolved/,
  );

  // Rejects setting both or neither source record ID
  assert.throws(
    () =>
      resRepo.create({
        targetSendRecordId: null,
        legacySendRecordId: null,
        resolution: 'INCONCLUSIVE',
        resolvedByAdminUserId: admin.id,
      }),
    /Exactly one of targetSendRecordId or legacySendRecordId must be set/,
  );
});

test('V4Constraint: accounts table contains all 7 named CHECK constraints in sqlite_master', (context) => {
  const { databasePath } = createTemporaryDatabase(context);
  const sqlite = new BetterSqlite3(databasePath, { readonly: true });
  try {
    const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='accounts'").get() as {
      sql: string;
    };
    assert.ok(row?.sql, 'accounts table SQL must exist in sqlite_master');

    const expectedConstraintNames = [
      'accounts_profile_state_check',
      'accounts_lifecycle_status_check',
      'accounts_avatar_remote_url_check',
      'accounts_avatar_cache_key_check',
      'accounts_douyin_unique_id_check',
      'accounts_douyin_short_id_check',
      'accounts_douyin_sec_uid_check',
    ];

    for (const name of expectedConstraintNames) {
      assert.ok(
        row.sql.includes(name),
        `sqlite_master schema must contain CHECK constraint: ${name}`,
      );
    }
  } finally {
    sqlite.close();
  }
});

test('V4Constraint: SQLite directly rejects invalid enum values for profile_state and lifecycle_status', (context) => {
  const { databasePath } = createTemporaryDatabase(context);
  const sqlite = new BetterSqlite3(databasePath);
  try {
    const now = Date.now();

    // 1. profile_state positive: all valid enums accepted
    const validProfileStates = [
      'PROVISIONING',
      'READY',
      'MIGRATION_REQUIRED',
      'MISSING',
      'QUARANTINED',
    ];
    for (let i = 0; i < validProfileStates.length; i++) {
      sqlite
        .prepare(
          'INSERT INTO accounts (id, name, created_at, updated_at, profile_state) VALUES (?, ?, ?, ?, ?)',
        )
        .run(`acc-profile-${i}`, `Acc Profile ${i}`, now, now, validProfileStates[i]);
    }

    // 1. profile_state negative: invalid string rejected
    assert.throws(
      () =>
        sqlite
          .prepare(
            'INSERT INTO accounts (id, name, created_at, updated_at, profile_state) VALUES (?, ?, ?, ?, ?)',
          )
          .run('acc-profile-inv', 'Acc Invalid', now, now, 'INVALID'),
      /CHECK constraint failed: accounts_profile_state_check/,
    );

    // 2. lifecycle_status positive: all valid enums accepted
    const validLifecycleStatuses = ['ACTIVE', 'UNBOUND'];
    for (let i = 0; i < validLifecycleStatuses.length; i++) {
      sqlite
        .prepare(
          'INSERT INTO accounts (id, name, created_at, updated_at, lifecycle_status) VALUES (?, ?, ?, ?, ?)',
        )
        .run(`acc-lifecycle-${i}`, `Acc Lifecycle ${i}`, now, now, validLifecycleStatuses[i]);
    }

    // 2. lifecycle_status negative: invalid string rejected
    assert.throws(
      () =>
        sqlite
          .prepare(
            'INSERT INTO accounts (id, name, created_at, updated_at, lifecycle_status) VALUES (?, ?, ?, ?, ?)',
          )
          .run('acc-lifecycle-inv', 'Acc Invalid', now, now, 'DISABLED'),
      /CHECK constraint failed: accounts_lifecycle_status_check/,
    );
  } finally {
    sqlite.close();
  }
});

test('V4Constraint: SQLite directly enforces non-blank constraints on optional text columns', (context) => {
  const { databasePath } = createTemporaryDatabase(context);
  const sqlite = new BetterSqlite3(databasePath);
  try {
    const now = Date.now();

    // Positive: NULL accepted for all optional columns
    sqlite
      .prepare(
        'INSERT INTO accounts (id, name, created_at, updated_at, avatar_remote_url, avatar_cache_key, douyin_unique_id, douyin_short_id, douyin_sec_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('acc-all-null', 'Acc Null', now, now, null, null, null, null, null);

    // Positive: Valid non-blank strings accepted
    sqlite
      .prepare(
        'INSERT INTO accounts (id, name, created_at, updated_at, avatar_remote_url, avatar_cache_key, douyin_unique_id, douyin_short_id, douyin_sec_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'acc-all-valid',
        'Acc Valid',
        now,
        now,
        'https://example.com/avatar.jpg',
        'cache-key-1',
        'unique_101',
        'short_101',
        'sec_uid_101',
      );

    // Negative: empty string and whitespace-only rejected for each column
    const stringCheckColumns = [
      { col: 'avatar_remote_url', constraint: 'accounts_avatar_remote_url_check' },
      { col: 'avatar_cache_key', constraint: 'accounts_avatar_cache_key_check' },
      { col: 'douyin_unique_id', constraint: 'accounts_douyin_unique_id_check' },
      { col: 'douyin_short_id', constraint: 'accounts_douyin_short_id_check' },
      { col: 'douyin_sec_uid', constraint: 'accounts_douyin_sec_uid_check' },
    ];

    const whitespaceVariants = [
      { name: 'empty', val: '' },
      { name: 'spaces', val: '   ' },
      { name: 'tab', val: '\t' },
      { name: 'lf', val: '\n' },
      { name: 'cr', val: '\r' },
      { name: 'crlf', val: '\r\n' },
      { name: 'space-tab', val: ' \t ' },
      { name: 'tab-lf', val: '\t\n' },
      { name: 'mixed', val: ' \r\n\t ' },
    ];

    for (const { col, constraint } of stringCheckColumns) {
      for (const { name: vName, val: vVal } of whitespaceVariants) {
        assert.throws(
          () =>
            sqlite
              .prepare(
                `INSERT INTO accounts (id, name, created_at, updated_at, ${col}) VALUES (?, ?, ?, ?, ?)`,
              )
              .run(`acc-${col}-${vName}`, `Acc ${vName}`, now, now, vVal),
          new RegExp(`CHECK constraint failed: ${constraint}`),
          `Column '${col}' must reject whitespace variant '${vName}'`,
        );
      }
    }
  } finally {
    sqlite.close();
  }
});

test('V4Constraint: legacy account post-migration updates enforce all 7 CHECK constraints', (context) => {
  const { client, databasePath } = createV1EightDatabase(context);

  // Insert a legacy account fixture into V3 schema
  const legacyAccount = insertLegacyAccount(databasePath, { name: 'Legacy Account To Upgrade' });

  // Run V4 migration (0008)
  const migrationResult = client.migrate();
  assert.equal(migrationResult.appliedMigrationCount, 9);

  const sqlite = new BetterSqlite3(databasePath);
  try {
    // 1. Valid updates on legacy row succeed
    sqlite
      .prepare(
        'UPDATE accounts SET profile_state = ?, lifecycle_status = ?, avatar_remote_url = ? WHERE id = ?',
      )
      .run('READY', 'ACTIVE', 'https://example.com/new-avatar.png', legacyAccount.id);

    const updated = sqlite
      .prepare(
        'SELECT profile_state, lifecycle_status, avatar_remote_url FROM accounts WHERE id = ?',
      )
      .get(legacyAccount.id) as {
      profile_state: string;
      lifecycle_status: string;
      avatar_remote_url: string;
    };
    assert.equal(updated.profile_state, 'READY');
    assert.equal(updated.lifecycle_status, 'ACTIVE');
    assert.equal(updated.avatar_remote_url, 'https://example.com/new-avatar.png');

    // 2. Invalid profile_state update on legacy row is rejected
    assert.throws(
      () =>
        sqlite
          .prepare('UPDATE accounts SET profile_state = ? WHERE id = ?')
          .run('BOGUS_STATE', legacyAccount.id),
      /CHECK constraint failed: accounts_profile_state_check/,
    );

    // 3. Invalid lifecycle_status update on legacy row is rejected
    assert.throws(
      () =>
        sqlite
          .prepare('UPDATE accounts SET lifecycle_status = ? WHERE id = ?')
          .run('DISABLED', legacyAccount.id),
      /CHECK constraint failed: accounts_lifecycle_status_check/,
    );

    // 4. Blank / whitespace-only optional columns on legacy row are rejected
    const whitespaceVariants = ['', '   ', '\t', '\n', '\r', '\r\n', ' \t ', '\t\n', ' \r\n\t '];

    for (const ws of whitespaceVariants) {
      assert.throws(
        () =>
          sqlite
            .prepare('UPDATE accounts SET avatar_remote_url = ? WHERE id = ?')
            .run(ws, legacyAccount.id),
        /CHECK constraint failed: accounts_avatar_remote_url_check/,
      );

      assert.throws(
        () =>
          sqlite
            .prepare('UPDATE accounts SET douyin_short_id = ? WHERE id = ?')
            .run(ws, legacyAccount.id),
        /CHECK constraint failed: accounts_douyin_short_id_check/,
      );

      assert.throws(
        () =>
          sqlite
            .prepare('UPDATE accounts SET douyin_sec_uid = ? WHERE id = ?')
            .run(ws, legacyAccount.id),
        /CHECK constraint failed: accounts_douyin_sec_uid_check/,
      );
    }
  } finally {
    sqlite.close();
  }
});
