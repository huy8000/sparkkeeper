import { spawnSync } from 'node:child_process';
import { fstatSync, lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { MigrationRepository, type DatabaseClient } from '@sparkkeeper/database';

export const migrationHelper = fileURLToPath(
  new URL('../../dist/native/rename-noreplace', import.meta.url),
);
export function assertOfflineLock(root: string) {
  const fd = Number(process.env.SPARKKEEPER_OFFLINE_LOCK_FD);
  if (!Number.isInteger(fd) || fd < 3) throw new Error('OFFLINE_LOCK_REQUIRED');
  const a = fstatSync(fd),
    b = lstatSync(path.join(root, 'browser-profile.lock'));
  if (!a.isFile() || !b.isFile() || a.ino !== b.ino || a.dev !== b.dev)
    throw new Error('OFFLINE_LOCK_REQUIRED');
}
export function assertNoRuntimeArtifacts(root: string) {
  const directories = [
    'onboarding-runtime',
    'discovery-runtime',
    'test-send-runtime',
    'scheduled-runtime',
  ].map((name) => path.join(root, name));
  directories.push(
    path.join(os.tmpdir(), 'sparkkeeper-browser-processes'),
    path.join(os.tmpdir(), 'sparkkeeper-display-locks'),
  );
  for (const dir of directories) {
    try {
      const stat = lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink() || readdirSync(dir).length > 0)
        throw new Error('RUNTIME_OWNERSHIP_PRESENT');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
}
/** Only the fixed legacy directory is touched; native dirfds enforce the boundary. */
export function bindLegacyProfile(database: DatabaseClient, root: string, accountId: string) {
  assertOfflineLock(root);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(accountId))
    throw new Error('INVALID_ACCOUNT');
  assertNoRuntimeArtifacts(root);
  const repo = new MigrationRepository(database);
  repo.assertRuntimeIdle();
  let intent = repo.profileIntent(accountId);
  if (!intent) {
    const source = lstatSync(path.join(root, 'browser-profile'), { bigint: true });
    if (!source.isDirectory() || source.isSymbolicLink()) throw new Error('UNSAFE_LEGACY_PROFILE');
    intent = repo.prepareProfileBinding(accountId, source.dev.toString(), source.ino.toString());
  }
  const result = spawnSync(
    migrationHelper,
    [
      intent.status === 'COMPLETED' ? 'verify-legacy-binding' : 'bind-legacy',
      root,
      accountId,
      intent.id,
      intent.sourceDevice,
      intent.sourceInode,
    ],
    { stdio: 'ignore' },
  );
  if (result.status !== 0) throw new Error('PROFILE_BINDING_UNRESOLVED');
  repo.completeProfileBinding(accountId, intent.id);
  return { accountId, profileState: 'READY', loginStatus: 'UNKNOWN', reloginRequired: true };
}
