import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  validateWorkerEvent,
  type AccountLoginWorkerEvent,
  type AccountLoginWorkerStart,
  type LoopbackConsoleEndpoint,
} from './AccountLoginWorkerProtocol.js';
import { readBrowserProcessIdentity, removeBrowserIdentityFile } from './BrowserProcessIdentity.js';

const DEFAULT_STOP_GRACE_MS = 10_000;
const FORCED_STOP_GRACE_MS = 2_000;
const EVENT_ORDER = new Map<string, number>([
  ['WORKER_STARTED', 0],
  ['BROWSER_LAUNCHING', 1],
  ['BROWSER_STARTED', 2],
  ['BROWSER_LAUNCH_ABORTED', 2],
  ['CONSOLE_READY', 3],
  ['AWAITING_USER', 4],
  ['READY_DETECTED', 5],
  ['IDENTITY_EXTRACTED', 6],
]);

export interface AccountLoginWorkerProcess extends EventEmitter {
  readonly connected?: boolean;
  readonly pid?: number;
  send(message: unknown): boolean;
  terminateTree(signal: NodeJS.Signals): boolean;
  isTreeAlive(): boolean;
  terminateGroup(groupId: number, signal: NodeJS.Signals): boolean;
  isGroupAlive(groupId: number): boolean;
}

export interface AccountLoginWorkerFactory {
  spawn(): AccountLoginWorkerProcess;
}

export interface WorkerSupervisorOptions {
  readonly factory?: AccountLoginWorkerFactory;
  readonly stopGraceMs?: number;
  readonly forcedStopGraceMs?: number;
}

interface WorkerRecord {
  readonly start: AccountLoginWorkerStart;
  process: AccountLoginWorkerProcess | undefined;
  readonly onEvent: (event: AccountLoginWorkerEvent) => void | Promise<void>;
  lastOrder: number;
  endpoint: LoopbackConsoleEndpoint | undefined;
  display: number | undefined;
  browserLaunchExpected: boolean;
  browserIdentityUnresolved: boolean;
  browserPid: number | undefined;
  browserGroupId: number | undefined;
  workerExited: boolean;
  stopping: boolean;
  stopOperation: Promise<void> | undefined;
}

export class AccountLoginWorkerSupervisor {
  private readonly records = new Map<string, WorkerRecord>();
  private readonly factory: AccountLoginWorkerFactory;
  private readonly stopGraceMs: number;
  private readonly forcedStopGraceMs: number;

  public constructor(options: WorkerSupervisorOptions = {}) {
    this.factory = options.factory ?? new ForkedAccountLoginWorkerFactory();
    this.stopGraceMs = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
    this.forcedStopGraceMs = options.forcedStopGraceMs ?? FORCED_STOP_GRACE_MS;
  }

  public async start(
    start: AccountLoginWorkerStart,
    onEvent: (event: AccountLoginWorkerEvent) => void | Promise<void>,
  ): Promise<void> {
    if (this.records.has(start.sessionId)) {
      return;
    }
    if (this.records.size > 0) {
      throw new Error('A login worker is already active.');
    }

    const record: WorkerRecord = {
      start,
      process: undefined,
      onEvent,
      lastOrder: -1,
      endpoint: undefined,
      display: undefined,
      browserLaunchExpected: false,
      browserIdentityUnresolved: false,
      browserPid: undefined,
      browserGroupId: undefined,
      workerExited: true,
      stopping: false,
      stopOperation: undefined,
    };
    this.records.set(start.sessionId, record);
    if (!(await this.reclaimPersistedBrowser(record))) return;

    let child: AccountLoginWorkerProcess;
    try {
      child = this.factory.spawn();
    } catch (error) {
      this.records.delete(start.sessionId);
      throw error;
    }
    record.process = child;
    record.workerExited = false;
    child.on('message', (message) => void this.handleMessage(record, message));
    child.once('error', () => void this.failProtocol(record));
    child.once('exit', () => void this.handleExit(record));
    if (!child.send(start)) {
      void this.failProtocol(record);
    }
  }

  public owns(sessionId: string): boolean {
    return this.records.has(sessionId);
  }

  public getConsoleEndpoint(sessionId: string): LoopbackConsoleEndpoint | undefined {
    const endpoint = this.records.get(sessionId)?.endpoint;
    return endpoint === undefined ? undefined : { ...endpoint };
  }

  public async stop(sessionId: string): Promise<void> {
    const record = this.records.get(sessionId);
    if (record === undefined) return;
    if (record.stopOperation !== undefined) return record.stopOperation;
    const operation = this.stopInternal(record);
    record.stopOperation = operation;
    return operation;
  }

