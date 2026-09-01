import type {
  ContactIdentityKind,
  TargetSendFailureCode,
  TargetSendMachineStatus,
} from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { contacts } from './contacts.js';
import { executionRuns } from './executionRuns.js';
import { messageTemplates } from './messageTemplates.js';
import { sendTasks } from './sendTasks.js';

export const targetSendRecords = sqliteTable(
  'target_send_records',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => executionRuns.id, { onDelete: 'no action' }),
    taskId: text('task_id').references(() => sendTasks.id, { onDelete: 'no action' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'no action' }),
    businessDate: text('business_date'),
    templateId: text('template_id').references(() => messageTemplates.id, {
      onDelete: 'set null',
    }),
    messageText: text('message_text').notNull(),
    machineStatus: text('machine_status')
      .$type<TargetSendMachineStatus>()
      .notNull()
      .default('READY'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextRetryAt: integer('next_retry_at', { mode: 'timestamp_ms' }),
    failureCode: text('failure_code').$type<TargetSendFailureCode>(),
    targetIdentityKindSnapshot: text('target_identity_kind_snapshot')
      .$type<ContactIdentityKind>()
      .notNull(),
    targetIdentityValueDigest: text('target_identity_value_digest').notNull(),
    sendActionStartedAt: integer('send_action_started_at', { mode: 'timestamp_ms' }),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'target_send_records_message_text_not_empty_check',
      sql`length(trim(${table.messageText})) > 0`,
    ),
    check(
      'target_send_records_digest_not_empty_check',
      sql`length(trim(${table.targetIdentityValueDigest})) > 0`,
    ),
    check(
      'target_send_records_identity_kind_check',
      sql`${table.targetIdentityKindSnapshot} in ('SEC_UID', 'UNIQUE_ID', 'SHORT_ID', 'REMARK_NAME', 'DISPLAY_NAME', 'CONVERSATION_ID')`,
    ),
    check(
      'target_send_records_machine_status_check',
      sql`${table.machineStatus} in ('READY', 'RUNNING', 'RETRY_WAIT', 'SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN', 'SKIPPED')`,
    ),
    check(
      'target_send_records_attempt_count_check',
      sql`${table.attemptCount} >= 0 and ${table.attemptCount} <= 5`,
    ),
    check(
      'target_send_records_failure_code_check',
      sql`${table.failureCode} is null or ${table.failureCode} in ('NAVIGATION_FAILED', 'PAGE_LOAD_TIMEOUT', 'CONTACT_LIST_NOT_READY', 'TARGET_NOT_FOUND', 'TARGET_AMBIGUOUS', 'TARGET_IDENTITY_UNAVAILABLE', 'IDENTITY_CHANGED', 'CONVERSATION_VERIFICATION_FAILED', 'COMPOSER_NOT_READY', 'MESSAGE_INPUT_FAILED', 'SEND_ACTION_NOT_TRIGGERED', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'CAPTCHA_OR_RISK_CONTROL', 'BROWSER_FAILURE', 'PROFILE_UNAVAILABLE', 'TEMPLATE_INVALID', 'CONFIG_INVALID', 'PROCESS_INTERRUPTED_BEFORE_SEND', 'RETRY_WINDOW_EXPIRED', 'MAX_ATTEMPTS_EXHAUSTED', 'BATCH_ABORTED', 'DELIVERY_VERIFICATION_TIMEOUT', 'DELIVERY_EVIDENCE_INSUFFICIENT', 'PAGE_CLOSED_AFTER_ACTION', 'NAVIGATION_AFTER_ACTION', 'AUTH_STATE_CHANGED_AFTER_ACTION', 'PROCESS_INTERRUPTED_AFTER_ACTION')`,
    ),
    check(
      'target_send_records_scheduled_tuple_check',
      sql`(${table.taskId} is null and ${table.businessDate} is null) or (${table.taskId} is not null and ${table.businessDate} is not null)`,
    ),
    check(
      'target_send_records_retry_wait_check',
      sql`(${table.machineStatus} = 'RETRY_WAIT' and ${table.nextRetryAt} is not null) or (${table.machineStatus} != 'RETRY_WAIT' and ${table.nextRetryAt} is null)`,
    ),
    check(
      'target_send_records_failure_code_presence_check',
      sql`(${table.machineStatus} in ('READY', 'RUNNING', 'SUCCESS') and ${table.failureCode} is null) or (${table.machineStatus} in ('RETRY_WAIT', 'FAILED', 'DELIVERY_UNKNOWN', 'SKIPPED') and ${table.failureCode} is not null)`,
    ),
    check(
      'target_send_records_success_check',
      sql`${table.machineStatus} != 'SUCCESS' or (${table.sendActionStartedAt} is not null and ${table.sentAt} is not null)`,
    ),
    check(
      'target_send_records_delivery_unknown_check',
      sql`${table.machineStatus} != 'DELIVERY_UNKNOWN' or (${table.sendActionStartedAt} is not null and ${table.failureCode} in ('DELIVERY_VERIFICATION_TIMEOUT', 'DELIVERY_EVIDENCE_INSUFFICIENT', 'PAGE_CLOSED_AFTER_ACTION', 'NAVIGATION_AFTER_ACTION', 'AUTH_STATE_CHANGED_AFTER_ACTION', 'PROCESS_INTERRUPTED_AFTER_ACTION'))`,
    ),
    check(
      'target_send_records_failed_skipped_check',
      sql`${table.machineStatus} not in ('FAILED', 'SKIPPED') or ${table.sentAt} is null`,
    ),
    check(
      'target_send_records_finished_check',
      sql`(${table.machineStatus} in ('SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN', 'SKIPPED') and ${table.finishedAt} is not null) or (${table.machineStatus} in ('READY', 'RUNNING', 'RETRY_WAIT') and ${table.finishedAt} is null)`,
    ),
    uniqueIndex('target_send_records_run_contact_unique_idx').on(table.runId, table.contactId),
    uniqueIndex('target_send_records_task_contact_date_unique_idx')
      .on(table.taskId, table.contactId, table.businessDate)
      .where(sql`${table.taskId} is not null and ${table.businessDate} is not null`),
    index('target_send_records_contact_created_idx').on(table.contactId, table.createdAt),
    index('target_send_records_status_idx').on(table.machineStatus),
  ],
);

export type TargetSendRecordRow = typeof targetSendRecords.$inferSelect;
export type NewTargetSendRecordRow = typeof targetSendRecords.$inferInsert;
