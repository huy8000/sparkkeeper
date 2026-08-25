import type { LoginStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const LOGIN_STATUSES = [
  'READY',
  'AUTH_EXPIRED',
  'UNKNOWN',
] as const satisfies readonly LoginStatus[];

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    loginStatus: text('login_status').$type<LoginStatus>().notNull().default('UNKNOWN'),
    lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'accounts_login_status_check',
      sql`${table.loginStatus} in ('READY', 'AUTH_EXPIRED', 'UNKNOWN')`,
    ),
    check('accounts_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
