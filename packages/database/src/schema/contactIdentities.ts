import type {
  ContactIdentityKind,
  ContactIdentitySource,
  ContactIdentityState,
} from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { accounts } from './accounts.js';
import { contacts } from './contacts.js';

export const contactIdentities = sqliteTable(
  'contact_identities',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'no action' }),
    kind: text('kind').$type<ContactIdentityKind>().notNull(),
    value: text('value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    source: text('source').$type<ContactIdentitySource>().notNull(),
    state: text('state').$type<ContactIdentityState>().notNull().default('ACTIVE'),
    isPreferred: integer('is_preferred', { mode: 'boolean' }).notNull().default(false),
    firstObservedAt: integer('first_observed_at', { mode: 'timestamp_ms' }).notNull(),
    lastObservedAt: integer('last_observed_at', { mode: 'timestamp_ms' }).notNull(),
    supersededAt: integer('superseded_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'contact_identities_kind_check',
      sql`${table.kind} in ('SEC_UID', 'UNIQUE_ID', 'SHORT_ID', 'REMARK_NAME', 'DISPLAY_NAME', 'CONVERSATION_ID')`,
    ),
    check(
      'contact_identities_source_check',
      sql`${table.source} in ('DOM', 'PAGE_DATA', 'RESPONSE_PARSER', 'LEGACY_MANUAL', 'HUMAN_REBIND')`,
    ),
    check('contact_identities_state_check', sql`${table.state} in ('ACTIVE', 'SUPERSEDED')`),
    check('contact_identities_value_not_empty_check', sql`length(trim(${table.value})) > 0`),
    check(
      'contact_identities_normalized_value_not_empty_check',
      sql`length(trim(${table.normalizedValue})) > 0`,
    ),
    check(
      'contact_identities_observation_timeline_check',
      sql`${table.firstObservedAt} <= ${table.lastObservedAt}`,
    ),
    check(
      'contact_identities_superseded_consistency_check',
      sql`(${table.state} = 'ACTIVE' and ${table.supersededAt} is null) or (${table.state} = 'SUPERSEDED' and ${table.supersededAt} is not null)`,
    ),
    check(
      'contact_identities_preferred_active_check',
      sql`${table.isPreferred} = 0 or (${table.isPreferred} = 1 and ${table.state} = 'ACTIVE')`,
    ),
    uniqueIndex('contact_identities_preferred_active_idx')
      .on(table.contactId)
      .where(sql`${table.isPreferred} = 1 and ${table.state} = 'ACTIVE'`),
    uniqueIndex('contact_identities_stable_active_idx')
      .on(table.accountId, table.kind, table.normalizedValue)
      .where(
        sql`${table.state} = 'ACTIVE' and ${table.kind} in ('SEC_UID', 'UNIQUE_ID', 'SHORT_ID', 'CONVERSATION_ID')`,
      ),
    index('contact_identities_contact_state_idx').on(table.contactId, table.state),
    index('contact_identities_account_kind_normalized_idx').on(
      table.accountId,
      table.kind,
      table.normalizedValue,
    ),
    index('contact_identities_contact_last_observed_idx').on(table.contactId, table.lastObservedAt),
  ],
);

export type ContactIdentityRow = typeof contactIdentities.$inferSelect;
export type NewContactIdentityRow = typeof contactIdentities.$inferInsert;
