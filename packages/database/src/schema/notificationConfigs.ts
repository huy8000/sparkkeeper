import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const notificationConfigs = sqliteTable(
  'notification_configs',
  {
    id: integer('id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    provider: text('provider').$type<'WEBHOOK'>().notNull().default('WEBHOOK'),
    webhookUrl: text('webhook_url'),
    notifyAuthExpired: integer('notify_auth_expired', { mode: 'boolean' }).notNull().default(true),
    notifyTaskFailed: integer('notify_task_failed', { mode: 'boolean' }).notNull().default(true),
    notifyConsecutiveFailure: integer('notify_consecutive_failure', { mode: 'boolean' })
      .notNull()
      .default(true),
    notifyDeliveryUnknown: integer('notify_delivery_unknown', { mode: 'boolean' })
      .notNull()
      .default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('notification_configs_singleton_check', sql`${table.id} = 1`),
    check('notification_configs_provider_check', sql`${table.provider} = 'WEBHOOK'`),
    check(
      'notification_configs_webhook_url_check',
      sql`${table.webhookUrl} is null or length(trim(${table.webhookUrl})) > 0`,
    ),
  ],
);

export type NotificationConfigRow = typeof notificationConfigs.$inferSelect;
export type NewNotificationConfigRow = typeof notificationConfigs.$inferInsert;