  private async stopInternal(record: WorkerRecord): Promise<void> {
    record.stopping = true;
    record.endpoint = undefined;
    try {
      if (!record.workerExited && record.process !== undefined) {
        try {
          record.process.send({ type: 'STOP', sessionId: record.start.sessionId });
        } catch {
          // A closed IPC channel still requires process-group teardown below.
        }
      }
      if (!(await this.waitForOwnedProcessesExit(record, this.stopGraceMs))) {
        this.terminateOwnedProcesses(record, 'SIGTERM');
      }
      if (
        this.ownedProcessesRemain(record) &&
        !(await this.waitForOwnedProcessesExit(record, this.forcedStopGraceMs))
      ) {
        this.terminateOwnedProcesses(record, 'SIGKILL');
      }
      if (
        this.ownedProcessesRemain(record) &&
        !(await this.waitForOwnedProcessesExit(record, this.forcedStopGraceMs))
      ) {
        throw new Error(
          'Account login worker or Chromium process group survived bounded teardown.',
        );
      }
      this.releaseRuntimeResources(record);
      this.records.delete(record.start.sessionId);
    } catch (error) {
      record.stopping = false;
      record.stopOperation = undefined;
      throw error;
    }
  }

  public async stopAll(): Promise<void> {
    await Promise.all([...this.records.keys()].map((sessionId) => this.stop(sessionId)));
  }

  private async handleMessage(record: WorkerRecord, message: unknown): Promise<void> {
    let event: AccountLoginWorkerEvent;
    try {
      event = validateWorkerEvent(message);
      if (event.sessionId !== record.start.sessionId || event.type === 'WORKER_EXITED') {
        throw new Error('Worker event session or source is invalid.');
      }
      const order = EVENT_ORDER.get(event.type);
      if (order !== undefined) {
        if (order !== record.lastOrder + 1) throw new Error('Worker event order is invalid.');
        record.lastOrder = order;
      }
      if (event.type === 'CONSOLE_READY') record.endpoint = event.endpoint;
      if (event.type === 'WORKER_STARTED') record.display = event.display;
      if (event.type === 'BROWSER_LAUNCHING') record.browserLaunchExpected = true;
      if (event.type === 'BROWSER_STARTED') {
        record.browserLaunchExpected = true;
        record.browserPid = event.browserPid;
        record.browserGroupId = event.browserPgid;
      }
      if (event.type === 'BROWSER_LAUNCH_ABORTED') {
        if (
          !record.browserLaunchExpected ||
          record.browserPid !== undefined ||
          record.browserGroupId !== undefined
        ) {
          throw new Error('Chromium launch abort event is invalid.');
        }
        record.browserLaunchExpected = false;
      }
      if (
        event.type === 'READY_DETECTED' ||
        event.type === 'INTERACTIVE_EXPIRED' ||
        event.type === 'WORKER_FAILED'
      ) {
        record.endpoint = undefined;
      }
      await record.onEvent(event);
    } catch {
      await this.failProtocol(record);
    }
  }

  private async failProtocol(record: WorkerRecord): Promise<void> {
    if (!this.records.has(record.start.sessionId)) return;
    record.endpoint = undefined;
    try {
      await record.onEvent({
        type: 'WORKER_FAILED',
        sessionId: record.start.sessionId,
        failureCode: 'PROCESS_EXITED',
      });
    } catch {
      // The worker still needs bounded teardown if the parent transition failed.
    } finally {
      await this.stop(record.start.sessionId);
    }
  }

  private async handleExit(record: WorkerRecord): Promise<void> {
    if (!this.records.has(record.start.sessionId)) return;
    record.workerExited = true;
    record.endpoint = undefined;
    if (record.stopping) return;
    record.stopping = true;
    const cleanup = this.stopInternal(record);
    record.stopOperation = cleanup;
    try {
      await cleanup;
      await record.onEvent({ type: 'WORKER_EXITED', sessionId: record.start.sessionId });
    } catch {
      // Keep the record/lease fail-closed if the process tree could not be proven gone.
    }
  }

  private releaseRuntimeResources(record: WorkerRecord): void {
    this.refreshBrowserIdentity(record);
    if (
      record.browserIdentityUnresolved ||
      (record.browserPid === undefined) !== (record.browserGroupId === undefined) ||
      (record.browserGroupId !== undefined && this.isBrowserGroupAlive(record)) ||
      (record.browserLaunchExpected && record.browserGroupId === undefined)
    ) {
      throw new Error('Chromium process ownership is unresolved.');
    }
    removeBrowserIdentityFile(record.start.sessionId);
    if (record.display !== undefined) {
      rmSync(path.join(os.tmpdir(), 'sparkkeeper-display-locks', `display-${record.display}`), {
        recursive: true,
        force: true,
      });
      record.display = undefined;
    }
  }

