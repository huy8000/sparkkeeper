import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { executionRuns } from './executionRuns.js';
import { sendTasks } from './sendTasks.js';

export const scheduledRunSnapshots = sqliteTable(
  'scheduled_run_snapshots',
  {
    runId: text('run_id')
      .primaryKey()
      .references(() => executionRuns.id),
    taskId: text('task_id')
      .notNull()
      .references(() => sendTasks.id),
    businessDate: text('business_date').notNull(),
    snapshot: text('snapshot').notNull(),
    activeSlot: integer('active_slot'),
    ownerToken: text('owner_token'),
  },
  (t) => [
    uniqueIndex('scheduled_snapshots_task_date_idx').on(t.taskId, t.businessDate),
    uniqueIndex('scheduled_snapshots_active_idx').on(t.activeSlot),
    check('scheduled_snapshots_active_check', sql`${t.activeSlot} is null or ${t.activeSlot}=1`),
  ],
);
