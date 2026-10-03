import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  openDatabaseReadOnly,
  MigrationRepository,
  AccountRepository,
  inspectMigration,
  AdminUserRepository,
  FriendRepository,
  ScheduleRepository,
  MessageTemplateRepository,
} from '@sparkkeeper/database';
import {
  createV1EightDatabase,
  insertLegacyAccount,
} from '../../../packages/database/test/testDatabase.js';
import { migrationHelper } from '../src/migration/LegacyProfileBinding.js';
import { createApiApplication } from '../src/http/ApiApplication.js';

const cli = path.resolve('dist/migration-cli.js');
function invoke(root: string, args: string[], environment: Record<string, string> = {}) {
  root = realpathSync(root);
  const tmp = path.join(root, 'private-tmp');
  mkdirSync(tmp, { recursive: true });
  return spawnSync(process.execPath, [cli, ...args], {
    env: {
      ...process.env,
      DATA_DIR: root,
      TMPDIR: tmp,
      SCHEDULER_ENABLED: 'false',
      SCHEDULER_ALLOW_REAL_SEND: 'false',
      MANUAL_RUN_ENABLED: 'false',
      ...environment,
    },
    encoding: 'utf8',
  });
}
test('offline populated V3 migration rehearsal: exact preservation, full-root backup/restore/reopen, no auto binding/tasks', (t) => {
  const f = createV1EightDatabase(t),
    a = insertLegacyAccount(f.databasePath, { id: randomUUID(), name: 'Synthetic legacy' });
  new FriendRepository(f.client).create({ accountId: a.id, displayName: 'Synthetic friend' });
  new ScheduleRepository(f.client).create({
    accountId: a.id,
    startTime: '09:00',
    endTime: '12:00',
    timezone: 'UTC',
    enabled: true,
    now: new Date(),
  });
  new MessageTemplateRepository(f.client).create({
    name: 'Synthetic',
    providerType: 'STATIC',
    messages: ['Synthetic private content'],
  });
  const before = inspectMigration(f.client);
  assert.equal(before.ok, true);
  f.client.close();
  const profile = path.join(f.directory, 'browser-profile');
  mkdirSync(profile);
  writeFileSync(path.join(profile, 'synthetic-state'), 'opaque synthetic bytes');
  const backup = mkdtempSync(path.join(os.tmpdir(), 'sparkkeeper-v49-backup-')),
    restore = mkdtempSync(path.join(os.tmpdir(), 'sparkkeeper-v49-restore-'));
  t.after(() => {
    rmSync(backup, { recursive: true, force: true });
    rmSync(restore, { recursive: true, force: true });
  });
  cpSync(f.directory, backup, { recursive: true });
  const preflight = invoke(f.directory, ['preflight']);
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.equal(JSON.parse(preflight.stdout).migrationCount, 8);
  assert.notEqual(invoke(f.directory, ['migrate']).status, 0);
  assert.notEqual(
    invoke(f.directory, ['migrate', '--stopped', '--full-backup-confirmed'], {
      SCHEDULER_ALLOW_REAL_SEND: 'true',
    }).status,
    0,
  );
  const migrated = invoke(f.directory, ['migrate', '--stopped', '--full-backup-confirmed']);
  assert.equal(migrated.status, 0, migrated.stderr);
  const after = JSON.parse(migrated.stdout);
  assert.deepEqual(after.legacy, before.legacy);
  assert.equal(after.migrationCount, 14);
  assert.equal(after.enabledTasks, 0);
  assert.equal(after.counts.contacts, 0);
  assert.equal(after.counts.delivery_resolutions, 0);
  assert.doesNotMatch(migrated.stdout, /Synthetic|opaque|private content/);
  assert.equal(invoke(f.directory, ['migrate', '--stopped', '--full-backup-confirmed']).status, 0);
  cpSync(backup, restore, { recursive: true });
  const restored = openDatabaseReadOnly({ databasePath: path.join(restore, 'sparkkeeper.db') });
  try {
    assert.deepEqual(inspectMigration(restored).legacy, before.legacy);
    assert.equal(inspectMigration(restored).migrationCount, 8);
  } finally {
    restored.close();
  }
  assert.equal(
    readFileSync(path.join(restore, 'browser-profile', 'synthetic-state'), 'utf8'),
    'opaque synthetic bytes',
  );
});
test('profile binding native inode/marker NOREPLACE + crash after rename recovers offline and blocks ordinary startup until completion', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sparkkeeper-v49-binding-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, 'sparkkeeper.db'),
    db = createDatabase({ databasePath });
  db.migrate();
  const a = new AccountRepository(db).create({
    name: 'Synthetic legacy',
    profileState: 'MIGRATION_REQUIRED',
    loginStatus: 'READY',
  });
  const source = path.join(root, 'browser-profile');
  mkdirSync(source, { mode: 0o700 });
  writeFileSync(path.join(source, 'synthetic-state'), 'opaque');
  const state = lstatSync(source, { bigint: true }),
    repo = new MigrationRepository(db),
    intent = repo.prepareProfileBinding(a.id, state.dev.toString(), state.ino.toString());
  const renamed = spawnSync(migrationHelper, [
    'bind-legacy',
    root,
    a.id,
    intent.id,
    intent.sourceDevice,
    intent.sourceInode,
  ]);
  assert.equal(renamed.status, 0);
  assert.equal(repo.hasPendingProfileBinding(), true);
  assert.equal(existsSync(source), false);
  assert.throws(
    () =>
      createApiApplication({
        databasePath,
        environment: {
          DATA_DIR: root,
          SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
          SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:3000',
        },
        logger: false,
      }),
    /MIGRATION_RECOVERY_REQUIRED/,
  );
  db.close();
  const completed = invoke(root, [
    'bind-profile',
    '--account-id',
    a.id,
    '--stopped',
    '--full-backup-confirmed',
  ]);
  assert.equal(completed.status, 0, completed.stderr);
  const reopened = createDatabase({ databasePath });
  try {
    assert.equal(new MigrationRepository(reopened).hasPendingProfileBinding(), false);
    const account = new AccountRepository(reopened).findById(a.id)!;
    assert.equal(account.profileState, 'READY');
    assert.equal(account.loginStatus, 'UNKNOWN');
    assert.equal(account.douyinSecUid, null);
    assert.equal(new MigrationRepository(reopened).profileIntent(a.id)!.id, intent.id);
  } finally {
    reopened.close();
  }
  assert.equal(
    invoke(root, ['bind-profile', '--account-id', a.id, '--stopped', '--full-backup-confirmed'])
      .status,
    0,
  );
  // Normal Docker startup can recreate the empty legacy directory. A completed
  // intent verifies its original final inode, never rebinds that new directory.
  mkdirSync(source);
  const recreated = lstatSync(source, { bigint: true });
  assert.equal(
    invoke(root, ['bind-profile', '--account-id', a.id, '--stopped', '--full-backup-confirmed'])
      .status,
    0,
  );
  assert.equal(lstatSync(source, { bigint: true }).ino, recreated.ino);
  assert.equal(
    readFileSync(path.join(root, 'browser-profiles', a.id, 'synthetic-state'), 'utf8'),
    'opaque',
  );
});
test('native legacy binding rejects destination race, symlink ancestor/source and swapped inode without overwrite', (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sparkkeeper-v49-native-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'browser-profile'),
    a = randomUUID(),
    op = randomUUID();
  mkdirSync(source);
  const state = lstatSync(source, { bigint: true });
  const args = ['bind-legacy', root, a, op, state.dev.toString(), state.ino.toString()];
  mkdirSync(path.join(root, 'browser-profiles', a), { recursive: true });
  writeFileSync(path.join(root, 'browser-profiles', a, 'sentinel'), 'untouched');
  assert.notEqual(spawnSync(migrationHelper, args).status, 0);
  assert.equal(
    readFileSync(path.join(root, 'browser-profiles', a, 'sentinel'), 'utf8'),
    'untouched',
  );
  renameSync(source, path.join(root, 'original'));
  mkdirSync(source);
  assert.notEqual(spawnSync(migrationHelper, args).status, 0);
  assert.equal(existsSync(path.join(source, '.sparkkeeper-profile.json')), false);
  const alias = path.join(root, 'alias');
  symlinkSync(root, alias);
  assert.notEqual(
    spawnSync(migrationHelper, [...args.slice(0, 1), alias, ...args.slice(2)]).status,
    0,
  );
});
test('ambiguous multi-account legacy profile is never auto-bound or copied', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sparkkeeper-v49-multiple-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = createDatabase({ databasePath: path.join(root, 'sparkkeeper.db') });
  db.migrate();
  const a = new AccountRepository(db).create({ name: 'Synthetic first' });
  new AccountRepository(db).create({ name: 'Synthetic second' });
  new AdminUserRepository(db).create({ username: 'Synthetic', passwordHash: 'fixture' });
  db.close();
  mkdirSync(path.join(root, 'browser-profile'));
  assert.notEqual(
    invoke(root, ['bind-profile', '--account-id', a.id, '--stopped', '--full-backup-confirmed'])
      .status,
    0,
  );
  assert.equal(existsSync(path.join(root, 'browser-profile')), true);
  assert.equal(existsSync(path.join(root, 'browser-profiles', a.id)), false);
});
test('offline native lease rejects an actual competing process and never removes its lock', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'sparkkeeper-v49-lock-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const db = createDatabase({ databasePath: path.join(root, 'sparkkeeper.db') });
  db.migrate();
  db.close();
  const child = spawn(
    migrationHelper,
    [
      'offline-lock',
      root,
      process.execPath,
      '-e',
      'process.stdout.write("LOCKED\\n");setInterval(()=>{},1000)',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await once(child.stdout!, 'data');
    assert.notEqual(invoke(root, ['migrate', '--stopped', '--full-backup-confirmed']).status, 0);
    assert.equal(existsSync(path.join(root, 'browser-profile.lock')), true);
  } finally {
    const exit = once(child, 'exit');
    child.kill('SIGTERM');
    await exit;
  }
  assert.equal(invoke(root, ['migrate', '--stopped', '--full-backup-confirmed']).status, 0);
});
