import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  AuditAction,
  AuditEntityType,
  DeliveryResolutionValue,
  LegacyFriendSummary,
  LegacyScheduleSummary,
  Page,
} from '@sparkkeeper/shared';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  accounts,
  contacts,
  legacyFriendBindings,
  legacyScheduleImports,
  legacyProfileBindings,
  auditEvents,
} from '../schema/index.js';
import { TaskConfigurationRepository } from './TaskConfigurationRepository.js';
import { DeliveryResolutionRepository } from './DeliveryResolutionRepository.js';
import { UnifiedRunRepository } from './UnifiedRunRepository.js';

export class MigrationError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'TARGET_NOT_ELIGIBLE'
      | 'MIGRATION_RECOVERY_REQUIRED'
      | 'RUNTIME_BUSY',
  ) {
    super(code);
  }
}
export function pageOffset(cursor?: string): number {
  if (!cursor) return 0;
  if (cursor.length > 24) throw new MigrationError('CONFLICT');
  const decoded = Buffer.from(cursor, 'base64url').toString();
  if (!/^v1:[0-9]{1,7}$/.test(decoded)) throw new MigrationError('CONFLICT');
  return Number(decoded.slice(3));
}
export function offsetPage<T>(rows: T[], offset: number, limit: number): Page<T> {
  return {
    items: rows.slice(0, limit),
    nextCursor:
      rows.length > limit ? Buffer.from(`v1:${offset + limit}`).toString('base64url') : null,
  };
}
export class MigrationRepository {
  constructor(readonly client: DatabaseClient) {}
  transaction<T>(fn: () => T): T {
    return this.client.orm.transaction(
      () => {
        const result = fn();
        if (result && typeof result === 'object' && 'then' in result)
          throw new Error('ASYNC_TRANSACTION_FORBIDDEN');
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  private audit(
    action: AuditAction,
    entityType: AuditEntityType,
    entityId: string,
    actor: string | null,
    now: Date,
  ) {
    this.client.orm
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        action,
        entityType,
        entityId,
        actorAdminUserId: actor,
        outcome: 'SUCCESS',
        createdAt: now,
      })
      .run();
  }
  friendBindings(accountId: string, cursor?: string, limit = 50): Page<LegacyFriendSummary> {
    const offset = pageOffset(cursor);
    const rows = this.client.orm
      .select()
      .from(legacyFriendBindings)
      .where(eq(legacyFriendBindings.accountId, accountId))
      .orderBy(asc(legacyFriendBindings.createdAt), asc(legacyFriendBindings.id))
      .limit(limit + 1)
      .offset(offset)
      .all();
    return offsetPage(
      rows.map((r) => ({
        id: r.id,
        friendId: r.friendId,
        accountId: r.accountId,
        contactId: r.contactId,
        status: r.status,
        updatedAt: r.updatedAt.toISOString(),
      })),
      offset,
      limit,
    );
  }
  scheduleImports(accountId?: string, cursor?: string, limit = 50): Page<LegacyScheduleSummary> {
    const offset = pageOffset(cursor);
    const rows = this.client.orm
      .select()
      .from(legacyScheduleImports)
      .where(accountId ? eq(legacyScheduleImports.accountId, accountId) : undefined)
      .orderBy(asc(legacyScheduleImports.createdAt), asc(legacyScheduleImports.id))
      .limit(limit + 1)
      .offset(offset)
      .all();
    return offsetPage(
      rows.map((r) => ({
        id: r.id,
        scheduleId: r.scheduleId,
        accountId: r.accountId,
        status: r.status,
        convertedTaskId: r.convertedTaskId,
        startTimeSnapshot: r.startTime,
        endTimeSnapshot: r.endTime,
        timezoneSnapshot: r.timezone,
        maxAttemptsSnapshot: r.maxAttempts,
        retryIntervalSecondsSnapshot: r.retryIntervalSeconds,
        legacyEnabledSnapshot: r.legacyEnabledSnapshot,
        updatedAt: r.updatedAt.toISOString(),
      })),
      offset,
      limit,
    );
  }
  private checkVersion(row: { status: string; updatedAt: Date } | undefined, expected: string) {
    if (!row) throw new MigrationError('NOT_FOUND');
    if (row.status !== 'PENDING' || row.updatedAt.toISOString() !== expected)
      throw new MigrationError('CONFLICT');
  }
  bindFriend(
    id: string,
    expected: string,
    contactId: string | null,
    actor: string,
    now = new Date(),
  ) {
    return this.transaction(() => {
      const row = this.client.orm
        .select()
        .from(legacyFriendBindings)
        .where(eq(legacyFriendBindings.id, id))
        .get();
      this.checkVersion(row, expected);
      if (contactId) {
        const contact = this.client.orm
          .select()
          .from(contacts)
          .where(eq(contacts.id, contactId))
          .get();
        const account = this.client.orm
          .select()
          .from(accounts)
          .where(eq(accounts.id, row!.accountId))
          .get();
        if (
          !contact ||
          contact.accountId !== row!.accountId ||
          !['PERSON', 'GROUP'].includes(contact.type) ||
          !account ||
          account.lifecycleStatus !== 'ACTIVE' ||
          account.profileState === 'PROVISIONING'
        )
          throw new MigrationError('TARGET_NOT_ELIGIBLE');
      }
      const stamp = new Date(Math.max(now.getTime(), row!.updatedAt.getTime() + 1));
      this.client.orm
        .update(legacyFriendBindings)
        .set({
          status: contactId ? 'BOUND' : 'DISMISSED',
          contactId,
          boundByAdminUserId: contactId ? actor : null,
          boundAt: contactId ? stamp : null,
          dismissedAt: contactId ? null : stamp,
          updatedAt: stamp,
        })
        .where(and(eq(legacyFriendBindings.id, id), eq(legacyFriendBindings.status, 'PENDING')))
        .run();
      this.audit(
        contactId ? 'LEGACY_FRIEND_BOUND' : 'LEGACY_FRIEND_DISMISSED',
        'LEGACY_FRIEND_BINDING',
        id,
        actor,
        stamp,
      );
      return {
        id,
        friendId: row!.friendId,
        accountId: row!.accountId,
        contactId,
        status: contactId ? 'BOUND' : 'DISMISSED',
        updatedAt: stamp.toISOString(),
      };
    });
  }
  convertSchedule(
    id: string,
    expected: string,
    input: { name: string; templateId: string; contactIds: string[] } | null,
    actor: string,
    now = new Date(),
  ) {
    return this.transaction(() => {
      const row = this.client.orm
        .select()
        .from(legacyScheduleImports)
        .where(eq(legacyScheduleImports.id, id))
        .get();
      this.checkVersion(row, expected);
      if (input) {
        const account = this.client.orm
          .select()
          .from(accounts)
          .where(eq(accounts.id, row!.accountId))
          .get();
        if (
          !account ||
          account.lifecycleStatus !== 'ACTIVE' ||
          account.profileState === 'PROVISIONING'
        )
          throw new MigrationError('TARGET_NOT_ELIGIBLE');
      }
      const task = input
        ? new TaskConfigurationRepository(this.client).create(
            {
              ...input,
              accountId: row!.accountId,
              schedule: {
                type: 'DAILY_WINDOW',
                startTime: row!.startTime,
                endTime: row!.endTime,
                timezone: row!.timezone,
                maxAttempts: row!.maxAttempts,
                retryIntervalSeconds: row!.retryIntervalSeconds,
              },
            },
            actor,
            now,
          )
        : null;
      const stamp = new Date(Math.max(now.getTime(), row!.updatedAt.getTime() + 1));
      this.client.orm
        .update(legacyScheduleImports)
        .set({
          status: task ? 'CONVERTED' : 'DISMISSED',
          convertedTaskId: task?.id ?? null,
          convertedByAdminUserId: task ? actor : null,
          convertedAt: task ? stamp : null,
          dismissedAt: task ? null : stamp,
          updatedAt: stamp,
        })
        .where(and(eq(legacyScheduleImports.id, id), eq(legacyScheduleImports.status, 'PENDING')))
        .run();
      this.audit(
        task ? 'LEGACY_SCHEDULE_IMPORTED' : 'LEGACY_SCHEDULE_DISMISSED',
        'LEGACY_SCHEDULE_IMPORT',
        id,
        actor,
        stamp,
      );
      return { id, status: task ? 'CONVERTED' : 'DISMISSED', task, updatedAt: stamp.toISOString() };
    });
  }
  resolve(
    recordId: string,
    expected: string | null,
    resolution: DeliveryResolutionValue,
    note: string | undefined,
    actor: string,
    now = new Date(),
  ) {
    return this.transaction(() => {
      const reader = new UnifiedRunRepository(this.client);
      const record = reader.record(recordId);
      if (
        record.status !== 'DELIVERY_UNKNOWN' ||
        (record.latestResolution?.id ?? null) !== expected
      )
        throw new MigrationError('CONFLICT');
      const r = new DeliveryResolutionRepository(this.client).create({
        ...(record.source === 'V4'
          ? { targetSendRecordId: recordId }
          : { legacySendRecordId: recordId }),
        resolution,
        ...(note === undefined ? {} : { note }),
        supersedesResolutionId: expected,
        resolvedByAdminUserId: actor,
        now,
      });
      this.audit('DELIVERY_RESOLVED', 'DELIVERY_RESOLUTION', r.id, actor, now);
      return reader.resolutionSummary(r);
    });
  }
  hasPendingProfileBinding() {
    return !!this.client.orm
      .select({ id: legacyProfileBindings.id })
      .from(legacyProfileBindings)
      .where(eq(legacyProfileBindings.status, 'PREPARED'))
      .get();
  }
  status() {
    const counts = this.client.orm.get<{
      profilesRequiringMigration: number;
      pendingFriendBindings: number;
      pendingScheduleImports: number;
      pendingProfileBindings: number;
    }>(sql`SELECT
      (SELECT count(*) FROM accounts WHERE profile_state='MIGRATION_REQUIRED' AND lifecycle_status='ACTIVE') AS profilesRequiringMigration,
      (SELECT count(*) FROM legacy_friend_bindings WHERE status='PENDING') AS pendingFriendBindings,
      (SELECT count(*) FROM legacy_schedule_imports WHERE status='PENDING') AS pendingScheduleImports,
      (SELECT count(*) FROM legacy_profile_bindings WHERE status='PREPARED') AS pendingProfileBindings`)!;
    return {
      ...counts,
      migrationCount: this.client.inspect().appliedMigrationCount,
      automaticBinding: false,
      automaticTaskEnable: false,
      profileBindingMode: 'OFFLINE_ONLY',
    };
  }
  assertRuntimeIdle() {
    const busy = this.client.orm.get<{ busy: number }>(sql`SELECT (
      EXISTS(SELECT 1 FROM account_login_sessions WHERE status IN ('PENDING','STARTING','AWAITING_USER','READY_DETECTED','COMPLETING')) OR
      EXISTS(SELECT 1 FROM contact_sync_runs WHERE status IN ('PENDING','RUNNING')) OR
      EXISTS(SELECT 1 FROM execution_runs WHERE status IN ('PENDING','RUNNING')) OR
      EXISTS(SELECT 1 FROM daily_runs WHERE status='RUNNING') OR
      EXISTS(SELECT 1 FROM scheduled_run_snapshots WHERE active_slot=1) OR
      EXISTS(SELECT 1 FROM test_send_intents WHERE active_slot=1)) AS busy`);
    if (busy?.busy) throw new MigrationError('RUNTIME_BUSY');
  }
  profileIntent(accountId: string) {
    return this.client.orm
      .select()
      .from(legacyProfileBindings)
      .where(eq(legacyProfileBindings.accountId, accountId))
      .get();
  }
  prepareProfileBinding(accountId: string, device: string, inode: string, now = new Date()) {
    return this.transaction(() => {
      this.assertRuntimeIdle();
      const existing = this.profileIntent(accountId);
      if (existing) return existing;
      const rows = this.client.orm.select().from(accounts).all();
      const a = rows[0];
      if (
        rows.length !== 1 ||
        a?.id !== accountId ||
        a.lifecycleStatus !== 'ACTIVE' ||
        a.profileState !== 'MIGRATION_REQUIRED' ||
        a.douyinSecUid ||
        a.douyinUniqueId ||
        a.douyinShortId
      )
        throw new MigrationError('TARGET_NOT_ELIGIBLE');
      const r = this.client.orm
        .insert(legacyProfileBindings)
        .values({
          id: randomUUID(),
          accountId,
          sourceDevice: device,
          sourceInode: inode,
          status: 'PREPARED',
          createdAt: now,
        })
        .returning()
        .get();
      this.audit('LEGACY_PROFILE_BINDING_STARTED', 'DOUYIN_ACCOUNT', accountId, null, now);
      return r;
    });
  }
  completeProfileBinding(accountId: string, id: string, now = new Date()) {
    return this.transaction(() => {
      this.assertRuntimeIdle();
      const r = this.profileIntent(accountId);
      if (!r || r.id !== id) throw new MigrationError('CONFLICT');
      if (r.status === 'COMPLETED') return;
      const result = this.client.orm
        .update(accounts)
        .set({
          profileState: 'READY',
          loginStatus: 'UNKNOWN',
          lastAuthCheckAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(accounts.id, accountId),
            eq(accounts.profileState, 'MIGRATION_REQUIRED'),
            eq(accounts.lifecycleStatus, 'ACTIVE'),
          ),
        )
        .returning()
        .get();
      if (!result) throw new MigrationError('CONFLICT');
      this.client.orm
        .update(legacyProfileBindings)
        .set({ status: 'COMPLETED', completedAt: now })
        .where(eq(legacyProfileBindings.id, id))
        .run();
      this.audit('LEGACY_PROFILE_BOUND', 'DOUYIN_ACCOUNT', accountId, null, now);
    });
  }
}
