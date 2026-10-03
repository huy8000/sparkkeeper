import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  type ReadOnlyDatabaseClient,
} from '../client/DatabaseClient.js';

export const LEGACY_TABLE_COLUMNS = {
  accounts: ['id', 'name', 'enabled', 'login_status', 'last_login_at', 'created_at', 'updated_at'],
  friends: [
    'id',
    'account_id',
    'display_name',
    'unique_id',
    'short_id',
    'sec_uid',
    'remark_name',
    'match_field',
    'match_key',
    'enabled',
    'created_at',
    'updated_at',
  ],
  schedules: [
    'id',
    'account_id',
    'start_time',
    'end_time',
    'timezone',
    'enabled',
    'max_attempts',
    'retry_interval_seconds',
    'created_at',
    'updated_at',
  ],
  message_templates: [
    'id',
    'name',
    'provider_type',
    'content',
    'enabled',
    'created_at',
    'updated_at',
  ],
  daily_runs: [
    'id',
    'account_id',
    'business_date',
    'status',
    'started_at',
    'finished_at',
    'created_at',
    'updated_at',
  ],
  send_records: [
    'id',
    'daily_run_id',
    'friend_id',
    'business_date',
    'message_template_id',
    'message_text',
    'status',
    'attempt_count',
    'next_retry_at',
    'last_error_code',
    'sent_at',
    'send_action_started_at',
    'started_at',
    'finished_at',
    'created_at',
    'updated_at',
  ],
  system_events: [
    'id',
    'event_type',
    'level',
    'run_id',
    'account_id',
    'friend_id',
    'attempt',
    'error_code',
    'message',
    'screenshot_path',
    'trace_path',
    'created_at',
  ],
  notification_configs: [
    'id',
    'provider',
    'webhook_url',
    'enabled',
    'notify_auth_expired',
    'notify_task_failed',
    'notify_consecutive_failure',
    'notify_delivery_unknown',
    'created_at',
    'updated_at',
  ],
} as const;
export function inspectMigration(client: Pick<ReadOnlyDatabaseClient, 'orm' | 'inspect'>) {
  const inspection = client.inspect();
  const integrity = client.orm.all<Record<string, string>>(sql`PRAGMA integrity_check`);
  const foreignKeys = client.orm.all(sql`PRAGMA foreign_key_check`);
  const applied = client.orm.all<{ hash: string; created_at: number }>(
    sql`SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at`,
  );
  const expected = readMigrationFiles({ migrationsFolder: DEFAULT_MIGRATIONS_DIRECTORY });
  const journalValid =
    applied.length <= expected.length &&
    applied.every(
      (r, i) => r.hash === expected[i]?.hash && r.created_at === expected[i]?.folderMillis,
    );
  const legacy = Object.fromEntries(
    Object.entries(LEGACY_TABLE_COLUMNS).map(([table, columns]) => {
      const rows = client.orm.all(
        sql`SELECT ${sql.join(
          columns.map((c) => sql.identifier(c)),
          sql`, `,
        )} FROM ${sql.identifier(table)} ORDER BY id`,
      );
      return [
        table,
        {
          count: rows.length,
          digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
        },
      ];
    }),
  );
  const counts = Object.fromEntries(
    [
      'legacy_friend_bindings',
      'legacy_schedule_imports',
      'contacts',
      'send_tasks',
      'delivery_resolutions',
    ]
      .filter((t) => inspection.tables.includes(t))
      .map((t) => [
        t,
        client.orm.get<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(t)}`)!.n,
      ]),
  );
  const enabledTasks = inspection.tables.includes('send_tasks')
    ? client.orm.get<{ n: number }>(sql`SELECT count(*) AS n FROM send_tasks WHERE enabled=1`)!.n
    : 0;
  const activeQueries = [
    ['daily_runs', "status='RUNNING'"],
    [
      'account_login_sessions',
      "status IN ('PENDING','STARTING','AWAITING_USER','READY_DETECTED','COMPLETING')",
    ],
    ['contact_sync_runs', "status IN ('PENDING','RUNNING')"],
    ['execution_runs', "status IN ('PENDING','RUNNING')"],
    ['test_send_intents', 'active_slot=1'],
    ['scheduled_run_snapshots', 'active_slot=1'],
  ] as const;
  const activeRuntimeCount = activeQueries
    .filter(([table]) => inspection.tables.includes(table))
    .reduce(
      (n, [table, predicate]) =>
        n +
        client.orm.get<{ n: number }>(
          sql`SELECT count(*) AS n FROM ${sql.identifier(table)} WHERE ${sql.raw(predicate)}`,
        )!.n,
      0,
    );
  return {
    ok:
      journalValid &&
      foreignKeys.length === 0 &&
      integrity.length === 1 &&
      Object.values(integrity[0]!).every((v) => v === 'ok'),
    migrationCount: applied.length,
    expectedMigrationCount: expected.length,
    journalValid,
    integrityOk: integrity.length === 1 && Object.values(integrity[0]!).every((v) => v === 'ok'),
    foreignKeyViolationCount: foreignKeys.length,
    legacy,
    counts,
    enabledTasks,
    activeRuntimeCount,
  };
}
export function migrationInventoryDigest() {
  return createHash('sha256')
    .update(readFileSync(path.join(DEFAULT_MIGRATIONS_DIRECTORY, 'meta', '_journal.json')))
    .digest('hex');
}
