import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { adminUsers } from './adminUsers.js';

export const adminSessions = sqliteTable(
  'admin_sessions',
  {
    id: text('id').primaryKey(),
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'no action' }),
    tokenDigest: text('token_digest').notNull().unique(),
    csrfTokenDigest: text('csrf_token_digest').notNull(),
    sessionVersion: integer('session_version').notNull(),
    reauthenticatedAt: integer('reauthenticated_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    idleExpiresAt: integer('idle_expires_at', { mode: 'timestamp_ms' }).notNull(),
    absoluteExpiresAt: integer('absolute_expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    check(
      'admin_sessions_token_digest_not_empty_check',
      sql`length(trim(${table.tokenDigest})) > 0`,
    ),
    check(
      'admin_sessions_csrf_token_digest_not_empty_check',
      sql`length(trim(${table.csrfTokenDigest})) > 0`,
    ),
    check('admin_sessions_session_version_check', sql`${table.sessionVersion} >= 1`),
    check(
      'admin_sessions_timeline_check',
      sql`${table.createdAt} <= ${table.lastSeenAt} and ${table.lastSeenAt} <= ${table.idleExpiresAt}`,
    ),
    check(
      'admin_sessions_absolute_timeline_check',
      sql`${table.createdAt} < ${table.absoluteExpiresAt} and ${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
    check(
      'admin_sessions_reauthenticated_at_check',
      sql`${table.reauthenticatedAt} is null or (${table.reauthenticatedAt} >= ${table.createdAt} and ${table.reauthenticatedAt} <= ${table.absoluteExpiresAt})`,
    ),
    check(
      'admin_sessions_revoke_reason_check',
      sql`(${table.revokedAt} is null and ${table.revokeReason} is null) or (${table.revokedAt} is not null and ${table.revokeReason} is not null and length(trim(${table.revokeReason})) > 0)`,
    ),
    index('admin_sessions_admin_user_revoked_idx').on(table.adminUserId, table.revokedAt),
    index('admin_sessions_idle_expires_at_idx').on(table.idleExpiresAt),
    index('admin_sessions_absolute_expires_at_idx').on(table.absoluteExpiresAt),
  ],
);

export type AdminSessionRow = typeof adminSessions.$inferSelect;
export type NewAdminSessionRow = typeof adminSessions.$inferInsert;
