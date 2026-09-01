import type { DeliveryResolutionSource, DeliveryResolutionValue } from '@sparkkeeper/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { adminUsers } from './adminUsers.js';
import { sendRecords } from './sendRecords.js';
import { targetSendRecords } from './targetSendRecords.js';

export const deliveryResolutions = sqliteTable(
  'delivery_resolutions',
  {
    id: text('id').primaryKey(),
    targetSendRecordId: text('target_send_record_id').references(() => targetSendRecords.id, {
      onDelete: 'no action',
    }),
    legacySendRecordId: text('legacy_send_record_id').references(() => sendRecords.id, {
      onDelete: 'no action',
    }),
    originalMachineStatus: text('original_machine_status').notNull(),
    resolution: text('resolution').$type<DeliveryResolutionValue>().notNull(),
    source: text('source').$type<DeliveryResolutionSource>().notNull().default('HUMAN'),
    resolvedByAdminUserId: text('resolved_by_admin_user_id')
      .notNull()
      .references(() => adminUsers.id, { onDelete: 'no action' }),
    note: text('note'),
    supersedesResolutionId: text('supersedes_resolution_id')
      .references((): AnySQLiteColumn => deliveryResolutions.id, { onDelete: 'no action' })
      .unique(),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    check(
      'delivery_resolutions_source_record_check',
      sql`(${table.targetSendRecordId} is not null and ${table.legacySendRecordId} is null) or (${table.targetSendRecordId} is null and ${table.legacySendRecordId} is not null)`,
    ),
    check(
      'delivery_resolutions_original_status_check',
      sql`${table.originalMachineStatus} = 'DELIVERY_UNKNOWN'`,
    ),
    check(
      'delivery_resolutions_resolution_check',
      sql`${table.resolution} in ('CONFIRMED_DELIVERED', 'CONFIRMED_NOT_DELIVERED', 'INCONCLUSIVE')`,
    ),
    check('delivery_resolutions_source_check', sql`${table.source} in ('HUMAN')`),
    check(
      'delivery_resolutions_note_check',
      sql`${table.note} is null or (length(trim(${table.note})) > 0 and length(${table.note}) <= 500)`,
    ),
    index('delivery_resolutions_target_send_record_id_idx').on(table.targetSendRecordId),
    index('delivery_resolutions_legacy_send_record_id_idx').on(table.legacySendRecordId),
    index('delivery_resolutions_resolved_by_idx').on(table.resolvedByAdminUserId),
    index('delivery_resolutions_resolved_at_idx').on(table.resolvedAt),
  ],
);

export type DeliveryResolutionRow = typeof deliveryResolutions.$inferSelect;
export type NewDeliveryResolutionRow = typeof deliveryResolutions.$inferInsert;
