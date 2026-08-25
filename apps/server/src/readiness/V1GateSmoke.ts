import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createDatabase,
  DailyRunRepository,
  executeMaintenanceCommand,
  SendRecordRepository,
  SystemEventRepository,
} from '@sparkkeeper/database';
import { parseBusinessDate } from '@sparkkeeper/shared';

import { renderV1Audit, runV1Audit } from './V1Audit.js';
import { renderV1Preflight, runV1Preflight } from './V1Preflight.js';

export function runV1GateSmoke(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-v1-gate-smoke-'));
  try {
    const dataDirectory = path.join(root, 'data');
    const profileDirectory = path.join(dataDirectory, 'browser-profile');
    const logDirectory = path.join(root, 'logs');
    mkdirSync(profileDirectory, { recursive: true });
    mkdirSync(logDirectory, { recursive: true });
    const databasePath = path.join(dataDirectory, 'sparkkeeper.db');
    const client = createDatabase({ databasePath });
    const migration = client.migrate();
    if (migration.appliedMigrationCount !== 8) throw new Error('Gate smoke migration mismatch.');

    const account = executeMaintenanceCommand(client, [
      'account',
      'create',
      '--name',
      'Test Account',
    ]);
    if (account.entity !== 'Account' || account.action !== 'CREATED')
      throw new Error('Gate smoke Account maintenance failed.');
    const alice = executeMaintenanceCommand(client, [
      'friend',
      'create',
      '--account-id',
      account.id,
      '--display-name',
      'Alice',
    ]);
    const bob = executeMaintenanceCommand(client, [
      'friend',
      'create',
      '--account-id',
      account.id,
      '--display-name',
      'Bob',
    ]);
    if (
      alice.entity !== 'Friend' ||
      alice.action !== 'CREATED' ||
      bob.entity !== 'Friend' ||
      bob.action !== 'CREATED'
    )
      throw new Error('Gate smoke Friend maintenance failed.');
    const template = executeMaintenanceCommand(client, [
      'template',
      'create',
      '--name',
      'Test Template',
      '--provider',
      'STATIC',
      '--message',
      'Hello',
    ]);
    if (template.entity !== 'MessageTemplate' || template.action !== 'CREATED')
      throw new Error('Gate smoke Template maintenance failed.');
    const schedule = executeMaintenanceCommand(client, [
      'schedule',
      'configure',
      '--account-id',
      account.id,
      '--start-time',
      '09:00',
      '--end-time',
      '10:00',
      '--timezone',
      'Asia/Shanghai',
      '--enabled',
      'true',
      '--max-attempts',
      '3',
      '--retry-interval-seconds',
      '60',
    ]);
    if (schedule.entity !== 'Schedule') throw new Error('Gate smoke Schedule maintenance failed.');

    const businessDate = parseBusinessDate('2026-08-23');
    const now = new Date('2026-08-23T01:30:00.000Z');
    const dailyRuns = new DailyRunRepository(client);
    const run = dailyRuns.createOrGet({ accountId: account.id, businessDate, now });
    dailyRuns.markRunning(run.id, now);
    const sendRecords = new SendRecordRepository(client);
    for (const friend of [alice, bob]) {
      const record = sendRecords.prepare({
        dailyRunId: run.id,
        friendId: friend.id,
        businessDate,
        messageTemplateId: template.id,
        messageText: 'Hello',
        now,
      }).record;
      if (sendRecords.claimInitialAttempt(record.id, now, 3).type !== 'CLAIMED')
        throw new Error('Gate smoke atomic claim failed.');
      sendRecords.markSendActionStarted(record.id, now);
      sendRecords.markSuccess(record.id, now);
    }
    dailyRuns.markSuccess(run.id, now);
    new SystemEventRepository(client).create({
      eventType: 'RUN_FINISHED',
      level: 'INFO',
      runId: run.id,
      accountId: account.id,
      message: 'Daily run finished',
      now,
    });
    client.close();

    writeFileSync(
      path.join(logDirectory, 'sparkkeeper-2026-08-23.log'),
      `${JSON.stringify({ level: 30, eventType: 'RUN_FINISHED' })}\n`,
    );
    const environment = {
      DATA_DIR: dataDirectory,
      BROWSER_PROFILE_DIR: profileDirectory,
      LOG_DIR: logDirectory,
      LOG_LEVEL: 'info',
      TRACE_MODE: 'off',
      SCHEDULER_ENABLED: 'false',
      SCHEDULER_ALLOW_REAL_SEND: 'false',
      SCHEDULER_ACCOUNT_ID: account.id,
      SCHEDULER_MESSAGE_TEMPLATE_ID: template.id,
      COOKIE: 'synthetic-cookie-secret',
      TOKEN: 'synthetic-token-secret',
      MESSAGE_TEXT: 'Synthetic private message',
    };
    const beforeHash = sha256(databasePath);
    const preflight = runV1Preflight({ environment, workingDirectory: root });
    const audit = runV1Audit({
      environment,
      workingDirectory: root,
      args: ['--date', businessDate],
    });
    const afterHash = sha256(databasePath);
    const safeOutput = `${renderV1Preflight(preflight)}\n${renderV1Audit(audit)}`;
    const sensitiveOutputCount = [
      'synthetic-cookie-secret',
      'synthetic-token-secret',
      'Synthetic private message',
      'Alice',
      'Bob',
      'Hello',
    ].filter((value) => safeOutput.includes(value)).length;
    const day = audit.days[0];
    if (!preflight.ready || preflight.enabledFriendCount !== 2)
      throw new Error('Gate smoke preflight failed.');
    if (day?.gateStatus !== 'PASS' || !audit.passed) throw new Error('Gate smoke audit failed.');
    if (
      day.duplicateSendRecordViolations !== 0 ||
      day.duplicateSuccessViolations !== 0 ||
      day.systemEventCount !== 1 ||
      day.log.parseErrorCount !== 0
    )
      throw new Error('Gate smoke audit invariant failed.');
    if (beforeHash !== afterHash) throw new Error('Gate smoke audit changed database bytes.');
    if (sensitiveOutputCount !== 0) throw new Error('Gate smoke output exposed fixture data.');

    return [
      'Engineering preflight: VERIFIED',
      'CLI maintenance: VERIFIED',
      'Multi-friend readiness: VERIFIED',
      'Scheduler safety: VERIFIED',
      'Audit read-only: VERIFIED',
      'Idempotency audit: VERIFIED',
      'Observability audit: VERIFIED',
      `Sensitive output: ${sensitiveOutputCount}`,
      'V1 Gate preparation: VERIFIED',
    ].join('\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
