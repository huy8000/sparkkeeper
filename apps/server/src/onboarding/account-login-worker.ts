import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AccountIdentityExtractionError,
  AccountOnboardingDetector,
  BrowserSession,
  DOUYIN_CHAT_URL,
} from '@sparkkeeper/automation';
import type { AccountLoginFailureCode } from '@sparkkeeper/shared';

import {
  validateWorkerStart,
  type AccountLoginWorkerEvent,
  type AccountLoginWorkerStart,
} from './AccountLoginWorkerProtocol.js';
import {
  prepareBrowserIdentityFile,
  readBrowserProcessIdentity,
  type BrowserProcessIdentity,
} from './BrowserProcessIdentity.js';

const PROCESS_START_GRACE_MS = 300;
const READINESS_POLL_MS = 500;
const COMPLETION_RECOVERY_DEADLINE_MS = 2 * 60 * 1_000;
const BROWSER_CLOSE_DEADLINE_MS = 2_000;
const CHILD_STOP_GRACE_MS = 500;
const WORKER_CLEANUP_DEADLINE_MS = 7_500;
const DISPLAY_MIN = 90;
const DISPLAY_MAX = 199;

let stopping = false;
let started = false;
let activeSessionId: string | undefined;
let browser: BrowserSession | undefined;
let browserIdentity: BrowserProcessIdentity | undefined;
let browserIdentityPrepared = false;
let browserLaunchAborted = false;
let displayReservation: string | undefined;
const children: ChildProcess[] = [];
const failedChildren = new Set<ChildProcess>();

process.once('message', (message) => void start(message));
process.on('message', (message: unknown) => {
  if (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'STOP' &&
    (message as { sessionId?: unknown }).sessionId === activeSessionId
  ) {
    void shutdown(0);
  }
});
process.once('SIGTERM', () => void shutdown(0));
process.once('SIGINT', () => void shutdown(0));
process.once('disconnect', () => void shutdown(1));

async function start(message: unknown): Promise<void> {
  if (started) return;
  started = true;
  let input: AccountLoginWorkerStart;
  try {
    input = validateWorkerStart(message);
  } catch {
    await shutdown(1);
    return;
  }
  activeSessionId = input.sessionId;

  try {
    if (input.runtimeMode === 'INTERACTIVE' && Date.now() >= Date.parse(input.expiresAt)) {
      send({ type: 'INTERACTIVE_EXPIRED', sessionId: input.sessionId });
      return;
    }

    const display = await reserveDisplay();
    send({ type: 'WORKER_STARTED', sessionId: input.sessionId, display });
    const vncPort = await reserveLoopbackPort();
    const websockifyPort = await reserveLoopbackPort();
    process.env.DISPLAY = `:${display}`;

    children.push(
      spawnKnown('Xvfb', [`:${display}`, '-screen', '0', '1440x900x24', '-nolisten', 'tcp', '-ac']),
    );
    await assertChildrenStarted();
    children.push(spawnKnown('openbox', []));
    children.push(
      spawnKnown('x11vnc', [
        '-display',
        `:${display}`,
        '-localhost',
        '-nopw',
        '-rfbport',
        String(vncPort),
        '-forever',
        '-shared',
      ]),
    );
    await assertChildrenStarted();
    await waitForLoopbackPort(vncPort);
    children.push(
      spawnKnown('websockify', [`127.0.0.1:${websockifyPort}`, `127.0.0.1:${vncPort}`]),
    );
    await assertChildrenStarted();
    await waitForLoopbackPort(websockifyPort);

    const identityFilePath = prepareBrowserIdentityFile(input.sessionId);
    browserIdentityPrepared = true;
    send({ type: 'BROWSER_LAUNCHING', sessionId: input.sessionId });
    browser = new BrowserSession(
      {
        userDataDir: input.profilePath,
        headless: false,
        timezoneId: 'Asia/Shanghai',
        locale: 'zh-CN',
        viewport: { width: 1440, height: 900 },
      },
      {
        processTracking: {
          launcherExecutablePath: fileURLToPath(
            new URL('../native/chromium-launcher', import.meta.url),
          ),
          identityFilePath,
        },
      },
    );
    const { page } = await browser.start();
    browserIdentity = readBrowserProcessIdentity(input.sessionId);
    if (browserIdentity === undefined) {
      throw new Error('Chromium process identity was not recorded.');
    }
    send({
      type: 'BROWSER_STARTED',
      sessionId: input.sessionId,
      browserPid: browserIdentity.pid,
      browserPgid: browserIdentity.pgid,
    });
    send({
      type: 'CONSOLE_READY',
      sessionId: input.sessionId,
      endpoint: { host: '127.0.0.1', port: websockifyPort },
    });
    await page.goto(DOUYIN_CHAT_URL, { waitUntil: 'domcontentloaded' });
    send({ type: 'AWAITING_USER', sessionId: input.sessionId });

    const detector = new AccountOnboardingDetector({ timeoutMs: 500, pollIntervalMs: 100 });
    const completionDeadline = Date.now() + COMPLETION_RECOVERY_DEADLINE_MS;
    while (
      !stopping &&
      Date.now() <
        (input.runtimeMode === 'COMPLETION_RECOVERY'
          ? completionDeadline
          : Date.parse(input.expiresAt))
    ) {
      try {
        const detection = await detector.detect(page);
        if (detection.status === 'READY') {
          send({ type: 'READY_DETECTED', sessionId: input.sessionId });
          send({
            type: 'IDENTITY_EXTRACTED',
            sessionId: input.sessionId,
            identity: detection.identity,
          });
          await shutdown(0);
          return;
        }
      } catch (error) {
        if (error instanceof AccountIdentityExtractionError) {
          sendFailure(input.sessionId, 'PROFILE_IDENTITY_UNAVAILABLE');
          await shutdown(1);
          return;
        }
        throw error;
      }
      await delay(READINESS_POLL_MS);
    }

    if (!stopping) {
      if (input.runtimeMode === 'INTERACTIVE') {
        send({ type: 'INTERACTIVE_EXPIRED', sessionId: input.sessionId });
        return;
      }
      sendFailure(input.sessionId, 'PROFILE_IDENTITY_UNAVAILABLE');
      await shutdown(1);
      return;
    }
    await shutdown(0);
  } catch {
    const abortedSessionId = confirmedBrowserLaunchAbortedSessionId();
    if (abortedSessionId !== undefined) {
      browserLaunchAborted = true;
      send({ type: 'BROWSER_LAUNCH_ABORTED', sessionId: abortedSessionId });
    }
    if (!stopping) sendFailure(input.sessionId, 'START_FAILED');
    await shutdown(1);
  }
}

