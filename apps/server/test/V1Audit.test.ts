import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  SendRecordRepository,
  type V1AuditDayData,
} from '@sparkkeeper/database';
import { parseBusinessDate } from '@sparkkeeper/shared';

import {
  parseV1AuditDates,
  renderV1Audit,
  runV1Audit,
  summarizeV1AuditDay,
} from '../src/readiness/V1Audit.js';

test('V1 audit reports a clean multiple-Friend SUCCESS day with safe counts', (context) => {
  const fixture = successDayFixture(context);
  const beforeHash = sha256(fixture.databasePath);

  const result = runV1Audit({
    environment: fixture.environment,
    workingDirectory: fixture.root,
    args: ['--date', '2026-08-23'],
  });
  const output = renderV1Audit(result);

  assert.equal(result.days.length, 1);
  assert.equal(result.days[0]!.gateStatus, 'PASS');
  assert.equal(result.days[0]!.dailyRunStatus, 'SUCCESS');
  assert.equal(result.days[0]!.enabledFriendCount, 2);
  assert.equal(result.days[0]!.sendRecordCount, 2);
  assert.equal(result.days[0]!.successCount, 2);
  assert.equal(result.days[0]!.duplicateSendRecordViolations, 0);
  assert.equal(result.days[0]!.duplicateSuccessViolations, 0);
  assert.equal(result.days[0]!.log.present, true);
  assert.equal(result.days[0]!.log.entryCount, 1);
  assert.equal(result.days[0]!.log.parseErrorCount, 0);
  assert.equal(output.includes('Alice'), false);
  assert.equal(output.includes('Bob'), false);
  assert.equal(output.includes('Hello'), false);
  assert.equal(sha256(fixture.databasePath), beforeHash);
});

test('V1 audit accepts idempotent same-day records for distinct Friends', () => {
  const summary = summarizeV1AuditDay(successData(), filesystem());

  assert.equal(summary.duplicateSendRecordViolations, 0);
  assert.equal(summary.duplicateSuccessViolations, 0);
  assert.equal(summary.gateStatus, 'PASS');
});

test('V1 audit marks a final FAILED record day as FAILED', () => {
  const summary = summarizeV1AuditDay(
    successData({
      dailyRunStatus: 'FAILED',
      sendRecords: [
        { friendId: 'friend-a', status: 'SUCCESS' },
        { friendId: 'friend-b', status: 'FAILED' },
      ],
      systemEvents: [
        {
          eventType: 'TASK_FAILED',
          screenshotPath: 'screenshots/2026-08-23/run/task-failed.png',
          tracePath: null,
        },
      ],
    }),
    filesystem({ evidenceExists: () => true }),
  );

  assert.equal(summary.failedCount, 1);
  assert.equal(summary.gateStatus, 'FAILED');
});

test('V1 audit marks RETRY_WAIT as INCOMPLETE', () => {
  const summary = summarizeV1AuditDay(
    successData({
      dailyRunStatus: 'RUNNING',
      sendRecords: [
        { friendId: 'friend-a', status: 'SUCCESS' },
        { friendId: 'friend-b', status: 'RETRY_WAIT' },
      ],
    }),
    filesystem(),
  );

  assert.equal(summary.retryWaitCount, 1);
  assert.equal(summary.gateStatus, 'INCOMPLETE');
});

test('V1 audit marks RUNNING SendRecords as INCOMPLETE', () => {
  const summary = summarizeV1AuditDay(
    successData({
      dailyRunStatus: 'RUNNING',
      sendRecords: [
        { friendId: 'friend-a', status: 'SUCCESS' },
        { friendId: 'friend-b', status: 'RUNNING' },
      ],
    }),
    filesystem(),
  );

  assert.equal(summary.runningCount, 1);
  assert.equal(summary.gateStatus, 'INCOMPLETE');
});

test('V1 audit makes DELIVERY_UNKNOWN visible and fails the day', () => {
  const summary = summarizeV1AuditDay(
    successData({
      dailyRunStatus: 'FAILED',
      sendRecords: [
        { friendId: 'friend-a', status: 'SUCCESS' },
        { friendId: 'friend-b', status: 'DELIVERY_UNKNOWN' },
      ],
      systemEvents: [
        {
          eventType: 'DELIVERY_UNKNOWN',
          screenshotPath: 'screenshots/2026-08-23/run/delivery-unknown.png',
          tracePath: null,
        },
      ],
    }),
    filesystem({ evidenceExists: () => true }),
  );

  assert.equal(summary.deliveryUnknownCount, 1);
  assert.equal(summary.gateStatus, 'FAILED');
});

