import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, check, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts.js';
import { adminUsers } from './adminUsers.js';
import { contacts } from './contacts.js';
import { messageTemplates } from './messageTemplates.js';
import { executionRuns } from './executionRuns.js';

export const testSendIntents = sqliteTable(
  'test_send_intents',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    adminId: text('admin_id')
      .notNull()
      .references(() => adminUsers.id),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id),
    templateId: text('template_id')
      .notNull()
      .references(() => messageTemplates.id),
    previewKeyDigest: text('preview_key_digest').notNull(),
    fingerprint: text('fingerprint').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    summary: text('summary').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    consumedRunId: text('consumed_run_id').references(() => executionRuns.id),
    activeSlot: integer('active_slot'),
  },
  (t) => [
    uniqueIndex('test_send_intents_preview_key_idx').on(t.previewKeyDigest),
    uniqueIndex('test_send_intents_consumed_run_idx').on(t.consumedRunId),
    uniqueIndex('test_send_intents_active_idx').on(t.activeSlot),
    check(
      'test_send_intents_active_check',
      sql`${t.activeSlot} is null or (${t.activeSlot} = 1 and ${t.consumedRunId} is not null)`,
    ),
    index('test_send_intents_admin_expiry_idx').on(t.adminId, t.expiresAt),
    check('test_send_intents_ttl_check', sql`${t.expiresAt} = ${t.createdAt} + 600000`),
    check(
      'test_send_intents_digest_check',
      sql`length(${t.fingerprint}) = 64 and length(${t.payloadDigest}) = 64 and length(${t.previewKeyDigest}) = 64`,
    ),
  ],
);
export type TestSendIntent = typeof testSendIntents.$inferSelect;
