import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { BrowserSession } from '@sparkkeeper/automation';
import { parseBusinessDate } from '@sparkkeeper/shared';

import { RetentionManager } from '../src/observability/RetentionManager.js';
import {
  PlaywrightScreenshotCapture,
  ScreenshotManager,
  type ScreenshotCapture,
} from '../src/observability/ScreenshotManager.js';
import {
  PlaywrightTraceCapture,
  TraceManager,
  type TraceCapture,
} from '../src/observability/TraceManager.js';

function temporaryDirectory(context: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-evidence-test-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function browserSession(root: string): BrowserSession {
  return new BrowserSession({
    userDataDir: path.join(root, 'test-browser-profile'),
    headless: true,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport: { width: 800, height: 600 },
  });
}

test('ScreenshotManager creates a safe relative path with no display identity', async (context) => {
  const root = temporaryDirectory(context);
  const capture: ScreenshotCapture = {
    capture: async (absolutePath) => writeFileSync(absolutePath, 'fictional screenshot'),
  };
  const result = await new ScreenshotManager(root, capture).capture({
    businessDate: parseBusinessDate('2026-08-23'),
    runId: 'run-id',
    friendId: 'friend-id',
    eventType: 'SELECTOR_FAILURE',
  });

  assert.deepEqual(result, {
    status: 'CAPTURED',
    relativePath: 'screenshots/2026-08-23/run-id/selector-failure-friend-id.png',
  });
  assert.equal(
    existsSync(path.join(root, '2026-08-23/run-id/selector-failure-friend-id.png')),
    true,
  );
});

test('ScreenshotManager rejects traversal before calling the capture adapter', async (context) => {
  const root = temporaryDirectory(context);
  let captureCount = 0;
  const manager = new ScreenshotManager(root, {
    capture: async () => {
      captureCount += 1;
    },
  });

  const result = await manager.capture({
    businessDate: parseBusinessDate('2026-08-23'),
    runId: '../../browser-profile',
    eventType: 'SELECTOR_FAILURE',
  });
  assert.deepEqual(result, { status: 'FAILED', errorCode: 'SCREENSHOT_CAPTURE_FAILED' });
  assert.equal(captureCount, 0);
  assert.equal(existsSync(path.join(root, '..', 'browser-profile')), false);
});

test('ScreenshotManager contains capture failures as observability results', async (context) => {
  const root = temporaryDirectory(context);
  const result = await new ScreenshotManager(root, {
    capture: async () => {
      throw new Error('fixture capture failed');
    },
  }).capture({
    businessDate: parseBusinessDate('2026-08-23'),
    runId: 'run-id',
    eventType: 'TASK_FAILED',
  });

  assert.deepEqual(result, { status: 'FAILED', errorCode: 'SCREENSHOT_CAPTURE_FAILED' });
});

test('ScreenshotManager does not follow a pre-existing directory symlink', async (context) => {
  const root = temporaryDirectory(context);
  const screenshots = path.join(root, 'screenshots');
  const profile = path.join(root, 'browser-profile');
  mkdirSync(screenshots);
  mkdirSync(profile);
  symlinkSync(profile, path.join(screenshots, '2026-08-23'));
  const result = await new ScreenshotManager(screenshots, {
    capture: async (absolutePath) => writeFileSync(absolutePath, 'must not be written'),
  }).capture({
    businessDate: parseBusinessDate('2026-08-23'),
    runId: 'run-id',
    eventType: 'SELECTOR_FAILURE',
  });

  assert.equal(result.status, 'FAILED');
  assert.equal(existsSync(path.join(profile, 'run-id/selector-failure.png')), false);
});

test('controlled local Playwright page produces a real screenshot', async (context) => {
  const root = temporaryDirectory(context);
  const session = browserSession(root);
  context.after(() => session.close());
  const { page } = await session.start();
  await page.setContent('<main><h1>Controlled Evidence Page</h1></main>');
  const result = await new ScreenshotManager(
    path.join(root, 'screenshots'),
    new PlaywrightScreenshotCapture(() => session.getPage()),
  ).capture({
    businessDate: parseBusinessDate('2026-08-23'),
    runId: 'run-id',
    eventType: 'SELECTOR_FAILURE',
  });

  assert.equal(result.status, 'CAPTURED');
  const absolutePath = path.join(root, 'screenshots/2026-08-23/run-id/selector-failure.png');
  assert.equal(existsSync(absolutePath), true);
  assert.ok(readFileSync(absolutePath).byteLength > 0);
  await session.close();
});

class RecordingTraceCapture implements TraceCapture {
  startCount = 0;
  stopPaths: Array<string | undefined> = [];
  failStart = false;
  failStop = false;

  async start(): Promise<void> {
    this.startCount += 1;
    if (this.failStart) throw new Error('fixture trace start failed');
  }

  async stop(absolutePath?: string): Promise<void> {
    this.stopPaths.push(absolutePath);
    if (this.failStop) throw new Error('fixture trace stop failed');
    if (absolutePath !== undefined) writeFileSync(absolutePath, 'fictional trace');
  }
}

const traceRequest = {
  businessDate: parseBusinessDate('2026-08-23'),
  runId: 'run-id',
  eventType: 'TASK_FAILED' as const,
};

test('TRACE_MODE off never starts or saves Trace', async (context) => {
  const capture = new RecordingTraceCapture();
  const manager = new TraceManager('off', temporaryDirectory(context), capture);

  assert.deepEqual(await manager.start('run-id'), { status: 'DISABLED' });
  assert.deepEqual(await manager.finish(traceRequest, true), { status: 'NOT_STARTED' });
  assert.equal(capture.startCount, 0);
  assert.equal(capture.stopPaths.length, 0);
});

test('on-failure discards a successful Run Trace', async (context) => {
  const capture = new RecordingTraceCapture();
  const manager = new TraceManager('on-failure', temporaryDirectory(context), capture);

  assert.deepEqual(await manager.start('run-id'), { status: 'STARTED' });
  assert.deepEqual(await manager.finish(traceRequest, false), { status: 'DISCARDED' });
  assert.deepEqual(capture.stopPaths, [undefined]);
});

test('on-failure saves a failed Run Trace using a safe relative path', async (context) => {
  const root = temporaryDirectory(context);
  const capture = new RecordingTraceCapture();
  const manager = new TraceManager('on-failure', root, capture);

  await manager.start('run-id');
  const result = await manager.finish(traceRequest, true);
  assert.deepEqual(result, {
    status: 'SAVED',
    relativePath: 'traces/2026-08-23/run-id/task-failed.zip',
  });
  assert.equal(existsSync(path.join(root, '2026-08-23/run-id/task-failed.zip')), true);
});

test('always saves Trace for a successful Run', async (context) => {
  const capture = new RecordingTraceCapture();
  const manager = new TraceManager('always', temporaryDirectory(context), capture);

  await manager.start('run-id');
  assert.equal((await manager.finish(traceRequest, false)).status, 'SAVED');
  assert.equal(capture.stopPaths.length, 1);
});

test('TraceManager rejects unsafe paths and contains start/save failures', async (context) => {
  const capture = new RecordingTraceCapture();
  const manager = new TraceManager('on-failure', temporaryDirectory(context), capture);
  assert.deepEqual(await manager.start('../../browser-profile'), {
    status: 'FAILED',
    errorCode: 'TRACE_START_FAILED',
  });
  capture.failStart = true;
  assert.deepEqual(await manager.start('start-failure'), {
    status: 'FAILED',
    errorCode: 'TRACE_START_FAILED',
  });
  capture.failStart = false;
  capture.failStop = true;
  await manager.start('run-id');
  assert.deepEqual(await manager.finish(traceRequest, true), {
    status: 'FAILED',
    errorCode: 'TRACE_SAVE_FAILED',
  });
});

test('TraceManager does not save through a pre-existing directory symlink', async (context) => {
  const root = temporaryDirectory(context);
  const traces = path.join(root, 'traces');
  const profile = path.join(root, 'browser-profile');
  mkdirSync(traces);
  mkdirSync(profile);
  symlinkSync(profile, path.join(traces, '2026-08-23'));
  const capture = new RecordingTraceCapture();
  const manager = new TraceManager('always', traces, capture);
  await manager.start('run-id');

  assert.equal((await manager.finish(traceRequest, true)).status, 'FAILED');
  assert.equal(existsSync(path.join(profile, 'run-id/task-failed.zip')), false);
});

test('controlled local Playwright context produces a real Trace zip', async (context) => {
  const root = temporaryDirectory(context);
  const session = browserSession(root);
  context.after(() => session.close());
  const { page } = await session.start();
  const manager = new TraceManager(
    'always',
    path.join(root, 'traces'),
    new PlaywrightTraceCapture(() => session.getContext().tracing),
  );
  await manager.start('run-id');
  await page.setContent('<main><h1>Controlled Trace Page</h1></main>');
  await page.locator('h1').click();
  const result = await manager.finish(traceRequest, true);

  assert.equal(result.status, 'SAVED');
  const tracePath = path.join(root, 'traces/2026-08-23/run-id/task-failed.zip');
  assert.equal(existsSync(tracePath), true);
  assert.ok(readFileSync(tracePath).byteLength > 0);
  await session.close();
});

test('RetentionManager removes only expired screenshot and Trace files', (context) => {
  const root = temporaryDirectory(context);
  const screenshots = path.join(root, 'screenshots');
  const traces = path.join(root, 'traces');
  const profile = path.join(root, 'browser-profile');
  for (const directory of [screenshots, traces, profile]) mkdirSync(directory, { recursive: true });
  const oldScreenshot = path.join(screenshots, 'old.png');
  const recentScreenshot = path.join(screenshots, 'recent.png');
  const oldTrace = path.join(traces, 'old.zip');
  const recentTrace = path.join(traces, 'recent.zip');
  const profileFixture = path.join(profile, 'profile-state.json');
  for (const file of [oldScreenshot, recentScreenshot, oldTrace, recentTrace, profileFixture]) {
    writeFileSync(file, 'fixture');
  }
  const old = new Date('2026-07-01T00:00:00.000Z');
  const recent = new Date('2026-08-22T00:00:00.000Z');
  utimesSync(oldScreenshot, old, old);
  utimesSync(oldTrace, old, old);
  utimesSync(recentScreenshot, recent, recent);
  utimesSync(recentTrace, recent, recent);

  const result = new RetentionManager({
    screenshotRoot: screenshots,
    traceRoot: traces,
    screenshotRetentionDays: 14,
    traceRetentionDays: 7,
  }).cleanup(new Date('2026-08-23T12:00:00.000Z'));

  assert.equal(result.removedFiles.length, 2);
  assert.equal(existsSync(oldScreenshot), false);
  assert.equal(existsSync(oldTrace), false);
  assert.equal(existsSync(recentScreenshot), true);
  assert.equal(existsSync(recentTrace), true);
  assert.equal(existsSync(profileFixture), true);
});

test('RetentionManager does not follow symlinks outside evidence roots', (context) => {
  const root = temporaryDirectory(context);
  const screenshots = path.join(root, 'screenshots');
  const traces = path.join(root, 'traces');
  mkdirSync(screenshots);
  mkdirSync(traces);
  const external = path.join(root, 'browser-profile.png');
  writeFileSync(external, 'keep');
  const link = path.join(screenshots, 'external.png');
  symlinkSync(external, link);

  new RetentionManager({
    screenshotRoot: screenshots,
    traceRoot: traces,
    screenshotRetentionDays: 1,
    traceRetentionDays: 1,
  }).cleanup(new Date('2026-08-23T12:00:00.000Z'));

  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.equal(existsSync(external), true);
});

test('RetentionManager rejects a symlinked evidence root', (context) => {
  const root = temporaryDirectory(context);
  const profile = path.join(root, 'browser-profile');
  const screenshotLink = path.join(root, 'screenshots');
  const traces = path.join(root, 'traces');
  mkdirSync(profile);
  mkdirSync(traces);
  const protectedFile = path.join(profile, 'protected.png');
  writeFileSync(protectedFile, 'keep');
  const old = new Date('2000-01-01T00:00:00.000Z');
  utimesSync(protectedFile, old, old);
  symlinkSync(profile, screenshotLink);

  const result = new RetentionManager({
    screenshotRoot: screenshotLink,
    traceRoot: traces,
    screenshotRetentionDays: 1,
    traceRetentionDays: 1,
  }).cleanup(new Date('2026-08-23T12:00:00.000Z'));

  assert.equal(result.errorCount, 1);
  assert.equal(existsSync(protectedFile), true);
});

test('RetentionManager contains cleanup failure and reports observability error', (context) => {
  const root = temporaryDirectory(context);
  const screenshots = path.join(root, 'screenshots');
  const traces = path.join(root, 'traces');
  mkdirSync(screenshots);
  mkdirSync(traces);
  const oldScreenshot = path.join(screenshots, 'old.png');
  writeFileSync(oldScreenshot, 'fixture');
  const old = new Date('2026-07-01T00:00:00.000Z');
  utimesSync(oldScreenshot, old, old);
  let errorCount = 0;

  const result = new RetentionManager({
    screenshotRoot: screenshots,
    traceRoot: traces,
    screenshotRetentionDays: 1,
    traceRetentionDays: 1,
    removeFile: () => {
      throw new Error('fixture delete failed');
    },
    onError: () => {
      errorCount += 1;
    },
  }).cleanup(new Date('2026-08-23T12:00:00.000Z'));

  assert.equal(result.errorCount, 1);
  assert.equal(errorCount, 1);
  assert.equal(existsSync(oldScreenshot), true);
});
