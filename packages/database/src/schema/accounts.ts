import type { AccountLifecycleStatus, AccountProfileState, LoginStatus } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    avatarRemoteUrl: text('avatar_remote_url'),
    avatarCacheKey: text('avatar_cache_key'),
    douyinUniqueId: text('douyin_unique_id'),
    douyinShortId: text('douyin_short_id'),
    douyinSecUid: text('douyin_sec_uid'),
    profileState: text('profile_state')
      .$type<AccountProfileState>()
      .notNull()
      .default('MIGRATION_REQUIRED'),
    lifecycleStatus: text('lifecycle_status')
      .$type<AccountLifecycleStatus>()
      .notNull()
      .default('ACTIVE'),
    lastAuthCheckAt: integer('last_auth_check_at', { mode: 'timestamp_ms' }),
    lastContactSyncAt: integer('last_contact_sync_at', { mode: 'timestamp_ms' }),
    unboundAt: integer('unbound_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    check(
      'accounts_login_status_check',
      sql`${table.loginStatus} in ('READY', 'AUTH_EXPIRED', 'UNKNOWN')`,
    ),
    check('accounts_name_not_empty_check', sql`length(trim(${table.name})) > 0`),
    check(
      'accounts_profile_state_check',
      sql`${table.profileState} in ('PROVISIONING', 'READY', 'MIGRATION_REQUIRED', 'MISSING', 'QUARANTINED')`,
    ),
    check(
      'accounts_lifecycle_status_check',
      sql`${table.lifecycleStatus} in ('ACTIVE', 'UNBOUND')`,
    ),
    check(
      'accounts_avatar_remote_url_check',
      sql`${table.avatarRemoteUrl} is null or length(trim(${table.avatarRemoteUrl}, ' ' || char(9) || char(10) || char(13))) > 0`,
    ),
    check(
      'accounts_avatar_cache_key_check',
      sql`${table.avatarCacheKey} is null or length(trim(${table.avatarCacheKey}, ' ' || char(9) || char(10) || char(13))) > 0`,
    ),
    check(
      'accounts_douyin_unique_id_check',
      sql`${table.douyinUniqueId} is null or length(trim(${table.douyinUniqueId}, ' ' || char(9) || char(10) || char(13))) > 0`,
    ),
    check(
      'accounts_douyin_short_id_check',
      sql`${table.douyinShortId} is null or length(trim(${table.douyinShortId}, ' ' || char(9) || char(10) || char(13))) > 0`,
    ),
    check(
      'accounts_douyin_sec_uid_check',
      sql`${table.douyinSecUid} is null or length(trim(${table.douyinSecUid}, ' ' || char(9) || char(10) || char(13))) > 0`,
    ),
    uniqueIndex('accounts_douyin_sec_uid_unique_idx')
      .on(table.douyinSecUid)
      .where(sql`${table.douyinSecUid} is not null`),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccountRow = typeof accounts.$inferInsert;
