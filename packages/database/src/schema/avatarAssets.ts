import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';

export const avatarAssets = sqliteTable(
  'avatar_assets',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    cacheKey: text('cache_key').notNull().unique(),
    mediaType: text('media_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    contentDigest: text('content_digest').notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
    lastReferencedAt: integer('last_referenced_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('avatar_assets_cache_key_not_empty_check', sql`length(trim(${table.cacheKey})) > 0`),
    check(
      'avatar_assets_content_digest_not_empty_check',
      sql`length(trim(${table.contentDigest})) > 0`,
    ),
    check(
      'avatar_assets_media_type_check',
      sql`${table.mediaType} in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')`,
    ),
    check(
      'avatar_assets_byte_size_check',
      sql`${table.byteSize} >= 1 and ${table.byteSize} <= 5242880`,
    ),
    index('avatar_assets_account_id_idx').on(table.accountId),
    index('avatar_assets_expires_at_idx').on(table.expiresAt),
  ],
);

export type AvatarAssetRow = typeof avatarAssets.$inferSelect;
export type NewAvatarAssetRow = typeof avatarAssets.$inferInsert;
