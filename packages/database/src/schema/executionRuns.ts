import type { ExecutionRunKind, ExecutionRunStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { adminUsers } from './adminUsers.js';
import { messageTemplates } from './messageTemplates.js';
import { sendTasks } from './sendTasks.js';

export const executionRuns = sqliteTable(
  'execution_runs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<ExecutionRunKind>().notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    taskId: text('task_id').references(() => sendTasks.id, { onDelete: 'no action' }),
    templateId: text('template_id')
      .notNull()
      .references(() => messageTemplates.id, { onDelete: 'no action' }),
    requestedByAdminUserId: text('requested_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'no action',
    }),
    businessDate: text('business_date'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').$type<ExecutionRunStatus>().notNull().default('PENDING'),
    confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('execution_runs_kind_check', sql`${table.kind} in ('TEST_SEND', 'SCHEDULED_TASK')`),
    check(
      'execution_runs_status_check',
      sql`${table.status} in ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED', 'DELIVERY_UNKNOWN', 'AUTH_EXPIRED', 'CANCELLED')`,
    ),
    check(
      'execution_runs_idempotency_key_not_empty_check',
      sql`length(trim(${table.idempotencyKey})) > 0`,
    ),
    check(
      'execution_runs_scheduled_check',
      sql`(${table.kind} = 'SCHEDULED_TASK' and ${table.taskId} is not null and ${table.businessDate} is not null and ${table.requestedByAdminUserId} is null and ${table.confirmedAt} is null) or (${table.kind} = 'TEST_SEND' and ${table.taskId} is null and ${table.businessDate} is null and ${table.requestedByAdminUserId} is not null and ${table.confirmedAt} is not null)`,
    ),
    check(
      'execution_runs_business_date_format_check',
      sql`${table.businessDate} is null or length(${table.businessDate}) = 10`,
    ),
    check(
      'execution_runs_terminal_finished_check',
      sql`(${table.status} in ('SUCCESS', 'PARTIAL_FAILED', 'FAILED', 'DELIVERY_UNKNOWN', 'AUTH_EXPIRED', 'CANCELLED') and ${table.finishedAt} is not null) or (${table.status} in ('PENDING', 'RUNNING') and ${table.finishedAt} is null)`,
    ),
    index('execution_runs_account_created_idx').on(table.accountId, table.createdAt),
    index('execution_runs_task_business_date_idx').on(table.taskId, table.businessDate),
    index('execution_runs_status_created_idx').on(table.status, table.createdAt),
  ],
);

export type ExecutionRunRow = typeof executionRuns.$inferSelect;
export type NewExecutionRunRow = typeof executionRuns.$inferInsert;
