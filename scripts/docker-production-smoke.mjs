import assert from 'node:assert/strict';
import console from 'node:console';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

/* global AbortSignal, fetch */

import {
  compose,
  inspectContainer,
  readSseFrame,
  run,
  waitForContainerHealth,
  waitForJson,
} from './docker-smoke-helpers.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-docker-production-'));
const dataDirectory = path.join(root, 'data');
mkdirSync(path.join(dataDirectory, 'browser-profile'), { recursive: true });
for (const directory of ['logs', 'screenshots', 'traces']) {
  mkdirSync(path.join(dataDirectory, directory), { recursive: true });
}
const profileSentinel = path.join(dataDirectory, 'browser-profile', 'synthetic-profile-state');
const evidenceSentinel = path.join(dataDirectory, 'traces', 'synthetic-evidence-state');
writeFileSync(profileSentinel, 'synthetic profile state\n', { mode: 0o600 });
writeFileSync(evidenceSentinel, 'synthetic evidence state\n', { mode: 0o600 });

const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `sparkkeeper-production-smoke-${process.pid}`,
  SPARKKEEPER_DATA_DIR: dataDirectory,
  SCHEDULER_ENABLED: 'false',
  SCHEDULER_ALLOW_REAL_SEND: 'false',
  MANUAL_RUN_ENABLED: 'false',
};
const baseUrl = 'http://127.0.0.1:8080';

async function verifySnapshot() {
  const { response: healthResponse, body: health } = await waitForJson(
    `${baseUrl}/api/health`,
    (body) => body?.success === true && body.data?.status === 'READY',
  );
  assert.equal(healthResponse.headers.get('access-control-allow-origin'), null);
  assert.equal(health.data.database.status, 'READY');
  assert.equal(health.data.migration.status, 'READY');

  const { body: runtime } = await waitForJson(
    `${baseUrl}/api/runtime/status`,
    (body) => body?.success === true && body.data?.serverStatus === 'READY',
  );
  assert.equal(runtime.data.schedulerEnabled, false);
  assert.equal(runtime.data.realSendAuthorizationEnabled, false);
  assert.equal(runtime.data.manualRunEnabled, false);
}

try {
  compose(['up', '-d', 'app', 'admin'], env, { timeout: 180_000 });
  await waitForContainerHealth('app', env);
  await waitForContainerHealth('admin', env);
  await verifySnapshot();

  const admin = await fetch(`${baseUrl}/`);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /<div id="app"><\/div>/u);
  const deepRoute = await fetch(`${baseUrl}/runs/00000000-0000-4000-8000-000000000099`);
  assert.equal(deepRoute.status, 200);
  assert.match(await deepRoute.text(), /<div id="app"><\/div>/u);

  const sse = await readSseFrame(`${baseUrl}/api/events/stream`);
  assert.match(sse, /^retry: \d+/mu);
  assert.match(sse, /^id: \d+/mu);
  assert.match(sse, /^event: ready$/mu);
  assert.match(sse, /^data: \{.*\}$/mu);

  const fixtureConfig = {
    enabled: false,
    provider: 'WEBHOOK',
    webhookUrl: null,
    notifyAuthExpired: true,
    notifyTaskFailed: false,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  };
  const blocked = await fetch(`${baseUrl}/api/notification-config`, {
    method: 'PUT',
    headers: {
      host: 'attacker.invalid',
      origin: 'https://attacker.invalid',
      'content-type': 'application/json',
      'x-sparkkeeper-admin-request': '1',
    },
    body: JSON.stringify(fixtureConfig),
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);

  const saved = await fetch(`${baseUrl}/api/notification-config`, {
    method: 'PUT',
    headers: {
      origin: baseUrl,
      'content-type': 'application/json',
      'x-sparkkeeper-admin-request': '1',
    },
    body: JSON.stringify(fixtureConfig),
  });
  assert.equal(saved.status, 200, await saved.text());

  const migrationCount = Number(
    compose(
      [
        'exec',
        '-T',
        'app',
        'node',
        '--input-type=module',
        '-e',
        "import { openDatabaseReadOnly } from '@sparkkeeper/database'; const db=openDatabaseReadOnly({databasePath:'/app/data/sparkkeeper.db'}); console.log(db.inspect().appliedMigrationCount); db.close();",
      ],
      env,
      { quiet: true },
    ).trim(),
  );
  assert.equal(migrationCount, 8, 'fresh database must apply migrations 0000 through 0007');

  const adminInspect = inspectContainer('admin', env);
  const appInspect = inspectContainer('app', env);
  assert.deepEqual(Object.keys(adminInspect.NetworkSettings.Ports), ['8080/tcp']);
  assert.equal(adminInspect.NetworkSettings.Ports['8080/tcp'][0].HostIp, '127.0.0.1');
  assert.equal(appInspect.NetworkSettings.Ports['8080/tcp'], null);
  assert.equal(appInspect.HostConfig.Privileged, false);
  assert.notEqual(appInspect.HostConfig.NetworkMode, 'host');
  assert.equal(appInspect.HostConfig.PidMode, '');
  assert.equal(
    compose(['ps', '-a', '--services'], env, { quiet: true }).includes('maintenance'),
    false,
  );
  let noVncReachable = true;
  try {
    await fetch('http://127.0.0.1:6080/', { signal: AbortSignal.timeout(750) });
  } catch {
    noVncReachable = false;
  }
  assert.equal(noVncReachable, false, 'default production unexpectedly exposed noVNC');

  compose(['restart', 'app'], env, { timeout: 180_000 });
  await waitForContainerHealth('app', env);
  await verifySnapshot();
  let persisted = await (await fetch(`${baseUrl}/api/notification-config`)).json();
  assert.equal(persisted.data.notifyTaskFailed, false);

  compose(['up', '-d', '--force-recreate', 'app', 'admin'], env, { timeout: 180_000 });
  await waitForContainerHealth('app', env);
  await waitForContainerHealth('admin', env);
  await verifySnapshot();
  persisted = await (await fetch(`${baseUrl}/api/notification-config`)).json();
  assert.equal(persisted.data.notifyTaskFailed, false);

  for (const sentinel of [profileSentinel, evidenceSentinel]) {
    assert.equal(await fileExists(sentinel), true, `${path.basename(sentinel)} was not persisted`);
  }

  const history = run('docker', ['history', '--no-trunc', 'sparkkeeper-app:local'], {
    quiet: true,
  });
  assert.doesNotMatch(history, /cookie|token|authorization|browser-profile|task_plan\.md/iu);
  run(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      'sparkkeeper-app:local',
      '-c',
      'test ! -e /app/server/.git && test ! -e /app/server/.env && test ! -e /app/server/task_plan.md && test ! -e /app/server/data && test ! -e /app/server/src && test ! -e /app/server/test',
    ],
    { quiet: true },
  );

  console.log('Docker production smoke PASS');
} finally {
  try {
    compose(['--profile', 'maintenance', 'down', '--remove-orphans'], env, {
      quiet: true,
      timeout: 180_000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function fileExists(file) {
  const { access } = await import('node:fs/promises');
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
