import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { contacts } from './contacts.js';
import { sendTasks } from './sendTasks.js';

export const sendTaskTargets = sqliteTable(
  'send_task_targets',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => sendTasks.id, { onDelete: 'no action' }),
    contactId: text('contact_id')
      .notNull()
      .references(() => contacts.id, { onDelete: 'no action' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.contactId] }),
    index('send_task_targets_contact_id_idx').on(table.contactId),
  ],
);

export type SendTaskTargetRow = typeof sendTaskTargets.$inferSelect;
export type NewSendTaskTargetRow = typeof sendTaskTargets.$inferInsert;
