import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BrowserSession } from '@sparkkeeper/automation';
import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  SystemEventRepository,
  type DatabaseClient,
} from '@sparkkeeper/database';
import { parseBusinessDate } from '@sparkkeeper/shared';

import { ProductionRuntimeObserver } from '../src/observability/ProductionRuntimeObserver.js';
import { RetentionManager } from '../src/observability/RetentionManager.js';
import {
  createProductionRuntimeLogger,
  type RuntimeLogEvent,
  type RuntimeLogger,
} from '../src/observability/RuntimeLogger.js';
import {
  PlaywrightScreenshotCapture,
  ScreenshotManager,
} from '../src/observability/ScreenshotManager.js';
import { PlaywrightTraceCapture, TraceManager } from '../src/observability/TraceManager.js';
import { resolveObservabilityConfig } from '../src/config/ObservabilityConfig.js';

const businessDate = parseBusinessDate('2026-08-23');
const now = new Date('2026-08-23T12:00:00.000Z');
const runtimeRoot = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-observability-smoke-'));
const dataRoot = path.join(runtimeRoot, 'data');
const logRoot = path.join(runtimeRoot, 'logs');
const databasePath = path.join(dataRoot, 'sparkkeeper.db');
const session = new BrowserSession({
  userDataDir: path.join(runtimeRoot, 'controlled-browser-profile'),
  headless: true,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 800, height: 600 },
});
let client: DatabaseClient | undefined;
let logger: RuntimeLogger | undefined;

try {
  client = createDatabase({ databasePath });
  assert.equal(client.migrate().appliedMigrationCount, 8);
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const friend = new FriendRepository(client).create({
    accountId: account.id,
    displayName: 'Test User',
  });
  const run = new DailyRunRepository(client).createOrGet({
    accountId: account.id,
    businessDate,
    now,
  });
  const { page } = await session.start();
  await page.setContent('<main><h1>Controlled Observability Page</h1></main>');

  const config = resolveObservabilityConfig(
    {
      DATA_DIR: dataRoot,
      LOG_DIR: logRoot,
      LOG_LEVEL: 'info',
      LOG_RETENTION_DAYS: '14',
      SCREENSHOT_RETENTION_DAYS: '14',
      TRACE_MODE: 'on-failure',
      TRACE_RETENTION_DAYS: '7',
    },
    runtimeRoot,
  );
  logger = createProductionRuntimeLogger(config, undefined, { now: () => now });
  const systemEvents = new SystemEventRepository(client);
  const retention = new RetentionManager({
    screenshotRoot: config.screenshotRoot,
    traceRoot: config.traceRoot,
    screenshotRetentionDays: config.screenshotRetentionDays,
    traceRetentionDays: config.traceRetentionDays,
  });
  const observer = new ProductionRuntimeObserver({
    logger,
    systemEvents,
    screenshots: new ScreenshotManager(
      config.screenshotRoot,
      new PlaywrightScreenshotCapture(() => session.getPage()),
    ),
    traces: new TraceManager(
      config.traceMode,
      config.traceRoot,
      new PlaywrightTraceCapture(() => session.getContext().tracing),
    ),
    retention,
  });
  const context = { accountId: account.id, runId: run.id, businessDate };
  const attemptedSecrets = {
    ...context,
    eventType: 'RUN_STARTED',
    cookie: 'secret-cookie-value',
    Authorization: 'Bearer fake-secret',
    token: 'fake-token',
    messageText: 'private-test-message',
  } as RuntimeLogEvent;
  logger.emit('info', attemptedSecrets);
  await observer.startRun(context);
  await observer.observe({
    ...context,
    friendId: friend.id,
    attempt: 1,
    eventType: 'RETRY_WAIT',
    level: 'warn',
    errorCode: 'NETWORK_TRANSIENT',
  });
  await observer.observe({
    ...context,
    friendId: friend.id,
    attempt: 1,
    eventType: 'SELECTOR_FAILURE',
    level: 'error',
    errorCode: 'SELECTOR_FAILURE',
  });
  await observer.finishRun(context, 'FAILED', true);

  const selectorEvent = systemEvents
    .listByRunId(run.id)
    .find((event) => event.eventType === 'SELECTOR_FAILURE');
  const finalEvent = systemEvents
    .listByRunId(run.id)
    .find((event) => event.eventType === 'TASK_FAILED');
  assert.ok(selectorEvent?.screenshotPath?.startsWith('screenshots/'));
  assert.ok(finalEvent?.tracePath?.startsWith('traces/'));
  assert.equal(path.isAbsolute(selectorEvent.screenshotPath), false);
  assert.equal(path.isAbsolute(finalEvent.tracePath), false);

  const oldScreenshot = path.join(config.screenshotRoot, 'old.png');
  const oldTrace = path.join(config.traceRoot, 'old.zip');
  mkdirSync(config.screenshotRoot, { recursive: true });
  mkdirSync(config.traceRoot, { recursive: true });
  writeFileSync(oldScreenshot, 'old screenshot');
  writeFileSync(oldTrace, 'old trace');
  const expired = new Date('2000-01-01T00:00:00.000Z');
  utimesSync(oldScreenshot, expired, expired);
  utimesSync(oldTrace, expired, expired);
  await observer.cleanup();
  assert.equal(existsSync(oldScreenshot), false);
  assert.equal(existsSync(oldTrace), false);

  await session.close();
  await logger.close();
  logger = undefined;
  client.close();
  client = createDatabase({ databasePath });
  assert.equal(client.migrate().appliedMigrationCount, 8);
  assert.equal(new SystemEventRepository(client).listByRunId(run.id).length >= 2, true);

  const logFile = path.join(logRoot, 'sparkkeeper-2026-08-23.log');
  const serializedLog = readFileSync(logFile, 'utf8');
  for (const forbidden of [
    'secret-cookie-value',
    'Bearer fake-secret',
    'fake-token',
    'private-test-message',
  ]) {
    assert.equal(serializedLog.includes(forbidden), false);
  }

  console.log('Structured logging: VERIFIED');
  console.log('Redaction: VERIFIED');
  console.log('Sensitive values found: 0');
  console.log('SystemEvent persistence: VERIFIED');
  console.log('Screenshot evidence: VERIFIED');
  console.log('Trace policy: VERIFIED');
  console.log('Retention: VERIFIED');
  console.log('Observability smoke: VERIFIED');
} finally {
  await session.close();
  await logger?.close();
  client?.close();
  rmSync(runtimeRoot, { recursive: true, force: true });
}
