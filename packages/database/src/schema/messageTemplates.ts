import type { MessageProviderType } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const messageTemplates = sqliteTable(
  'message_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    providerType: text('provider_type').$type<MessageProviderType>().notNull(),
    content: text('content').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('message_templates_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check(
      'message_templates_provider_type_check',
      sql`${table.providerType} in ('STATIC', 'RANDOM')`,
    ),
  ],
);

export type MessageTemplateRow = typeof messageTemplates.$inferSelect;
export type NewMessageTemplateRow = typeof messageTemplates.$inferInsert;
