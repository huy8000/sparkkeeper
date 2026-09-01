import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdminUserRepository,
  ContactRepository,
  FriendRepository,
  LegacyBridgeRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendTaskRepository,
} from '../src/index.js';
import { createV1EightDatabase, insertLegacyAccount } from './testDatabase.js';

test('V4LegacyBridge: friend binding lifecycle (PENDING -> BOUND / DISMISSED)', (context) => {
  const temporary = createV1EightDatabase(context);
  const { client, databasePath } = temporary;
  const now = new Date('2026-08-31T08:00:00.000Z');

  const account = insertLegacyAccount(databasePath, {
    id: 'legacy-acc-bridge-1',
    name: 'Bridge Account 1',
    loginStatus: 'READY',
    nowMs: now.getTime(),
  });

  const friendRepo = new FriendRepository(client);
  const friend1 = friendRepo.create({ accountId: account.id, displayName: 'Legacy Alice', now });
  const friend2 = friendRepo.create({ accountId: account.id, displayName: 'Legacy Bob', now });

  // Apply V4 migration to generate legacy_friend_bindings
  client.migrate();

  const admin = new AdminUserRepository(client).create({
    username: 'admin_bridge',
    passwordHash: 'hash',
  });
  const bridgeRepo = new LegacyBridgeRepository(client);
  const contactRepo = new ContactRepository(client);

  const pendingBindings = bridgeRepo.listPendingFriendBindings(account.id);
  assert.equal(pendingBindings.length, 2);

  // Create V4 contact for Alice and bind
  const { contact: contactAlice } = contactRepo.createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Alice V4',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_alice_v4',
      source: 'LEGACY_MANUAL',
    },
  });

  const boundAlice = bridgeRepo.bindFriend({
    friendId: friend1.id,
    contactId: contactAlice.id,
    adminUserId: admin.id,
  });
  assert.equal(boundAlice.status, 'BOUND');
  assert.equal(boundAlice.contactId, contactAlice.id);
  assert.equal(boundAlice.boundByAdminUserId, admin.id);
  assert.ok(boundAlice.boundAt);

  // Account mismatch rejection
  const accountOther = insertLegacyAccount(databasePath, {
    id: 'legacy-acc-bridge-other',
    name: 'Other Account',
    loginStatus: 'READY',
    nowMs: now.getTime(),
  });
  const { contact: contactOtherAccount } = contactRepo.createWithPreferredIdentity({
    accountId: accountOther.id,
    type: 'PERSON',
    displayName: 'Other Contact',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_other_acc',
      source: 'LEGACY_MANUAL',
    },
  });

  assert.throws(
    () =>
      bridgeRepo.bindFriend({
        friendId: friend2.id,
        contactId: contactOtherAccount.id,
        adminUserId: admin.id,
      }),
    (err: unknown) =>
      err instanceof Error && (err as { code?: string }).code === 'ACCOUNT_MISMATCH',
  );

  // Dismiss Bob's binding
  const dismissedBob = bridgeRepo.dismissFriend(friend2.id);
  assert.equal(dismissedBob.status, 'DISMISSED');
  assert.ok(dismissedBob.dismissedAt);

  // Attempting to re-dismiss or bind non-pending throws error
  assert.throws(
    () => bridgeRepo.dismissFriend(friend2.id),
    (err: unknown) => err instanceof Error && (err as { code?: string }).code === 'TERMINAL_STATE',
  );

  // Pending list is now empty
  const remainingPending = bridgeRepo.listPendingFriendBindings(account.id);
  assert.equal(remainingPending.length, 0);
});