test('V1 audit records AUTH_EXPIRED as a failed validation day with its SystemEvent', () => {
  const summary = summarizeV1AuditDay(
    successData({
      dailyRunStatus: 'AUTH_EXPIRED',
      sendRecords: [],
      systemEvents: [
        {
          eventType: 'AUTH_EXPIRED',
          screenshotPath: 'screenshots/2026-08-23/run/auth-expired.png',
          tracePath: null,
        },
      ],
    }),
    filesystem({ evidenceExists: () => true }),
  );

  assert.equal(summary.authExpiredEventCount, 1);
  assert.equal(summary.gateStatus, 'FAILED');
});

test('V1 audit detects the required SystemEvent for a final task failure', () => {
  const summary = summarizeV1AuditDay(
    successData({
      dailyRunStatus: 'FAILED',
      sendRecords: [{ friendId: 'friend-a', status: 'FAILED' }],
      enabledFriendCount: 1,
      systemEvents: [
        {
          eventType: 'TASK_FAILED',
          screenshotPath: 'screenshots/2026-08-23/run/task-failed.png',
          tracePath: null,
        },
      ],
    }),
    filesystem({ evidenceExists: () => true }),
  );

  assert.equal(summary.taskFailedEventCount, 1);
  assert.equal(summary.missingSystemEventCount, 0);
});

test('V1 audit counts existing evidence without reading its contents', () => {
  const summary = summarizeV1AuditDay(
    successData({
      dailyRunStatus: 'AUTH_EXPIRED',
      sendRecords: [],
      systemEvents: [
        {
          eventType: 'AUTH_EXPIRED',
          screenshotPath: 'screenshots/2026-08-23/run/auth-expired.png',
          tracePath: null,
        },
      ],
    }),
    filesystem({ evidenceExists: () => true }),
  );

  assert.equal(summary.evidenceCount, 1);
  assert.equal(summary.missingEvidenceCount, 0);
});

test('V1 audit detects missing required evidence', () => {
  const summary = summarizeV1AuditDay(
    successData({
      dailyRunStatus: 'AUTH_EXPIRED',
      sendRecords: [],
      systemEvents: [{ eventType: 'AUTH_EXPIRED', screenshotPath: null, tracePath: null }],
    }),
    filesystem(),
  );

  assert.equal(summary.missingEvidenceCount, 1);
  assert.equal(summary.gateStatus, 'FAILED');
});

test('V1 audit fails a day when its structured log file is missing', () => {
  const summary = summarizeV1AuditDay(
    successData(),
    filesystem({ log: { present: false, entryCount: 0, parseErrorCount: 0 } }),
  );

  assert.equal(summary.log.present, false);
  assert.equal(summary.gateStatus, 'FAILED');
});

test('V1 audit fails a day when structured JSONL contains parse errors', () => {
  const summary = summarizeV1AuditDay(
    successData(),
    filesystem({ log: { present: true, entryCount: 2, parseErrorCount: 1 } }),
  );

  assert.equal(summary.log.parseErrorCount, 1);
  assert.equal(summary.gateStatus, 'FAILED');
});

test('V1 audit detects duplicate Friend/businessDate records in a controlled read fixture', () => {
  const summary = summarizeV1AuditDay(
    successData({
      sendRecords: [
        { friendId: 'friend-a', status: 'SUCCESS' },
        { friendId: 'friend-a', status: 'FAILED' },
      ],
      enabledFriendCount: 1,
    }),
    filesystem(),
  );

  assert.equal(summary.duplicateSendRecordViolations, 1);
  assert.equal(summary.gateStatus, 'FAILED');
});

test('V1 audit detects duplicate SUCCESS records in a controlled read fixture', () => {
  const summary = summarizeV1AuditDay(
    successData({
      sendRecords: [
        { friendId: 'friend-a', status: 'SUCCESS' },
        { friendId: 'friend-a', status: 'SUCCESS' },
      ],
      enabledFriendCount: 1,
    }),
    filesystem(),
  );

  assert.equal(summary.duplicateSuccessViolations, 1);
  assert.equal(summary.gateStatus, 'FAILED');
});

