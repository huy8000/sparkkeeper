import assert from 'node:assert/strict';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  AccountLoginWorkerSupervisor,
  type AccountLoginWorkerFactory,
  type AccountLoginWorkerProcess,
} from '../src/onboarding/AccountLoginWorkerSupervisor.js';
import type {
  AccountLoginWorkerEvent,
  AccountLoginWorkerStart,
} from '../src/onboarding/AccountLoginWorkerProtocol.js';
import {
  prepareBrowserIdentityFile,
  removeBrowserIdentityFile,
} from '../src/onboarding/BrowserProcessIdentity.js';

const START: AccountLoginWorkerStart = {
  type: 'START',
  runtimeMode: 'INTERACTIVE',
  sessionId: '00000000-0000-4000-8000-000000000001',
  purpose: 'ADD_ACCOUNT',
  accountId: '00000000-0000-4000-8000-000000000002',
  profilePath: '/private/runtime/profile',
  profileKind: 'STAGING',
  expiresAt: '2030-01-01T00:00:00.000Z',
};

class FakeProcess extends EventEmitter implements AccountLoginWorkerProcess {
  readonly sent: unknown[] = [];
  readonly signals: (NodeJS.Signals | undefined)[] = [];
  readonly groupSignals: Array<{ readonly groupId: number; readonly signal: NodeJS.Signals }> = [];
  treeAlive = true;
  exitOnTerminate = true;
  readonly groupAlive = new Map<number, boolean>();

  send(message: unknown): boolean {
    this.sent.push(message);
    return true;
  }

  terminateTree(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.exitOnTerminate || signal === 'SIGKILL') {
      this.treeAlive = false;
      this.emit('exit', 0, signal);
    }
    return true;
  }

  isTreeAlive(): boolean {
    return this.treeAlive;
  }

  terminateGroup(groupId: number, signal: NodeJS.Signals): boolean {
    this.groupSignals.push({ groupId, signal });
    if (this.exitOnTerminate || signal === 'SIGKILL') this.groupAlive.set(groupId, false);
    return true;
  }

  isGroupAlive(groupId: number): boolean {
    return this.groupAlive.get(groupId) ?? false;
  }
}

class FakeFactory implements AccountLoginWorkerFactory {
  readonly process = new FakeProcess();
  spawnCount = 0;
  spawn(): AccountLoginWorkerProcess {
    this.spawnCount += 1;
    return this.process;
  }
}

class PosixFixtureFactory implements AccountLoginWorkerFactory {
  readonly process: ChildProcess & AccountLoginWorkerProcess;

  constructor(display: number) {
    const child = fork(new URL('./fixtures/detached-browser-worker.mjs', import.meta.url), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: true,
      env: { ...process.env, SPARKKEEPER_TEST_DISPLAY: String(display) },
    });
    const workerPgid = child.pid;
    if (workerPgid === undefined) throw new Error('Failed to start detached worker fixture.');
    this.process = Object.assign(child, {
      terminateTree(signal: NodeJS.Signals): boolean {
        return signalGroup(workerPgid, signal);
      },
      isTreeAlive(): boolean {
        return isGroupAlive(workerPgid);
      },
      terminateGroup(groupId: number, signal: NodeJS.Signals): boolean {
        return signalGroup(groupId, signal);
      },
      isGroupAlive(groupId: number): boolean {
        return isGroupAlive(groupId);
      },
    }) as ChildProcess & AccountLoginWorkerProcess;
  }

  spawn(): AccountLoginWorkerProcess {
    return this.process;
  }
}

