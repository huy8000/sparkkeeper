import assert from 'node:assert/strict';
import console from 'node:console';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

/* global fetch */

import {
  compose,
  inspectContainer,
  run,
  waitForContainerHealth,
  waitForJson,
} from './docker-smoke-helpers.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-docker-maintenance-'));
const dataDirectory = path.join(root, 'data');
const secretsDirectory = path.join(root, 'secrets');
const passwordFile = path.join(secretsDirectory, 'novnc-password');
const profileSentinel = path.join(dataDirectory, 'browser-profile', 'synthetic-profile-state');
mkdirSync(path.dirname(profileSentinel), { recursive: true });
mkdirSync(secretsDirectory, { recursive: true });
writeFileSync(passwordFile, 'local-test-password\n', { mode: 0o600 });

const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `sparkkeeper-maintenance-smoke-${process.pid}`,
  SPARKKEEPER_DATA_DIR: dataDirectory,
  NOVNC_PASSWORD_FILE: passwordFile,
  SCHEDULER_ENABLED: 'false',
  SCHEDULER_ALLOW_REAL_SEND: 'false',
  MANUAL_RUN_ENABLED: 'false',
};

function wrapper(action, options = {}) {
  return run('bash', ['scripts/docker-maintenance.sh', action], { ...options, env });
}

try {
  compose(['up', '-d', 'app', 'admin'], env, { timeout: 180_000 });
  await waitForContainerHealth('app', env);
  await waitForContainerHealth('admin', env);

  compose(['--profile', 'maintenance', 'run', '--rm', '--no-deps', 'maintenance'], env, {
    expectedStatus: 73,
    quiet: true,
    timeout: 60_000,
  });
  wrapper('start', { timeout: 180_000 });
  await waitForContainerHealth('maintenance', env, 120_000);
  assert.equal(
    compose(['ps', '--status', 'running', '--services', 'app'], env, { quiet: true }).trim(),
    '',
  );

  const processList = compose(
    [
      '--profile',
      'maintenance',
      'exec',
      '-T',
      'maintenance',
      'sh',
      '-c',
      "for f in /proc/[0-9]*/cmdline; do tr '\\0' ' ' < \"$f\" 2>/dev/null || true; echo; done",
    ],
    env,
    { quiet: true },
  );
  for (const processName of ['Xvfb', 'openbox', 'x11vnc', 'websockify', 'chrome']) {
    assert.match(processList, new RegExp(processName, 'u'));
  }
  assert.doesNotMatch(processList, /dist\/main\.js|SchedulerService/u);

  const noVnc = await fetch('http://127.0.0.1:6080/');
  assert.equal(noVnc.status, 200);
  assert.match(await noVnc.text(), /noVNC/iu);

  const maintenanceInspect = inspectContainer('maintenance', env);
  assert.equal(maintenanceInspect.NetworkSettings.Ports['6080/tcp'][0].HostIp, '127.0.0.1');
  assert.equal(maintenanceInspect.NetworkSettings.Ports['5900/tcp'], undefined);
  assert.equal(maintenanceInspect.HostConfig.Privileged, false);
  assert.notEqual(maintenanceInspect.HostConfig.NetworkMode, 'host');

  const generatedProfileEntries = run(
    'docker',
    [
      'compose',
      '--profile',
      'maintenance',
      'exec',
      '-T',
      'maintenance',
      'sh',
      '-c',
      'find /app/data/browser-profile -mindepth 1 -maxdepth 2 -type f | head -n 20',
    ],
    { env, quiet: true },
  );
  assert.notEqual(
    generatedProfileEntries.trim(),
    '',
    'headed Chromium did not create profile state',
  );

  writeFileSync(profileSentinel, 'synthetic profile state\n', { mode: 0o600 });
  wrapper('stop', { timeout: 180_000 });
  await waitForContainerHealth('app', env);
  await waitForContainerHealth('admin', env);
  await waitForJson(
    'http://127.0.0.1:8080/api/runtime/status',
    (body) => body?.success === true && body.data?.serverStatus === 'READY',
  );
  assert.equal(
    compose(
      ['--profile', 'maintenance', 'ps', '--status', 'running', '--services', 'maintenance'],
      env,
      {
        quiet: true,
      },
    ).trim(),
    '',
  );
  assert.equal(readFileSync(profileSentinel, 'utf8'), 'synthetic profile state\n');

  wrapper('start', { timeout: 180_000 });
  await waitForContainerHealth('maintenance', env, 120_000);
  const sentinelInMaintenance = compose(
    [
      '--profile',
      'maintenance',
      'exec',
      '-T',
      'maintenance',
      'sh',
      '-c',
      'test -f /app/data/browser-profile/synthetic-profile-state && echo present',
    ],
    env,
    { quiet: true },
  );
  assert.equal(sentinelInMaintenance.trim(), 'present');

  const logs = compose(['--profile', 'maintenance', 'logs', '--no-color', 'maintenance'], env, {
    quiet: true,
  });
  assert.doesNotMatch(logs, /local-test-password/u);

  wrapper('stop', { timeout: 180_000 });
  await waitForContainerHealth('app', env);
  await waitForContainerHealth('admin', env);
  console.log('Docker maintenance smoke PASS');
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
