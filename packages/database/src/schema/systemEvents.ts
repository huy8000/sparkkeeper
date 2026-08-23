import type { RuntimeEventType, SystemEventLevel } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { dailyRuns } from './dailyRuns.js';
import { friends } from './friends.js';

export const systemEvents = sqliteTable(
  'system_events',
  {
    id: text('id').primaryKey(),
    eventType: text('event_type').$type<RuntimeEventType>().notNull(),
    level: text('level').$type<SystemEventLevel>().notNull(),
    runId: text('run_id').references(() => dailyRuns.id, { onDelete: 'set null' }),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    friendId: text('friend_id').references(() => friends.id, { onDelete: 'set null' }),
    attempt: integer('attempt'),
    errorCode: text('error_code'),
    message: text('message').notNull(),
    screenshotPath: text('screenshot_path'),
    tracePath: text('trace_path'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('system_events_created_at_idx').on(table.createdAt),
    index('system_events_run_id_idx').on(table.runId),
    index('system_events_account_id_idx').on(table.accountId),
    check('system_events_level_check', sql`${table.level} in ('INFO', 'WARN', 'ERROR')`),
    check(
      'system_events_event_type_check',
      sql`${table.eventType} in ('RUN_STARTED', 'RUN_FINISHED', 'AUTH_CHECKING', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'FRIEND_RESOLVING', 'CONTACT_NOT_FOUND', 'AMBIGUOUS_CONTACT', 'MESSAGE_BUILDING', 'MESSAGE_SENDING', 'VERIFYING', 'VERIFY_SUCCESS', 'RETRY_WAIT', 'TASK_FAILED', 'SELECTOR_FAILURE', 'BROWSER_ERROR', 'DELIVERY_UNKNOWN', 'CONVERSATION_VERIFICATION_FAILED', 'SKIPPED_IDEMPOTENT', 'CONSECUTIVE_RUN_FAILURE', 'OBSERVABILITY_ERROR')`,
    ),
    check('system_events_attempt_check', sql`${table.attempt} is null or ${table.attempt} > 0`),
    check('system_events_message_not_empty_check', sql`length(trim(${table.message})) > 0`),
  ],
);

export type SystemEventRow = typeof systemEvents.$inferSelect;
export type NewSystemEventRow = typeof systemEvents.$inferInsert;
