import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, openDatabaseReadOnly, inspectMigration } from '@sparkkeeper/database';
import {
  assertOfflineLock,
  assertNoRuntimeArtifacts,
  bindLegacyProfile,
  migrationHelper,
} from './migration/LegacyProfileBinding.js';

function main(args: string[]) {
  const root = path.resolve(process.env.DATA_DIR ?? 'data');
  const [action, ...options] = args;
  const databasePath = path.join(root, 'sparkkeeper.db');
  if (!lstatSync(databasePath).isFile() || lstatSync(databasePath).isSymbolicLink())
    throw new Error('DATABASE_REQUIRED');
  if (action === 'preflight' || action === 'audit') {
    if (options.length) throw new Error('INVALID_ARGUMENTS');
    const db = openDatabaseReadOnly({ databasePath });
    try {
      const report = inspectMigration(db);
      console.log(JSON.stringify(report));
      if (!report.ok) process.exitCode = 1;
    } finally {
      db.close();
    }
    return;
  }
  if (action !== 'migrate' && action !== 'bind-profile') throw new Error('INVALID_ACTION');
  if (
    process.env.BROWSER_PROFILE_DIR &&
    path.resolve(process.env.BROWSER_PROFILE_DIR) !== path.join(root, 'browser-profile')
  )
    throw new Error('UNSUPPORTED_LEGACY_PROFILE_CONFIGURATION');
  if (!options.includes('--stopped') || !options.includes('--full-backup-confirmed'))
    throw new Error('STOP_AND_FULL_BACKUP_REQUIRED');
  if (
    [
      'SCHEDULER_ENABLED',
      'SCHEDULER_ALLOW_REAL_SEND',
      'ALLOW_REAL_SEND',
      'MANUAL_RUN_ENABLED',
    ].some((k) => process.env[k] !== undefined && process.env[k] !== 'false')
  )
    throw new Error('RELEASE_GATE_MUST_BE_CLOSED');
  if (!options.includes('--locked')) {
    const result = spawnSync(
      migrationHelper,
      [
        'offline-lock',
        root,
        process.execPath,
        fileURLToPath(import.meta.url),
        action,
        ...options,
        '--locked',
      ],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error('OFFLINE_OPERATION_REJECTED');
    return;
  }
  assertOfflineLock(root);
  assertNoRuntimeArtifacts(root);
  const allowed =
    action === 'bind-profile'
      ? ['--stopped', '--full-backup-confirmed', '--locked', '--account-id']
      : ['--stopped', '--full-backup-confirmed', '--locked'];
  for (let i = 0; i < options.length; i++) {
    if (!allowed.includes(options[i]!)) throw new Error('INVALID_ARGUMENTS');
    if (options[i] === '--account-id') i++;
  }
  const db = createDatabase({ databasePath });
  try {
    const before = inspectMigration(db);
    if (!before.ok || before.activeRuntimeCount !== 0) throw new Error('PREFLIGHT_FAILED');
    db.migrate();
    const after = inspectMigration(db);
    if (!after.ok || JSON.stringify(before.legacy) !== JSON.stringify(after.legacy))
      throw new Error('PRESERVATION_CHECK_FAILED');
    if (action === 'migrate') {
      console.log(JSON.stringify({ result: 'MIGRATION_VERIFIED', ...after }));
    } else {
      const accountId = options[options.indexOf('--account-id') + 1];
      if (!options.includes('--account-id') || !accountId) throw new Error('ACCOUNT_REQUIRED');
      console.log(JSON.stringify(bindLegacyProfile(db, root, accountId)));
    }
  } finally {
    db.close();
  }
}
try {
  main(process.argv.slice(2));
} catch {
  console.error('SparkKeeper offline migration rejected; preserve backup, lock and ownership.');
  process.exitCode = 1;
}
