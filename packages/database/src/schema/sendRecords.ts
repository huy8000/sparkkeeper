import type { BusinessDate, RetryFailureCode, SendRecordStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { dailyRuns } from './dailyRuns.js';
import { friends } from './friends.js';
import { messageTemplates } from './messageTemplates.js';

export const SEND_RECORD_STATUSES = [
  'READY',
  'RUNNING',
  'RETRY_WAIT',
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
    attemptCount: integer('attempt_count').notNull().default(0),
    nextRetryAt: integer('next_retry_at', { mode: 'timestamp_ms' }),
    lastErrorCode: text('last_error_code').$type<RetryFailureCode>(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    sendActionStartedAt: integer('send_action_started_at', { mode: 'timestamp_ms' }),
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
      sql`${table.status} in ('READY', 'RUNNING', 'RETRY_WAIT', 'SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN')`,
    ),
    check('send_records_attempt_count_check', sql`${table.attemptCount} between 0 and 5`),
    check(
      'send_records_retry_wait_check',
      sql`(${table.status} = 'RETRY_WAIT' and ${table.nextRetryAt} is not null and ${table.finishedAt} is null) or (${table.status} <> 'RETRY_WAIT' and ${table.nextRetryAt} is null)`,
    ),
    check(
      'send_records_last_error_code_check',
      sql`${table.lastErrorCode} is null or ${table.lastErrorCode} in ('NETWORK_TRANSIENT', 'PAGE_LOAD_TIMEOUT', 'CONTACT_LIST_NOT_READY', 'BROWSER_TRANSIENT', 'CONTACT_NOT_FOUND', 'AMBIGUOUS_CONTACT', 'SELECTOR_FAILURE', 'CONVERSATION_VERIFICATION_FAILED', 'MESSAGE_INPUT_FAILED', 'SEND_ACTION_FAILED', 'VERIFY_FAILED', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'TEMPLATE_INVALID', 'CONFIG_INVALID', 'PROCESS_INTERRUPTED_BEFORE_SEND', 'RETRY_WINDOW_EXPIRED', 'MAX_ATTEMPTS_EXHAUSTED', 'DELIVERY_UNKNOWN')`,
    ),
  ],
);

export type SendRecordRow = typeof sendRecords.$inferSelect;
export type NewSendRecordRow = typeof sendRecords.$inferInsert;
