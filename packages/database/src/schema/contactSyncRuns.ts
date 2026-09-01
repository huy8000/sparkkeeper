import type { ContactSyncFailureCode, ContactSyncRunStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { adminUsers } from './adminUsers.js';

export const contactSyncRuns = sqliteTable(
  'contact_sync_runs',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    requestedByAdminUserId: text('requested_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'no action' }),
    status: text('status').$type<ContactSyncRunStatus>().notNull().default('PENDING'),
    isComplete: integer('is_complete', { mode: 'boolean' }).notNull().default(false),
    candidateCount: integer('candidate_count').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    staleCount: integer('stale_count').notNull().default(0),
    unavailableCount: integer('unavailable_count').notNull().default(0),
    issueCount: integer('issue_count').notNull().default(0),
    failureCode: text('failure_code').$type<ContactSyncFailureCode>(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'contact_sync_runs_status_check',
      sql`${table.status} in ('PENDING', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED', 'AUTH_EXPIRED')`,
    ),
    check(
      'contact_sync_runs_failure_code_check',
      sql`${table.failureCode} is null or ${table.failureCode} in ('PROFILE_UNAVAILABLE', 'PROFILE_BUSY', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'CHAT_NOT_READY', 'DISCOVERY_TIMEOUT', 'CANDIDATE_LIMIT_REACHED', 'PARSER_CONTRACT_FAILURE', 'BROWSER_FAILURE', 'PERSISTENCE_FAILURE')`,
    ),
    check(
      'contact_sync_runs_candidate_count_check',
      sql`${table.candidateCount} >= 0 and ${table.candidateCount} <= 500`,
    ),
    check(
      'contact_sync_runs_created_count_check',
      sql`${table.createdCount} >= 0 and ${table.createdCount} <= 500`,
    ),
    check(
      'contact_sync_runs_updated_count_check',
      sql`${table.updatedCount} >= 0 and ${table.updatedCount} <= 500`,
    ),
    check(
      'contact_sync_runs_stale_count_check',
      sql`${table.staleCount} >= 0 and ${table.staleCount} <= 500`,
    ),
    check(
      'contact_sync_runs_unavailable_count_check',
      sql`${table.unavailableCount} >= 0 and ${table.unavailableCount} <= 500`,
    ),
    check(
      'contact_sync_runs_issue_count_check',
      sql`${table.issueCount} >= 0 and ${table.issueCount} <= 500`,
    ),
    check(
      'contact_sync_runs_completion_check',
      sql`(${table.status} = 'COMPLETE' and ${table.isComplete} = 1 and ${table.failureCode} is null) or (${table.status} in ('PARTIAL', 'FAILED', 'AUTH_EXPIRED') and ${table.isComplete} = 0 and ${table.failureCode} is not null) or (${table.status} in ('PENDING', 'RUNNING') and ${table.isComplete} = 0 and ${table.failureCode} is null)`,
    ),
    check(
      'contact_sync_runs_terminal_finished_check',
      sql`(${table.status} in ('COMPLETE', 'PARTIAL', 'FAILED', 'AUTH_EXPIRED') and ${table.finishedAt} is not null) or (${table.status} in ('PENDING', 'RUNNING') and ${table.finishedAt} is null)`,
    ),
    index('contact_sync_runs_account_created_idx').on(table.accountId, table.createdAt),
    index('contact_sync_runs_status_idx').on(table.status),
  ],
);

export type ContactSyncRunRow = typeof contactSyncRuns.$inferSelect;
export type NewContactSyncRunRow = typeof contactSyncRuns.$inferInsert;
