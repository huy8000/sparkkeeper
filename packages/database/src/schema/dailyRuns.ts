import type { BusinessDate, DailyRunStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';

export const DAILY_RUN_STATUSES = [
  'READY',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'AUTH_EXPIRED',
] as const satisfies readonly DailyRunStatus[];

export const dailyRuns = sqliteTable(
  'daily_runs',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    businessDate: text('business_date').$type<BusinessDate>().notNull(),
    status: text('status').$type<DailyRunStatus>().notNull().default('READY'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('daily_runs_account_business_date_unique').on(table.accountId, table.businessDate),
    check(
      'daily_runs_business_date_check',
      sql`strftime('%Y-%m-%d', ${table.businessDate}) = ${table.businessDate}`,
    ),
    check(
      'daily_runs_status_check',
      sql`${table.status} in ('READY', 'RUNNING', 'SUCCESS', 'FAILED', 'AUTH_EXPIRED')`,
    ),
  ],
);

export type DailyRunRow = typeof dailyRuns.$inferSelect;
export type NewDailyRunRow = typeof dailyRuns.$inferInsert;
