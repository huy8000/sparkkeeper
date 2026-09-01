import type { LegacyBindingStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { adminUsers } from './adminUsers.js';
import { contacts } from './contacts.js';
import { friends } from './friends.js';

export const legacyFriendBindings = sqliteTable(
  'legacy_friend_bindings',
  {
    id: text('id').primaryKey(),
    friendId: text('friend_id')
      .notNull()
      .unique()
      .references(() => friends.id, { onDelete: 'no action' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    contactId: text('contact_id').references(() => contacts.id, { onDelete: 'no action' }),
    status: text('status').$type<LegacyBindingStatus>().notNull().default('PENDING'),
    boundByAdminUserId: text('bound_by_admin_user_id').references(() => adminUsers.id, {
      onDelete: 'no action',
    }),
    boundAt: integer('bound_at', { mode: 'timestamp_ms' }),
    dismissedAt: integer('dismissed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'legacy_friend_bindings_status_check',
      sql`${table.status} in ('PENDING', 'BOUND', 'DISMISSED')`,
    ),
    check(
      'legacy_friend_bindings_status_fields_check',
      sql`(${table.status} = 'PENDING' and ${table.contactId} is null and ${table.boundByAdminUserId} is null and ${table.boundAt} is null and ${table.dismissedAt} is null) or (${table.status} = 'BOUND' and ${table.contactId} is not null and ${table.boundByAdminUserId} is not null and ${table.boundAt} is not null and ${table.dismissedAt} is null) or (${table.status} = 'DISMISSED' and ${table.contactId} is null and ${table.boundByAdminUserId} is null and ${table.boundAt} is null and ${table.dismissedAt} is not null)`,
    ),
    index('legacy_friend_bindings_account_id_idx').on(table.accountId),
    index('legacy_friend_bindings_contact_id_idx').on(table.contactId),
    index('legacy_friend_bindings_status_idx').on(table.status),
  ],
);

export type LegacyFriendBindingRow = typeof legacyFriendBindings.$inferSelect;
export type NewLegacyFriendBindingRow = typeof legacyFriendBindings.$inferInsert;