test('V4LegacyBridge: schedule import lifecycle (PENDING -> CONVERTED / DISMISSED)', (context) => {
  const temporary = createV1EightDatabase(context);
  const { client, databasePath } = temporary;
  const now = new Date('2026-08-31T08:00:00.000Z');

  const account1 = insertLegacyAccount(databasePath, {
    id: 'legacy-acc-bridge-2',
    name: 'Bridge Account 2',
    loginStatus: 'READY',
    nowMs: now.getTime(),
  });

  const account2 = insertLegacyAccount(databasePath, {
    id: 'legacy-acc-bridge-3',
    name: 'Bridge Account 3',
    loginStatus: 'READY',
    nowMs: now.getTime(),
  });

  const scheduleRepo = new ScheduleRepository(client);
  const schedule1 = scheduleRepo.create({
    accountId: account1.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 3,
    retryIntervalSeconds: 60,
    now,
  });
  const schedule2 = scheduleRepo.create({
    accountId: account2.id,
    startTime: '14:00',
    endTime: '15:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 2,
    retryIntervalSeconds: 120,
    now,
  });

  // Apply V4 migration to generate legacy_schedule_imports
  client.migrate();

  const admin = new AdminUserRepository(client).create({
    username: 'admin_bridge_sched',
    passwordHash: 'hash',
  });
  const bridgeRepo = new LegacyBridgeRepository(client);
  const templateRepo = new MessageTemplateRepository(client);
  const taskRepo = new SendTaskRepository(client);
  const contactRepo = new ContactRepository(client);

  const template = templateRepo.create({
    name: 'Default Greeting Template',
    providerType: 'STATIC',
    messages: ['Hi!'],
  });

  const { contact } = contactRepo.createWithPreferredIdentity({
    accountId: account1.id,
    type: 'PERSON',
    displayName: 'Charlie V4',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_charlie_v4',
      source: 'LEGACY_MANUAL',
    },
  });

  const pendingImportsAcc1 = bridgeRepo.listPendingScheduleImports(account1.id);
  assert.equal(pendingImportsAcc1.length, 1);

  // Convert schedule1: first create the V4 send task from imported schedule data
  const { task } = taskRepo.create({
    name: 'Converted Task from V3 Schedule',
    accountId: account1.id,
    templateId: template.id,
    startTime: pendingImportsAcc1[0]!.startTime,
    endTime: pendingImportsAcc1[0]!.endTime,
    timezone: pendingImportsAcc1[0]!.timezone,
    maxAttempts: pendingImportsAcc1[0]!.maxAttempts,
    retryIntervalSeconds: pendingImportsAcc1[0]!.retryIntervalSeconds,
    targetContactIds: [contact.id],
  });

  // Account mismatch on schedule conversion: task belongs to account1, schedule belongs to account2
  assert.throws(
    () =>
      bridgeRepo.convertSchedule({
        scheduleId: schedule2.id,
        convertedTaskId: task.id, // task.accountId === account1, schedule2.accountId === account2
        adminUserId: admin.id,
      }),
    (err: unknown) =>
      err instanceof Error && (err as { code?: string }).code === 'ACCOUNT_MISMATCH',
  );

  // Convert schedule1: first create the V4 send task from imported schedule data
  const converted1 = bridgeRepo.convertSchedule({
    scheduleId: schedule1.id,
    convertedTaskId: task.id,
    adminUserId: admin.id,
  });

  assert.equal(converted1.status, 'CONVERTED');
  assert.equal(converted1.convertedTaskId, task.id);
  assert.equal(converted1.convertedByAdminUserId, admin.id);
  assert.ok(converted1.convertedAt);

  // Attempting to re-convert non-pending schedule throws error
  assert.throws(
    () =>
      bridgeRepo.convertSchedule({
        scheduleId: schedule1.id,
        convertedTaskId: task.id,
        adminUserId: admin.id,
      }),
    (err: unknown) => err instanceof Error && (err as { code?: string }).code === 'TERMINAL_STATE',
  );

  // Dismiss schedule2 on account2
  const dismissed2 = bridgeRepo.dismissSchedule(schedule2.id);
  assert.equal(dismissed2.status, 'DISMISSED');
  assert.ok(dismissed2.dismissedAt);

  // Pending imports is now empty for both accounts
  assert.equal(bridgeRepo.listPendingScheduleImports(account1.id).length, 0);
  assert.equal(bridgeRepo.listPendingScheduleImports(account2.id).length, 0);
});
