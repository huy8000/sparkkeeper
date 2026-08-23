import type { BusinessDate, SendRecordStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { dailyRuns } from './dailyRuns.js';
import { friends } from './friends.js';
import { messageTemplates } from './messageTemplates.js';

export const SEND_RECORD_STATUSES = [
  'READY',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'DELIVERY_UNKNOWN',
] as const satisfies readonly SendRecordStatus[];

export const sendRecords = sqliteTable(
  'send_records',
  {
    id: text('id').primaryKey(),
    dailyRunId: text('daily_run_id')
      .notNull()
      .references(() => dailyRuns.id, { onDelete: 'cascade' }),
    friendId: text('friend_id')
      .notNull()
      .references(() => friends.id, { onDelete: 'no action' }),
    businessDate: text('business_date').$type<BusinessDate>().notNull(),
    messageTemplateId: text('message_template_id').references(() => messageTemplates.id, {
      onDelete: 'set null',
    }),
    messageText: text('message_text').notNull(),
    status: text('status').$type<SendRecordStatus>().notNull().default('READY'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('send_records_friend_business_date_unique').on(table.friendId, table.businessDate),
    uniqueIndex('send_records_daily_run_friend_unique').on(table.dailyRunId, table.friendId),
    check(
      'send_records_business_date_check',
      sql`strftime('%Y-%m-%d', ${table.businessDate}) = ${table.businessDate}`,
    ),
    check('send_records_message_text_not_empty_check', sql`length(trim(${table.messageText})) > 0`),
    check(
      'send_records_status_check',
      sql`${table.status} in ('READY', 'RUNNING', 'SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN')`,
    ),
  ],
);

export type SendRecordRow = typeof sendRecords.$inferSelect;
export type NewSendRecordRow = typeof sendRecords.$inferInsert;
