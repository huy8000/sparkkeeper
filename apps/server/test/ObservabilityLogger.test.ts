import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import test, { type TestContext } from 'node:test';

import { parseBusinessDate } from '@sparkkeeper/shared';

import {
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_SCREENSHOT_RETENTION_DAYS,
  DEFAULT_TRACE_RETENTION_DAYS,
  ObservabilityConfigError,
  resolveObservabilityConfig,
} from '../src/config/ObservabilityConfig.js';
import { DailyRotatingFileStream } from '../src/observability/DailyRotatingFileStream.js';
import {
  createProductionRuntimeLogger,
  createRuntimeLogger,
  type RuntimeLogEvent,
} from '../src/observability/RuntimeLogger.js';

class MemoryStream extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  lines(): Array<Record<string, unknown>> {
    return this.chunks
      .join('')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

function temporaryDirectory(context: TestContext): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-observability-test-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('observability config resolves bounded defaults and DATA_DIR evidence roots', () => {
  const config = resolveObservabilityConfig({}, '/srv/sparkkeeper');

  assert.equal(config.logLevel, 'info');
  assert.equal(config.traceMode, 'off');
  assert.equal(config.logRetentionDays, DEFAULT_LOG_RETENTION_DAYS);
  assert.equal(config.screenshotRetentionDays, DEFAULT_SCREENSHOT_RETENTION_DAYS);
  assert.equal(config.traceRetentionDays, DEFAULT_TRACE_RETENTION_DAYS);
  assert.equal(config.logDirectory, '/srv/sparkkeeper/logs');
  assert.equal(config.screenshotRoot, '/srv/sparkkeeper/data/screenshots');
  assert.equal(config.traceRoot, '/srv/sparkkeeper/data/traces');
});

test('observability config accepts explicit safe values', () => {
  const config = resolveObservabilityConfig(
    {
      DATA_DIR: 'runtime-data',
      LOG_DIR: 'runtime-logs',
      LOG_LEVEL: 'debug',
      LOG_RETENTION_DAYS: '30',
      SCREENSHOT_RETENTION_DAYS: '21',
      TRACE_MODE: 'on-failure',
      TRACE_RETENTION_DAYS: '5',
    },
    '/srv/sparkkeeper',
  );

  assert.equal(config.logLevel, 'debug');
  assert.equal(config.traceMode, 'on-failure');
  assert.equal(config.logRetentionDays, 30);
  assert.equal(config.screenshotRetentionDays, 21);
  assert.equal(config.traceRetentionDays, 5);
  assert.equal(config.logDirectory, '/srv/sparkkeeper/runtime-logs');
  assert.equal(config.screenshotRoot, '/srv/sparkkeeper/runtime-data/screenshots');
});

test('observability config rejects invalid log, trace, and retention values', () => {
  for (const environment of [
    { LOG_LEVEL: 'verbose' },
    { TRACE_MODE: 'sometimes' },
    { LOG_RETENTION_DAYS: '0' },
    { SCREENSHOT_RETENTION_DAYS: '-1' },
    { TRACE_RETENTION_DAYS: 'abc' },
    { TRACE_RETENTION_DAYS: '366' },
  ]) {
    assert.throws(() => resolveObservabilityConfig(environment), ObservabilityConfigError);
  }
});

test('Pino emits required structured context with a safe fixed summary', async () => {
  const destination = new MemoryStream();
  const logger = createRuntimeLogger({ level: 'debug', stdout: destination });
  logger.emit('error', {
    eventType: 'SELECTOR_FAILURE',
    runId: 'run-id',
    accountId: 'account-id',
    friendId: 'friend-id',
    attempt: 2,
    businessDate: parseBusinessDate('2026-08-23'),
    errorCode: 'SELECTOR_FAILURE',
  });
  await logger.close();

  const [line] = destination.lines();
  assert.equal(typeof line?.time, 'number');
  assert.equal(line?.level, 50);
  assert.equal(line?.eventType, 'SELECTOR_FAILURE');
  assert.equal(line?.runId, 'run-id');
  assert.equal(line?.accountId, 'account-id');
  assert.equal(line?.friendId, 'friend-id');
  assert.equal(line?.attempt, 2);
  assert.equal(line?.errorCode, 'SELECTOR_FAILURE');
  assert.equal(line?.message, 'Page selector resolution failed');
});

test('child logger adds account, Run, Friend, and Attempt context', async () => {
  const destination = new MemoryStream();
  const logger = createRuntimeLogger({ level: 'info', stdout: destination });
  const account = logger.child({ accountId: 'account-id' });
  const run = account.child({ runId: 'run-id', businessDate: parseBusinessDate('2026-08-23') });
  const friend = run.child({ friendId: 'friend-id' });
  friend.child({ attempt: 3 }).emit('warn', {
    eventType: 'RETRY_WAIT',
    errorCode: 'NETWORK_TRANSIENT',
  });
  await logger.close();

  const [line] = destination.lines();
  assert.equal(line?.accountId, 'account-id');
  assert.equal(line?.runId, 'run-id');
  assert.equal(line?.friendId, 'friend-id');
  assert.equal(line?.attempt, 3);
});

test('allowlist and Pino redaction prevent sensitive fields and raw Error data', async () => {
  const destination = new MemoryStream();
  const logger = createRuntimeLogger({ level: 'info', stdout: destination });
  const attempted = {
    eventType: 'TASK_FAILED',
    errorCode: 'CONFIG_INVALID',
    cookie: 'secret-cookie-value',
    Authorization: 'Bearer fake-secret',
    token: 'fake-token',
    password: 'fake-password',
    messageText: 'private-test-message',
    displayName: 'Private Test User',
    err: new Error('unsafe stack detail'),
  } as RuntimeLogEvent;
  logger.emit('error', attempted);
  await logger.close();

  const serialized = destination.chunks.join('');
  for (const forbidden of [
    'secret-cookie-value',
    'Bearer fake-secret',
    'fake-token',
    'fake-password',
    'private-test-message',
    'Private Test User',
    'unsafe stack detail',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(destination.lines()[0]?.message, 'Task finished with failure');
});

test('production logger writes the same structured event to stdout and a file', async (context) => {
  const root = temporaryDirectory(context);
  const stdout = new MemoryStream();
  const config = resolveObservabilityConfig(
    { LOG_DIR: root, LOG_LEVEL: 'info', LOG_RETENTION_DAYS: '14' },
    root,
  );
  const logger = createProductionRuntimeLogger(config, stdout, {
    now: () => new Date('2026-08-23T10:00:00.000Z'),
  });
  logger.emit('info', { eventType: 'RUN_STARTED', runId: 'run-id', accountId: 'account-id' });
  await logger.close();

  const file = path.join(root, 'sparkkeeper-2026-08-23.log');
  assert.equal(existsSync(file), true);
  const fileLine = JSON.parse(readFileSync(file, 'utf8').trim()) as Record<string, unknown>;
  assert.equal(fileLine.eventType, 'RUN_STARTED');
  assert.equal(stdout.lines()[0]?.eventType, 'RUN_STARTED');
});

test('daily rotation deterministically creates a new file without sleeping', async (context) => {
  const root = temporaryDirectory(context);
  let now = new Date('2026-08-23T23:59:59.000Z');
  const file = new DailyRotatingFileStream(root, 14, { now: () => now });
  const logger = createRuntimeLogger({ level: 'info', fileDestination: file });
  logger.emit('info', { eventType: 'RUN_STARTED' });
  now = new Date('2026-08-24T00:00:01.000Z');
  logger.emit('info', { eventType: 'RUN_FINISHED' });
  await logger.close();

  assert.equal(existsSync(path.join(root, 'sparkkeeper-2026-08-23.log')), true);
  assert.equal(existsSync(path.join(root, 'sparkkeeper-2026-08-24.log')), true);
});

test('log retention deletes expired segments but preserves current and unrelated files', async (context) => {
  const root = temporaryDirectory(context);
  writeFileSync(path.join(root, 'sparkkeeper-2026-08-01.log'), 'old\n');
  writeFileSync(path.join(root, 'notes.txt'), 'keep\n');
  const file = new DailyRotatingFileStream(root, 14, {
    now: () => new Date('2026-08-23T10:00:00.000Z'),
  });
  const logger = createRuntimeLogger({ level: 'info', fileDestination: file });
  logger.emit('info', { eventType: 'RUN_STARTED' });
  await logger.close();

  assert.equal(existsSync(path.join(root, 'sparkkeeper-2026-08-01.log')), false);
  assert.equal(existsSync(path.join(root, 'sparkkeeper-2026-08-23.log')), true);
  assert.equal(existsSync(path.join(root, 'notes.txt')), true);
});

test('log rotation rejects a symlinked log root', (context) => {
  const root = temporaryDirectory(context);
  const protectedRoot = path.join(root, 'browser-profile');
  const logLink = path.join(root, 'logs');
  mkdirSync(protectedRoot);
  symlinkSync(protectedRoot, logLink);

  assert.throws(
    () => new DailyRotatingFileStream(logLink, 14),
    /must not traverse a symbolic link/i,
  );
  assert.equal(existsSync(path.join(protectedRoot, 'sparkkeeper-2026-08-23.log')), false);
});