test('retains only a validated loopback endpoint and clears it on readiness', async () => {
  const factory = new FakeFactory();
  const events: AccountLoginWorkerEvent[] = [];
  const supervisor = new AccountLoginWorkerSupervisor({ factory, stopGraceMs: 1 });
  await supervisor.start(START, (event) => events.push(event));

  factory.process.emit('message', {
    type: 'WORKER_STARTED',
    sessionId: START.sessionId,
    display: 90,
  });
  factory.process.emit('message', { type: 'BROWSER_LAUNCHING', sessionId: START.sessionId });
  factory.process.emit('message', {
    type: 'BROWSER_STARTED',
    sessionId: START.sessionId,
    browserPid: 12345,
    browserPgid: 12345,
  });
  factory.process.emit('message', {
    type: 'CONSOLE_READY',
    sessionId: START.sessionId,
    endpoint: { host: '127.0.0.1', port: 48_321 },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(supervisor.getConsoleEndpoint(START.sessionId), {
    host: '127.0.0.1',
    port: 48_321,
  });

  factory.process.emit('message', { type: 'AWAITING_USER', sessionId: START.sessionId });
  factory.process.emit('message', { type: 'READY_DETECTED', sessionId: START.sessionId });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.getConsoleEndpoint(START.sessionId), undefined);
  assert.equal(
    events.some((event) => event.type === 'READY_DETECTED'),
    true,
  );
});

test('invalid or out-of-order IPC fails closed and tears down the known worker', async () => {
  const factory = new FakeFactory();
  const events: AccountLoginWorkerEvent[] = [];
  const supervisor = new AccountLoginWorkerSupervisor({ factory, stopGraceMs: 1 });
  await supervisor.start(START, (event) => events.push(event));

  factory.process.emit('message', {
    type: 'CONSOLE_READY',
    sessionId: START.sessionId,
    endpoint: { host: '0.0.0.0', port: 6080 },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(events.at(0)?.type, 'WORKER_FAILED');
  assert.equal(
    factory.process.sent.some((value) => (value as { type?: string }).type === 'STOP'),
    true,
  );
  assert.deepEqual(factory.process.signals, ['SIGTERM']);
  assert.equal(supervisor.owns(START.sessionId), false);
});

test('stop is idempotent and signals only the worker-owned process tree', async () => {
  const factory = new FakeFactory();
  const supervisor = new AccountLoginWorkerSupervisor({ factory, stopGraceMs: 1 });
  await supervisor.start(START, () => undefined);

  await supervisor.stop(START.sessionId);
  await supervisor.stop(START.sessionId);

  assert.deepEqual(factory.process.signals, ['SIGTERM']);
  assert.equal(
    factory.process.sent.filter((value) => (value as { type?: string }).type === 'STOP').length,
    1,
  );
});

test('hung child fixture is force-killed before the supervisor releases ownership', async () => {
  const factory = new FakeFactory();
  factory.process.exitOnTerminate = false;
  const events: AccountLoginWorkerEvent[] = [];
  const supervisor = new AccountLoginWorkerSupervisor({
    factory,
    stopGraceMs: 1,
    forcedStopGraceMs: 1,
  });
  await supervisor.start(START, (event) => events.push(event));
  factory.process.emit('message', {
    type: 'WORKER_STARTED',
    sessionId: START.sessionId,
    display: 90,
  });
  factory.process.emit('message', { type: 'BROWSER_LAUNCHING', sessionId: START.sessionId });
  factory.process.emit('message', {
    type: 'BROWSER_STARTED',
    sessionId: START.sessionId,
    browserPid: 12346,
    browserPgid: 12346,
  });
  factory.process.groupAlive.set(12346, true);
  factory.process.emit('exit', 1, null);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(factory.process.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(factory.process.groupSignals, [
    { groupId: 12346, signal: 'SIGTERM' },
    { groupId: 12346, signal: 'SIGKILL' },
  ]);
  assert.equal(factory.process.isTreeAlive(), false);
  assert.equal(supervisor.owns(START.sessionId), false);
  assert.equal(events.at(-1)?.type, 'WORKER_EXITED');
});

test(
  'real POSIX detached browser group is killed before display ownership is released',
  { skip: process.platform === 'win32' },
  async (context) => {
    const display = 199;
    const displayReservation = path.join(
      os.tmpdir(),
      'sparkkeeper-display-locks',
      `display-${display}`,
    );
    rmSync(displayReservation, { recursive: true, force: true });
    const factory = new PosixFixtureFactory(display);
    let browserPgid: number | undefined;
    const browserStarted = new Promise<void>((resolve) => {
      factory.process.on('message', (message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: unknown }).type === 'BROWSER_STARTED'
        ) {
          browserPgid = (message as { browserPgid: number }).browserPgid;
          resolve();
        }
      });
    });
    context.after(() => {
      if (browserPgid !== undefined) signalGroup(browserPgid, 'SIGKILL');
      if (factory.process.pid !== undefined) signalGroup(factory.process.pid, 'SIGKILL');
      rmSync(displayReservation, { recursive: true, force: true });
    });

    const supervisor = new AccountLoginWorkerSupervisor({
      factory,
      stopGraceMs: 25,
      forcedStopGraceMs: 100,
    });
    await supervisor.start(START, () => undefined);
    await browserStarted;
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(browserPgid !== undefined && isGroupAlive(browserPgid));

    await supervisor.stop(START.sessionId);

    assert.equal(factory.process.isTreeAlive(), false);
    assert.equal(isGroupAlive(browserPgid), false);
    assert.equal(existsSync(displayReservation), false);
    assert.equal(supervisor.owns(START.sessionId), false);
  },
);

test(
  'restart adopts a persisted detached Chromium group before starting a replacement worker',
  { skip: process.platform === 'win32' },
  async (context) => {
    removeBrowserIdentityFile(START.sessionId);
    const staleBrowser = spawnIgnoringSigtermProcessGroup();
    const staleBrowserPgid = staleBrowser.pid;
    if (staleBrowserPgid === undefined) throw new Error('Failed to start stale browser fixture.');
    const identityFile = prepareBrowserIdentityFile(START.sessionId);
    writeFileSync(identityFile, `${staleBrowserPgid} ${staleBrowserPgid}\n`, { mode: 0o600 });

    const display = 198;
    const displayReservation = path.join(
      os.tmpdir(),
      'sparkkeeper-display-locks',
      `display-${display}`,
    );
    rmSync(displayReservation, { recursive: true, force: true });
    const factory = new PosixFixtureFactory(display);
    let replacementBrowserPgid: number | undefined;
    const replacementBrowserStarted = new Promise<void>((resolve) => {
      factory.process.on('message', (message: unknown) => {
        if (
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: unknown }).type === 'BROWSER_STARTED'
        ) {
          replacementBrowserPgid = (message as { browserPgid: number }).browserPgid;
          resolve();
        }
      });
    });
    context.after(() => {
      signalGroup(staleBrowserPgid, 'SIGKILL');
      if (replacementBrowserPgid !== undefined) signalGroup(replacementBrowserPgid, 'SIGKILL');
      if (factory.process.pid !== undefined) signalGroup(factory.process.pid, 'SIGKILL');
      removeBrowserIdentityFile(START.sessionId);
      rmSync(displayReservation, { recursive: true, force: true });
    });

    const supervisor = new AccountLoginWorkerSupervisor({
      factory,
      stopGraceMs: 25,
      forcedStopGraceMs: 100,
    });

    await supervisor.start(START, () => undefined);
    await replacementBrowserStarted;

    assert.equal(isGroupAlive(staleBrowserPgid), false);
    assert.equal(existsSync(identityFile), false);
    assert.equal(supervisor.owns(START.sessionId), true);
    assert.equal(existsSync(displayReservation), true);

    await supervisor.stop(START.sessionId);

    assert.equal(isGroupAlive(replacementBrowserPgid), false);
    assert.equal(existsSync(identityFile), false);
    assert.equal(existsSync(displayReservation), false);
    assert.equal(supervisor.owns(START.sessionId), false);
  },
);

