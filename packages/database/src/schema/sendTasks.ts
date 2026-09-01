import type { SendTaskScheduleType } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { messageTemplates } from './messageTemplates.js';

export const sendTasks = sqliteTable(
  'send_tasks',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    templateId: text('template_id')
      .notNull()
      .references(() => messageTemplates.id, { onDelete: 'no action' }),
    scheduleType: text('schedule_type')
      .$type<SendTaskScheduleType>()
      .notNull()
      .default('DAILY_WINDOW'),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    timezone: text('timezone').notNull(),
    maxAttempts: integer('max_attempts').notNull().default(3),
    retryIntervalSeconds: integer('retry_interval_seconds').notNull().default(60),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('send_tasks_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check('send_tasks_timezone_not_empty_check', sql`length(trim(${table.timezone})) > 0`),
    check('send_tasks_schedule_type_check', sql`${table.scheduleType} in ('DAILY_WINDOW')`),
    check(
      'send_tasks_max_attempts_check',
      sql`${table.maxAttempts} >= 1 and ${table.maxAttempts} <= 5`,
    ),
    check(
      'send_tasks_retry_interval_seconds_check',
      sql`${table.retryIntervalSeconds} >= 1 and ${table.retryIntervalSeconds} <= 86400`,
    ),
    check(
      'send_tasks_archived_enabled_check',
      sql`${table.archivedAt} is null or ${table.enabled} = 0`,
    ),
    index('send_tasks_account_id_idx').on(table.accountId),
    index('send_tasks_enabled_idx').on(table.enabled),
    index('send_tasks_template_id_idx').on(table.templateId),
  ],
);

export type SendTaskRow = typeof sendTasks.$inferSelect;
export type NewSendTaskRow = typeof sendTasks.$inferInsert;
