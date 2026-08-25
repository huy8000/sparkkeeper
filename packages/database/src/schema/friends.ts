import type { FriendMatchField } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';

export const friends = sqliteTable(
  'friends',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    remarkName: text('remark_name'),
    shortId: text('short_id'),
    uniqueId: text('unique_id'),
    secUid: text('sec_uid'),
    matchField: text('match_field').$type<FriendMatchField>().notNull(),
    matchKey: text('match_key').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('friends_account_id_idx').on(table.accountId),
    check('friends_display_name_not_empty_check', sql`length(trim(${table.displayName})) > 0`),
    check('friends_match_key_not_empty_check', sql`length(${table.matchKey}) > 0`),
    check(
      'friends_match_field_check',
      sql`${table.matchField} in ('displayName', 'remarkName', 'shortId', 'uniqueId', 'secUid')`,
    ),
    check(
      'friends_match_consistency_check',
      sql`case ${table.matchField}
        when 'displayName' then ${table.matchKey} = trim(${table.displayName})
        when 'remarkName' then ${table.remarkName} is not null and ${table.matchKey} = trim(${table.remarkName})
        when 'shortId' then ${table.shortId} is not null and ${table.matchKey} = trim(${table.shortId})
        when 'uniqueId' then ${table.uniqueId} is not null and ${table.matchKey} = trim(${table.uniqueId})
        when 'secUid' then ${table.secUid} is not null and ${table.matchKey} = trim(${table.secUid})
        else 0
      end`,
    ),
  ],
);

export type FriendRow = typeof friends.$inferSelect;
export type NewFriendRow = typeof friends.$inferInsert;
