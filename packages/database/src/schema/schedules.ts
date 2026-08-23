import type { ScheduleTime } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';

export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    startTime: text('start_time').$type<ScheduleTime>().notNull(),
    endTime: text('end_time').$type<ScheduleTime>().notNull(),
    timezone: text('timezone').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('schedules_account_id_unique').on(table.accountId),
    index('schedules_enabled_idx').on(table.enabled),
    check(
      'schedules_start_time_check',
      sql`${table.startTime} glob '[0-2][0-9]:[0-5][0-9]' and cast(substr(${table.startTime}, 1, 2) as integer) between 0 and 23`,
    ),
    check(
      'schedules_end_time_check',
      sql`${table.endTime} glob '[0-2][0-9]:[0-5][0-9]' and cast(substr(${table.endTime}, 1, 2) as integer) between 0 and 23`,
    ),
    check('schedules_window_check', sql`${table.startTime} < ${table.endTime}`),
    check('schedules_timezone_not_empty_check', sql`length(trim(${table.timezone})) > 0`),
  ],
);

export type ScheduleRow = typeof schedules.$inferSelect;
export type NewScheduleRow = typeof schedules.$inferInsert;
