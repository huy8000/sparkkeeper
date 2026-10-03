import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  AdminUserRepository,
  ContactRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  DailyRunRepository,
  SendRecordRepository,
  MigrationRepository,
  UnifiedRunRepository,
  SafeRuntimeEventRepository,
  inspectMigration,
  accounts,
  friends,
  schedules,
  sendTasks,
  auditEvents,
  deliveryResolutions,
  sendRecords,
} from '../src/index.js';
import { createV1EightDatabase, insertLegacyAccount } from './testDatabase.js';
import { testSendFixture } from './testSendFixture.js';
import { parseBusinessDate } from '@sparkkeeper/shared';

function legacy(t: Parameters<typeof createV1EightDatabase>[0]) {
  const f = createV1EightDatabase(t),
    now = new Date('2026-10-03T00:00:00Z');
  const a = insertLegacyAccount(f.databasePath, {
    id: randomUUID(),
    name: 'Synthetic legacy',
    nowMs: now.getTime(),
  });
  const friend = new FriendRepository(f.client).create({
    accountId: a.id,
    displayName: 'Same name',
    now,
  });
  const schedule = new ScheduleRepository(f.client).create({
    accountId: a.id,
    startTime: '09:00',
    endTime: '12:00',
    timezone: 'UTC',
    enabled: true,
    maxAttempts: 2,
    retryIntervalSeconds: 60,
    now,
  });
  const template = new MessageTemplateRepository(f.client).create({
    name: 'Synthetic template',
    providerType: 'STATIC',
    messages: ['Synthetic message'],
    now,
  });
  return { ...f, a, friend, schedule, template, now };
}
test('0013 populated V3 upgrade preserves exact legacy values and creates only PENDING bridges; fresh/reopen and journal audit', (t) => {
  const f = legacy(t),
    before = inspectMigration(f.client);
  assert.equal(before.ok, true);
  assert.equal(before.migrationCount, 8);
  assert.equal(f.client.migrate().appliedMigrationCount, 14);
  const after = inspectMigration(f.client);
  assert.deepEqual(after.legacy, before.legacy);
  assert.equal(after.ok, true);
  assert.equal(after.enabledTasks, 0);
  assert.equal(after.counts.contacts, 0);
  assert.equal(after.counts.delivery_resolutions, 0);
  assert.equal(after.counts.legacy_friend_bindings, 1);
  assert.equal(after.counts.legacy_schedule_imports, 1);
  assert.equal(
    new MigrationRepository(f.client).friendBindings(f.a.id).items[0]!.status,
    'PENDING',
  );
  assert.equal(f.client.migrate().appliedMigrationCount, 14);
  assert.deepEqual(inspectMigration(f.client).legacy, before.legacy);
});
test('explicit binding/import CAS, same account and atomic disabled task/audit; no legacy mutation', (t) => {
  const f = legacy(t);
  f.client.migrate();
  const before = inspectMigration(f.client).legacy;
  const admin = new AdminUserRepository(f.client).create({
    username: 'Synthetic',
    passwordHash: 'fixture',
  });
  const c = new ContactRepository(f.client).createWithPreferredIdentity({
    accountId: f.a.id,
    type: 'PERSON',
    displayName: 'Same name',
    initialIdentity: { kind: 'SEC_UID', value: 'synthetic-id', source: 'DOM' },
  }).contact;
  const repo = new MigrationRepository(f.client),
    b = repo.friendBindings(f.a.id).items[0]!,
    s = repo.scheduleImports(f.a.id).items[0]!;
  assert.throws(() => repo.bindFriend(b.id, new Date(0).toISOString(), c.id, admin.id), /CONFLICT/);
  f.client.orm
    .update(accounts)
    .set({ profileState: 'PROVISIONING' })
    .where(eq(accounts.id, f.a.id))
    .run();
  assert.throws(() => repo.bindFriend(b.id, b.updatedAt, c.id, admin.id), /TARGET_NOT_ELIGIBLE/);
  f.client.orm
    .update(accounts)
    .set({ profileState: 'MIGRATION_REQUIRED' })
    .where(eq(accounts.id, f.a.id))
    .run();
  const bound = repo.bindFriend(b.id, b.updatedAt, c.id, admin.id);
  assert.equal(bound.status, 'BOUND');
  assert.equal(bound.friendId, f.friend.id);
  assert.equal(bound.contactId, c.id);
  assert.throws(() => repo.bindFriend(b.id, b.updatedAt, c.id, admin.id), /CONFLICT/);
  assert.throws(() =>
    repo.convertSchedule(
      s.id,
      s.updatedAt,
      { name: 'Imported', templateId: randomUUID(), contactIds: [c.id] },
      admin.id,
    ),
  );
  assert.equal(f.client.orm.select().from(sendTasks).all().length, 0);
  assert.equal(repo.scheduleImports(f.a.id).items[0]!.status, 'PENDING');
  const converted = repo.convertSchedule(
    s.id,
    s.updatedAt,
    { name: 'Imported', templateId: f.template.id, contactIds: [c.id] },
    admin.id,
  );
  assert.equal(converted.task!.enabled, false);
  assert.equal(converted.task!.schedule.maxAttempts, 2);
  assert.throws(() => repo.convertSchedule(s.id, s.updatedAt, null, admin.id), /CONFLICT/);
  assert.deepEqual(inspectMigration(f.client).legacy, before);
  assert.equal(
    f.client.orm
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'LEGACY_SCHEDULE_IMPORTED'))
      .all().length,
    1,
  );
  assert.equal(
    f.client.orm.select().from(friends).where(eq(friends.id, f.friend.id)).get()!.enabled,
    true,
  );
  assert.equal(
    f.client.orm.select().from(schedules).where(eq(schedules.id, f.schedule.id)).get()!.enabled,
    true,
  );
});
test('legacy UNKNOWN resolution chain CAS is append-only, audited, and never changes machine/message truth', (t) => {
  const f = legacy(t);
  const day = parseBusinessDate('2026-10-03');
  const run = new DailyRunRepository(f.client).createOrGet({
    accountId: f.a.id,
    businessDate: day,
    now: f.now,
  });
  const records = new SendRecordRepository(f.client);
  const r = records.prepare({
    dailyRunId: run.id,
    friendId: f.friend.id,
    businessDate: day,
    messageTemplateId: f.template.id,
    messageText: 'Synthetic private body',
    now: f.now,
  }).record;
  records.claimInitialAttempt(r.id, f.now, 2);
  records.markSendActionStarted(r.id, f.now);
  records.markDeliveryUnknown(r.id, f.now);
  f.client.migrate();
  const admin = new AdminUserRepository(f.client).create({
      username: 'Synthetic',
      passwordHash: 'fixture',
    }),
    repo = new MigrationRepository(f.client),
    reader = new UnifiedRunRepository(f.client);
  const before = f.client.orm.select().from(sendRecords).where(eq(sendRecords.id, r.id)).get();
  const first = repo.resolve(r.id, null, 'INCONCLUSIVE', 'Synthetic private note', admin.id, f.now);
  assert.throws(
    () => repo.resolve(r.id, null, 'CONFIRMED_DELIVERED', undefined, admin.id),
    /CONFLICT/,
  );
  const last = repo.resolve(r.id, first.id, 'CONFIRMED_NOT_DELIVERED', undefined, admin.id);
  assert.equal(reader.record(r.id).latestResolution!.id, last.id);
  assert.equal(reader.resolutions(r.id).items.length, 2);
  assert.deepEqual(
    f.client.orm.select().from(sendRecords).where(eq(sendRecords.id, r.id)).get(),
    before,
  );
  assert.throws(
    () => f.client.orm.delete(deliveryResolutions).where(eq(deliveryResolutions.id, last.id)).run(),
    /RESOLUTION_APPEND_ONLY/,
  );
  assert.throws(
    () =>
      f.client.orm
        .update(auditEvents)
        .set({ reasonCode: 'CHANGED' })
        .where(eq(auditEvents.action, 'DELIVERY_RESOLVED'))
        .run(),
    /AUDIT_APPEND_ONLY/,
  );
  assert.doesNotMatch(JSON.stringify(reader.records(run.id)), /Synthetic private/);
});
test('V4 safe events are atomic facts, pagination/source collision fail closed, no private fields', (t) => {
  const f = testSendFixture(t),
    reader = new UnifiedRunRepository(f.client),
    events = new SafeRuntimeEventRepository(f.client);
  const consumed = f.consume();
  const runId = consumed.runId;
  assert.equal(f.repository.claim(runId), true);
  f.repository.boundary(runId);
  f.repository.finish(runId, 'DELIVERY_UNKNOWN', 'PROCESS_INTERRUPTED_AFTER_ACTION');
  assert.deepEqual(
    events.after(0).map((e) => e.eventType),
    ['RUN_STARTED', 'DELIVERY_UNKNOWN', 'RUN_FINISHED'],
  );
  assert.equal(reader.run(runId).source, 'V4');
  assert.equal(reader.record(f.repository.execution(runId).record.id).status, 'DELIVERY_UNKNOWN');
  assert.doesNotMatch(
    JSON.stringify(reader.records(runId)),
    /Synthetic message|Fixture-001|fingerprint|messageText|Digest/,
  );
  const now = new Date();
  f.client.orm.run(
    sql`INSERT INTO daily_runs(id,account_id,business_date,status,created_at,updated_at) VALUES(${runId},${f.account.id},'2026-10-03','READY',${now.getTime()},${now.getTime()})`,
  );
  assert.throws(() => reader.run(runId), /CONFLICT/);
  const page = reader.list({ limit: 1 });
  assert.ok(page.nextCursor);
  assert.equal(reader.list({ limit: 1, cursor: page.nextCursor! }).items.length, 1);
  assert.throws(() => reader.list({ cursor: 'invalid' }), /CONFLICT/);
});
