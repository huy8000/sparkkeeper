import type {
  AccountLoginFailureCode,
  AccountLoginPurpose,
  AccountLoginSessionStatus,
} from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { adminUsers } from './adminUsers.js';

export const accountLoginSessions = sqliteTable(
  'account_login_sessions',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose').$type<AccountLoginPurpose>().notNull(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'no action' }),
    pendingAccountId: text('pending_account_id'),
    createdByAdminUserId: text('created_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'no action' }),
    status: text('status').$type<AccountLoginSessionStatus>().notNull().default('PENDING'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    readyDetectedAt: integer('ready_detected_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
    failureCode: text('failure_code').$type<AccountLoginFailureCode>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'account_login_sessions_purpose_check',
      sql`${table.purpose} in ('ADD_ACCOUNT', 'RELOGIN')`,
    ),
    check(
      'account_login_sessions_status_check',
      sql`${table.status} in ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED')`,
    ),
    check(
      'account_login_sessions_failure_code_check',
      sql`${table.failureCode} is null or ${table.failureCode} in ('START_FAILED', 'PROFILE_LEASE_CONFLICT', 'PROFILE_PREPARE_FAILED', 'CONSOLE_START_FAILED', 'AUTH_NOT_READY', 'PROFILE_IDENTITY_UNAVAILABLE', 'PROFILE_IDENTITY_CONFLICT', 'READY_TIMEOUT', 'PROCESS_EXITED', 'FINALIZE_FAILED', 'INTEGRITY_ERROR')`,
    ),
    check(
      'account_login_sessions_purpose_target_check',
      sql`(${table.purpose} = 'ADD_ACCOUNT' and ${table.accountId} is null and ${table.pendingAccountId} is not null and length(trim(${table.pendingAccountId})) > 0) or (${table.purpose} = 'RELOGIN' and ${table.accountId} is not null and ${table.pendingAccountId} is null)`,
    ),
    check('account_login_sessions_expires_at_check', sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      'account_login_sessions_completed_at_check',
      sql`(${table.status} = 'COMPLETED' and ${table.completedAt} is not null) or (${table.status} != 'COMPLETED' and ${table.completedAt} is null)`,
    ),
    check(
      'account_login_sessions_cancelled_at_check',
      sql`(${table.status} = 'CANCELLED' and ${table.cancelledAt} is not null) or (${table.status} != 'CANCELLED' and ${table.cancelledAt} is null)`,
    ),
    check(
      'account_login_sessions_failure_check',
      sql`(${table.status} = 'FAILED' and ${table.failureCode} is not null) or (${table.status} != 'FAILED' and ${table.failureCode} is null)`,
    ),
    uniqueIndex('account_login_sessions_active_relogin_idx')
      .on(table.accountId)
      .where(
        sql`${table.accountId} is not null and ${table.status} in ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING')`,
      ),
  ],
);

export type AccountLoginSessionRow = typeof accountLoginSessions.$inferSelect;
export type NewAccountLoginSessionRow = typeof accountLoginSessions.$inferInsert;