function spawnKnown(command: string, args: readonly string[]): ChildProcess {
  const child = spawn(command, [...args], {
    shell: false,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.once('error', () => failedChildren.add(child));
  return child;
}

async function assertChildrenStarted(): Promise<void> {
  await delay(PROCESS_START_GRACE_MS);
  if (
    children.some(
      (child) => failedChildren.has(child) || child.exitCode !== null || child.signalCode !== null,
    )
  ) {
    throw new Error('A required browser console process exited during startup.');
  }
}

async function reserveDisplay(): Promise<number> {
  const root = path.join(os.tmpdir(), 'sparkkeeper-display-locks');
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (let display = DISPLAY_MIN; display <= DISPLAY_MAX; display += 1) {
    const candidate = path.join(root, `display-${display}`);
    try {
      await mkdir(candidate, { mode: 0o700 });
      displayReservation = candidate;
      return display;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('No local display is available.');
}

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to reserve a loopback port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForLoopbackPort(port: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const available = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.setTimeout(100, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (available) return;
    await delay(100);
  }
  throw new Error('Console bridge did not bind its loopback endpoint.');
}

function send(event: AccountLoginWorkerEvent): void {
  if (process.connected) process.send?.(event);
}

function sendFailure(sessionId: string, failureCode: AccountLoginFailureCode): void {
  send({ type: 'WORKER_FAILED', sessionId, failureCode });
}

async function shutdown(exitCode: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  const deadline = Date.now() + WORKER_CLEANUP_DEADLINE_MS;
  let cleanupFailed = false;
  try {
    if (browserIdentityPrepared && browserIdentity === undefined && activeSessionId !== undefined) {
      try {
        browserIdentity = readBrowserProcessIdentity(activeSessionId);
        if (browserIdentity === undefined && !browserLaunchAborted) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }
    try {
      if (browser !== undefined) {
        await withDeadline(
          browser.close(),
          Math.min(BROWSER_CLOSE_DEADLINE_MS, remainingMs(deadline)),
        );
      }
    } catch {
      cleanupFailed = true;
      if (browserIdentity !== undefined) {
        signalProcessGroup(browserIdentity.pgid, 'SIGKILL');
        if (!(await waitForProcessGroupExit(browserIdentity.pgid, remainingMs(deadline)))) {
          cleanupFailed = true;
        }
      }
    }
    browser = undefined;
    if (
      browserIdentity !== undefined &&
      (await waitForProcessGroupExit(
        browserIdentity.pgid,
        Math.min(CHILD_STOP_GRACE_MS, remainingMs(deadline)),
      )) === false
    ) {
      signalProcessGroup(browserIdentity.pgid, 'SIGKILL');
      if (!(await waitForProcessGroupExit(browserIdentity.pgid, remainingMs(deadline)))) {
        cleanupFailed = true;
      }
    }
    for (const child of [...children].reverse()) {
      try {
        await stopChild(child, deadline);
      } catch {
        cleanupFailed = true;
      }
    }
    children.length = 0;
    if (!cleanupFailed && displayReservation !== undefined) {
      await rm(displayReservation, { recursive: true, force: true });
      displayReservation = undefined;
    }
  } finally {
    process.exitCode = cleanupFailed ? 1 : exitCode;
    process.disconnect?.();
  }
}

function confirmedBrowserLaunchAbortedSessionId(): string | undefined {
  if (!browserIdentityPrepared || browserIdentity !== undefined || activeSessionId === undefined) {
    return undefined;
  }
  try {
    return readBrowserProcessIdentity(activeSessionId) === undefined ? activeSessionId : undefined;
  } catch {
    return undefined;
  }
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

function waitForProcessGroupExit(groupId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = (): void => {
      try {
        process.kill(-groupId, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          resolve(true);
          return;
        }
        if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
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

async function stopChild(child: ChildProcess, deadline: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForChildExit(child, Math.min(CHILD_STOP_GRACE_MS, remainingMs(deadline)));
  child.kill('SIGTERM');
  if (await exited) return;
  const killed = waitForChildExit(child, Math.min(CHILD_STOP_GRACE_MS, remainingMs(deadline)));
  child.kill('SIGKILL');
  if (!(await killed)) throw new Error('Child process did not exit before cleanup deadline.');
}

function remainingMs(deadline: number): number {
  return Math.max(1, deadline - Date.now());
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Worker cleanup deadline exceeded.')), timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(value);
    };
    const onExit = (): void => settle(true);
    const timer = setTimeout(() => settle(false), timeoutMs);
    timer.unref();
    child.once('exit', onExit);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
