import type { AuditAction, AuditEntityType, AuditOutcome } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { adminUsers } from './adminUsers.js';

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorAdminUserId: text('actor_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'set null',
    }),
    action: text('action').$type<AuditAction>().notNull(),
    entityType: text('entity_type').$type<AuditEntityType>().notNull(),
    entityId: text('entity_id'),
    outcome: text('outcome').$type<AuditOutcome>().notNull(),
    reasonCode: text('reason_code'),
    correlationDigest: text('correlation_digest'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('audit_events_outcome_check', sql`${table.outcome} in ('SUCCESS', 'REJECTED', 'FAILED')`),
    check(
      'audit_events_action_check',
      sql`${table.action} in ('ADMIN_INITIALIZED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_REVOKED', 'PASSWORD_CHANGED', 'ACCOUNT_LOGIN_STARTED', 'ACCOUNT_LOGIN_CANCELLED', 'ACCOUNT_CREATED', 'ACCOUNT_RELOGIN_COMPLETED', 'ACCOUNT_UNBOUND', 'CONTACT_SYNC_STARTED', 'CONTACT_SYNC_FINISHED', 'PREFERRED_IDENTITY_CHANGED', 'LEGACY_FRIEND_BOUND', 'LEGACY_FRIEND_DISMISSED', 'TEMPLATE_CREATED', 'TEMPLATE_UPDATED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_ENABLED', 'TASK_DISABLED', 'TASK_ARCHIVED', 'TEST_SEND_CONFIRMED', 'DELIVERY_RESOLVED', 'NOTIFICATION_CONFIG_UPDATED', 'NOTIFICATION_TEST_CONFIRMED', 'SESSION_CLEANUP', 'PROFILE_QUARANTINED')`,
    ),
    check(
      'audit_events_entity_type_check',
      sql`${table.entityType} in ('ADMIN_USER', 'ADMIN_SESSION', 'ACCOUNT_LOGIN_SESSION', 'DOUYIN_ACCOUNT', 'CONTACT_SYNC_RUN', 'CONTACT', 'CONTACT_IDENTITY', 'TEMPLATE', 'SEND_TASK', 'EXECUTION_RUN', 'TARGET_SEND_RECORD', 'DELIVERY_RESOLUTION', 'NOTIFICATION_CONFIG', 'LEGACY_FRIEND_BINDING', 'LEGACY_SCHEDULE_IMPORT', 'SYSTEM')`,
    ),
    check(
      'audit_events_entity_id_check',
      sql`${table.entityId} is null or length(trim(${table.entityId})) > 0`,
    ),
    check(
      'audit_events_reason_code_check',
      sql`${table.reasonCode} is null or length(trim(${table.reasonCode})) > 0`,
    ),
    check(
      'audit_events_correlation_digest_check',
      sql`${table.correlationDigest} is null or length(trim(${table.correlationDigest})) > 0`,
    ),
    index('audit_events_created_at_idx').on(table.createdAt),
    index('audit_events_actor_created_idx').on(table.actorAdminUserId, table.createdAt),
    index('audit_events_entity_created_idx').on(table.entityType, table.entityId, table.createdAt),
  ],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
