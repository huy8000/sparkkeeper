import type {
  ContactAvailabilityStatus,
  ContactIdentityStatus,
  ContactType,
} from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { avatarAssets } from './avatarAssets.js';
import { contactSyncRuns } from './contactSyncRuns.js';

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    type: text('type').$type<ContactType>().notNull(),
    displayName: text('display_name').notNull(),
    remarkName: text('remark_name'),
    avatarRemoteUrl: text('avatar_remote_url'),
    avatarAssetId: text('avatar_asset_id').references(() => avatarAssets.id, {
      onDelete: 'set null',
    }),
    streakDays: integer('streak_days'),
    streakUpdatedAt: integer('streak_updated_at', { mode: 'timestamp_ms' }),
    availabilityStatus: text('availability_status')
      .$type<ContactAvailabilityStatus>()
      .notNull()
      .default('AVAILABLE'),
    identityStatus: text('identity_status')
      .$type<ContactIdentityStatus>()
      .notNull()
      .default('UNAVAILABLE'),
    discoveredAt: integer('discovered_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastFullSyncId: text('last_full_sync_id').references(() => contactSyncRuns.id, {
      onDelete: 'set null',
    }),
    missedFullSyncCount: integer('missed_full_sync_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check('contacts_type_check', sql`${table.type} in ('PERSON', 'GROUP', 'SYSTEM', 'UNKNOWN')`),
    check(
      'contacts_availability_status_check',
      sql`${table.availabilityStatus} in ('AVAILABLE', 'STALE', 'UNAVAILABLE')`,
    ),
    check(
      'contacts_identity_status_check',
      sql`${table.identityStatus} in ('READY', 'UNAVAILABLE', 'CHANGED', 'AMBIGUOUS', 'LEGACY_UNBOUND')`,
    ),
    check('contacts_display_name_not_empty_check', sql`length(trim(${table.displayName})) > 0`),
    check(
      'contacts_remark_name_check',
      sql`${table.remarkName} is null or length(trim(${table.remarkName})) > 0`,
    ),
    check(
      'contacts_avatar_remote_url_check',
      sql`${table.avatarRemoteUrl} is null or length(trim(${table.avatarRemoteUrl})) > 0`,
    ),
    check(
      'contacts_streak_days_check',
      sql`${table.streakDays} is null or ${table.streakDays} >= 0`,
    ),
    check(
      'contacts_streak_consistency_check',
      sql`(${table.streakDays} is null and ${table.streakUpdatedAt} is null) or (${table.streakDays} is not null and ${table.streakUpdatedAt} is not null)`,
    ),
    check('contacts_missed_full_sync_count_check', sql`${table.missedFullSyncCount} >= 0`),
    check('contacts_timeline_check', sql`${table.lastSeenAt} >= ${table.discoveredAt}`),
    index('contacts_account_type_availability_idx').on(
      table.accountId,
      table.type,
      table.availabilityStatus,
    ),
    index('contacts_account_display_name_idx').on(table.accountId, table.displayName),
  ],
);

export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;