test('V1 audit expands an inclusive BusinessDate range', () => {
  assert.deepEqual(parseV1AuditDates(['--from', '2026-08-21', '--to', '2026-08-23']), [
    '2026-08-21',
    '2026-08-22',
    '2026-08-23',
  ]);
});

test('V1 audit accepts the pnpm argument separator', () => {
  assert.deepEqual(parseV1AuditDates(['--', '--date', '2026-08-23']), ['2026-08-23']);
});

test('V1 audit rendering never exposes an injected messageText field', () => {
  const data = {
    ...successData(),
    messageText: 'Synthetic private message',
  } as V1AuditDayData & { readonly messageText: string };
  const result = { days: [summarizeV1AuditDay(data, filesystem())], passed: true };

  const output = renderV1Audit(result);

  assert.equal(output.includes('Synthetic private message'), false);
  assert.equal(output.includes('messageText'), false);
});

test('V1 audit rejects invalid or ambiguous date arguments', () => {
  assert.throws(() => parseV1AuditDates([]), /Use --date/);
  assert.throws(
    () => parseV1AuditDates(['--date', '2026-08-23', '--from', '2026-08-22']),
    /cannot be combined/,
  );
  assert.throws(
    () => parseV1AuditDates(['--from', '2026-08-24', '--to', '2026-08-23']),
    /must not be after/,
  );
});

interface AuditFixture {
  readonly root: string;
  readonly databasePath: string;
  readonly environment: Record<string, string>;
}

function successDayFixture(context: TestContext): AuditFixture {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-v1-audit-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, 'data');
  const logDirectory = path.join(root, 'logs');
  mkdirSync(logDirectory, { recursive: true });
  const databasePath = path.join(dataDirectory, 'sparkkeeper.db');
  const client = createDatabase({ databasePath });
  client.migrate();
  const now = new Date('2026-08-23T01:30:00.000Z');
  const businessDate = parseBusinessDate('2026-08-23');
  const account = new AccountRepository(client).create({ name: 'Test Account' });
  const friends = new FriendRepository(client);
  const alice = friends.create({ accountId: account.id, displayName: 'Alice' });
  const bob = friends.create({ accountId: account.id, displayName: 'Bob' });
  const template = new MessageTemplateRepository(client).create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  const dailyRuns = new DailyRunRepository(client);
  const run = dailyRuns.createOrGet({ accountId: account.id, businessDate, now });
  dailyRuns.markRunning(run.id, now);
  const sendRecords = new SendRecordRepository(client);
  for (const friend of [alice, bob]) {
    const prepared = sendRecords.prepare({
      dailyRunId: run.id,
      friendId: friend.id,
      businessDate,
      messageTemplateId: template.id,
      messageText: 'Hello',
      now,
    }).record;
    const claim = sendRecords.claimInitialAttempt(prepared.id, now, 3);
    assert.equal(claim.type, 'CLAIMED');
    sendRecords.markSendActionStarted(prepared.id, now);
    sendRecords.markSuccess(prepared.id, now);
  }
  dailyRuns.markSuccess(run.id, now);
  client.close();
  writeFileSync(
    path.join(logDirectory, 'sparkkeeper-2026-08-23.log'),
    `${JSON.stringify({ level: 30, eventType: 'RUN_FINISHED' })}\n`,
  );
  return {
    root,
    databasePath,
    environment: {
      DATA_DIR: dataDirectory,
      LOG_DIR: logDirectory,
      SCHEDULER_ACCOUNT_ID: account.id,
      SCHEDULER_ENABLED: 'false',
      SCHEDULER_ALLOW_REAL_SEND: 'false',
    },
  };
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function successData(overrides: Partial<V1AuditDayData> = {}): V1AuditDayData {
  return {
    businessDate: parseBusinessDate('2026-08-23'),
    dailyRunStatus: 'SUCCESS',
    enabledFriendCount: 2,
    sendRecords: [
      { friendId: 'friend-a', status: 'SUCCESS' },
      { friendId: 'friend-b', status: 'SUCCESS' },
    ],
    systemEvents: [],
    ...overrides,
  };
}

function filesystem(
  overrides: Partial<{
    readonly evidenceExists: (relativePath: string) => boolean;
    readonly log: {
      readonly present: boolean;
      readonly entryCount: number;
      readonly parseErrorCount: number;
    };
  }> = {},
) {
  return {
    evidenceExists: () => false,
    log: { present: true, entryCount: 1, parseErrorCount: 0 },
    ...overrides,
  };
}
