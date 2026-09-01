import type { AdminUserStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const adminUsers = sqliteTable(
  'admin_users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    usernameNormalized: text('username_normalized').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    status: text('status').$type<AdminUserStatus>().notNull().default('ACTIVE'),
    sessionVersion: integer('session_version').notNull().default(1),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
    lastFailedLoginAt: integer('last_failed_login_at', { mode: 'timestamp_ms' }),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    passwordChangedAt: integer('password_changed_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('admin_users_username_not_empty_check', sql`length(trim(${table.username})) > 0`),
    check(
      'admin_users_username_normalized_not_empty_check',
      sql`length(trim(${table.usernameNormalized})) > 0`,
    ),
    check(
      'admin_users_password_hash_not_empty_check',
      sql`length(trim(${table.passwordHash})) > 0`,
    ),
    check('admin_users_status_check', sql`${table.status} in ('ACTIVE', 'DISABLED')`),
    check('admin_users_session_version_check', sql`${table.sessionVersion} >= 1`),
    check('admin_users_failed_login_count_check', sql`${table.failedLoginCount} >= 0`),
    uniqueIndex('admin_users_active_singleton_idx')
      .on(table.status)
      .where(sql`${table.status} = 'ACTIVE'`),
  ],
);

export type AdminUserRow = typeof adminUsers.$inferSelect;
export type NewAdminUserRow = typeof adminUsers.$inferInsert;
