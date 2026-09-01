import type { LegacyScheduleImportStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { adminUsers } from './adminUsers.js';
import { schedules } from './schedules.js';
import { sendTasks } from './sendTasks.js';

export const legacyScheduleImports = sqliteTable(
  'legacy_schedule_imports',
  {
    id: text('id').primaryKey(),
    scheduleId: text('schedule_id')
      .notNull()
      .unique()
      .references(() => schedules.id, { onDelete: 'no action' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    status: text('status').$type<LegacyScheduleImportStatus>().notNull().default('PENDING'),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    timezone: text('timezone').notNull(),
    maxAttempts: integer('max_attempts').notNull(),
    retryIntervalSeconds: integer('retry_interval_seconds').notNull(),
    legacyEnabledSnapshot: integer('legacy_enabled_snapshot', { mode: 'boolean' }).notNull(),
    convertedTaskId: text('converted_task_id').references(() => sendTasks.id, {
      onDelete: 'no action',
    }),
    convertedByAdminUserId: text('converted_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'no action',
    }),
    convertedAt: integer('converted_at', { mode: 'timestamp_ms' }),
    dismissedAt: integer('dismissed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'legacy_schedule_imports_status_check',
      sql`${table.status} in ('PENDING', 'CONVERTED', 'DISMISSED')`,
    ),
    check(
      'legacy_schedule_imports_timezone_not_empty_check',
      sql`length(trim(${table.timezone})) > 0`,
    ),
    check(
      'legacy_schedule_imports_max_attempts_check',
      sql`${table.maxAttempts} >= 1 and ${table.maxAttempts} <= 5`,
    ),
    check(
      'legacy_schedule_imports_retry_interval_seconds_check',
      sql`${table.retryIntervalSeconds} >= 1 and ${table.retryIntervalSeconds} <= 86400`,
    ),
    check(
      'legacy_schedule_imports_status_fields_check',
      sql`(${table.status} = 'PENDING' and ${table.convertedTaskId} is null and ${table.convertedByAdminUserId} is null and ${table.convertedAt} is null and ${table.dismissedAt} is null) or (${table.status} = 'CONVERTED' and ${table.convertedTaskId} is not null and ${table.convertedByAdminUserId} is not null and ${table.convertedAt} is not null and ${table.dismissedAt} is null) or (${table.status} = 'DISMISSED' and ${table.convertedTaskId} is null and ${table.convertedByAdminUserId} is null and ${table.convertedAt} is null and ${table.dismissedAt} is not null)`,
    ),
    index('legacy_schedule_imports_account_id_idx').on(table.accountId),
    index('legacy_schedule_imports_converted_task_id_idx').on(table.convertedTaskId),
    index('legacy_schedule_imports_status_idx').on(table.status),
  ],
);

export type LegacyScheduleImportRow = typeof legacyScheduleImports.$inferSelect;
export type NewLegacyScheduleImportRow = typeof legacyScheduleImports.$inferInsert;
