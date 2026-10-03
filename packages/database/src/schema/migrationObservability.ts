import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { accounts } from './accounts.js';
import { executionRuns } from './executionRuns.js';
import { targetSendRecords } from './targetSendRecords.js';

export const legacyProfileBindings = sqliteTable(
  'legacy_profile_bindings',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .unique()
      .references(() => accounts.id, { onDelete: 'no action' }),
    sourceDevice: text('source_device').notNull(),
    sourceInode: text('source_inode').notNull(),
    status: text('status').$type<'PREPARED' | 'COMPLETED'>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check(
      'legacy_profile_bindings_state',
      sql`(${t.status} = 'PREPARED' and ${t.completedAt} is null) or (${t.status} = 'COMPLETED' and ${t.completedAt} is not null)`,
    ),
  ],
);

export const v4SystemEvents = sqliteTable(
  'v4_system_events',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => executionRuns.id, { onDelete: 'no action' }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'no action' }),
    recordId: text('record_id').references(() => targetSendRecords.id, { onDelete: 'no action' }),
    eventType: text('event_type')
      .$type<'RUN_STARTED' | 'RUN_FINISHED' | 'DELIVERY_UNKNOWN' | 'TASK_FAILED' | 'AUTH_EXPIRED'>()
      .notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    check(
      'v4_system_events_type',
      sql`${t.eventType} in ('RUN_STARTED','RUN_FINISHED','DELIVERY_UNKNOWN','TASK_FAILED','AUTH_EXPIRED')`,
    ),
    index('v4_system_events_run_sequence').on(t.runId, t.sequence),
  ],
);