test('invalid persisted Chromium identity keeps ownership and blocks replacement launch', async (context) => {
  removeBrowserIdentityFile(START.sessionId);
  const identityFile = prepareBrowserIdentityFile(START.sessionId);
  writeFileSync(identityFile, 'invalid identity\n', { mode: 0o600 });
  context.after(() => removeBrowserIdentityFile(START.sessionId));
  const factory = new FakeFactory();
  const supervisor = new AccountLoginWorkerSupervisor({
    factory,
    stopGraceMs: 1,
    forcedStopGraceMs: 1,
  });

  await supervisor.start(START, () => undefined);

  assert.equal(factory.spawnCount, 0);
  assert.equal(supervisor.owns(START.sessionId), true);
  assert.equal(existsSync(identityFile), true);
  await assert.rejects(
    supervisor.stop(START.sessionId),
    /process group survived bounded teardown/u,
  );
  assert.equal(supervisor.owns(START.sessionId), true);
  assert.equal(existsSync(identityFile), true);
});

function signalGroup(groupId: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-groupId, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function isGroupAlive(groupId: number | undefined): boolean {
  if (groupId === undefined) return false;
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    throw error;
  }
}

function spawnIgnoringSigtermProcessGroup(): ChildProcess {
  return spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
    detached: true,
    stdio: 'ignore',
  });
}