  private refreshBrowserIdentity(record: WorkerRecord): void {
    if (record.browserIdentityUnresolved || record.browserGroupId !== undefined) return;
    try {
      const identity = readBrowserProcessIdentity(record.start.sessionId);
      if (identity !== undefined) {
        record.browserPid = identity.pid;
        record.browserGroupId = identity.pgid;
      }
    } catch {
      record.browserIdentityUnresolved = true;
    }
  }

  private ownedProcessesRemain(record: WorkerRecord): boolean {
    this.refreshBrowserIdentity(record);
    const browserAlive = record.browserGroupId !== undefined && this.isBrowserGroupAlive(record);
    const browserIdentityUnresolved =
      record.browserIdentityUnresolved ||
      (record.browserLaunchExpected && record.browserGroupId === undefined);
    return (record.process?.isTreeAlive() ?? false) || browserAlive || browserIdentityUnresolved;
  }

  private terminateOwnedProcesses(record: WorkerRecord, signal: NodeJS.Signals): void {
    this.refreshBrowserIdentity(record);
    record.process?.terminateTree(signal);
    if (record.browserGroupId !== undefined) {
      this.terminateBrowserGroup(record, signal);
    }
  }

  private async reclaimPersistedBrowser(record: WorkerRecord): Promise<boolean> {
    this.refreshBrowserIdentity(record);
    if (record.browserIdentityUnresolved) return false;
    if (record.browserGroupId === undefined) return true;

    record.browserLaunchExpected = true;
    try {
      if (this.isBrowserGroupAlive(record)) {
        this.terminateBrowserGroup(record, 'SIGTERM');
        if (!(await this.waitForOwnedProcessesExit(record, this.stopGraceMs))) {
          this.terminateBrowserGroup(record, 'SIGKILL');
          if (!(await this.waitForOwnedProcessesExit(record, this.forcedStopGraceMs))) {
            return false;
          }
        }
      }
      if (this.isBrowserGroupAlive(record)) return false;
      removeBrowserIdentityFile(record.start.sessionId);
      record.browserPid = undefined;
      record.browserGroupId = undefined;
      record.browserLaunchExpected = false;
      return true;
    } catch {
      record.browserIdentityUnresolved = true;
      return false;
    }
  }

  private terminateBrowserGroup(record: WorkerRecord, signal: NodeJS.Signals): boolean {
    if (record.browserGroupId === undefined) return false;
    return record.process === undefined
      ? signalProcessGroup(record.browserGroupId, signal)
      : record.process.terminateGroup(record.browserGroupId, signal);
  }

  private isBrowserGroupAlive(record: WorkerRecord): boolean {
    if (record.browserGroupId === undefined) return false;
    return record.process === undefined
      ? isProcessGroupAlive(record.browserGroupId)
      : record.process.isGroupAlive(record.browserGroupId);
  }

  private waitForOwnedProcessesExit(record: WorkerRecord, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const check = (): void => {
        if (!this.ownedProcessesRemain(record)) {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }
        const timer = setTimeout(check, Math.min(25, timeoutMs));
        timer.unref();
      };
      check();
    });
  }
}

class ForkedAccountLoginWorkerFactory implements AccountLoginWorkerFactory {
  public spawn(): AccountLoginWorkerProcess {
    if (process.platform === 'win32') {
      throw new Error('Account login worker process-tree isolation is unavailable on Windows.');
    }
    const child = fork(new URL('./account-login-worker.js', import.meta.url), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: workerEnvironment(),
      detached: true,
    });
    const processGroupId = child.pid;
    if (processGroupId === undefined) {
      child.kill('SIGKILL');
      throw new Error('Account login worker process group was not created.');
    }
    return Object.assign(child, {
      terminateTree(signal: NodeJS.Signals): boolean {
        try {
          process.kill(-processGroupId, signal);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
          throw error;
        }
      },
      isTreeAlive(): boolean {
        try {
          process.kill(-processGroupId, 0);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
          if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
          throw error;
        }
      },
      terminateGroup(groupId: number, signal: NodeJS.Signals): boolean {
        return signalProcessGroup(groupId, signal);
      },
      isGroupAlive(groupId: number): boolean {
        return isProcessGroupAlive(groupId);
      },
    }) as ChildProcess & AccountLoginWorkerProcess;
  }
}

function workerEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'HOME',
    'LANG',
    'LC_ALL',
    'TZ',
    'TMPDIR',
    'XDG_RUNTIME_DIR',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'PLAYWRIGHT_BROWSERS_PATH',
  ] as const;
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

function signalProcessGroup(groupId: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-groupId, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function isProcessGroupAlive(groupId: number): boolean {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    throw error;
  }
}
