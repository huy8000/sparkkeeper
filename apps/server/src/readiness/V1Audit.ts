import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  openDatabaseReadOnly,
  resolveDatabasePath,
  V1ReleaseReadModel,
  type V1AuditDayData,
} from '@sparkkeeper/database';
import {
  parseBusinessDate,
  type BusinessDate,
  type RuntimeEventType,
  type SendRecordStatus,
} from '@sparkkeeper/shared';

import {
  resolveObservabilityConfig,
  type ObservabilityEnvironment,
} from '../config/ObservabilityConfig.js';
import { resolveSchedulerConfig, type SchedulerEnvironment } from '../config/SchedulerConfig.js';
import { assertEvidencePathHasNoSymlink } from '../observability/EvidencePath.js';

export type V1AuditGateStatus = 'PASS' | 'FAILED' | 'INCOMPLETE' | 'NO_DATA';

export interface V1AuditLogState {
  readonly present: boolean;
  readonly entryCount: number;
  readonly parseErrorCount: number;
}

export interface V1AuditDaySummary {
  readonly businessDate: BusinessDate;
  readonly gateStatus: V1AuditGateStatus;
  readonly dailyRunStatus: string;
  readonly enabledFriendCount: number;
  readonly sendRecordCount: number;
  readonly successCount: number;
  readonly failedCount: number;
  readonly retryWaitCount: number;
  readonly deliveryUnknownCount: number;
  readonly runningCount: number;
  readonly totalAttemptCount: number;
  readonly maxAttemptCount: number;
  readonly duplicateSendRecordViolations: number;
  readonly duplicateSuccessViolations: number;
  readonly systemEventCount: number;
  readonly authExpiredEventCount: number;
  readonly taskFailedEventCount: number;
  readonly selectorFailureEventCount: number;
  readonly deliveryUnknownEventCount: number;
  readonly missingSystemEventCount: number;
  readonly evidenceCount: number;
  readonly missingEvidenceCount: number;
  readonly log: V1AuditLogState;
}

export interface V1AuditResult {
  readonly days: readonly V1AuditDaySummary[];
  readonly passed: boolean;
}

export interface V1AuditEnvironment
  extends
    SchedulerEnvironment,
    ObservabilityEnvironment,
    Readonly<Record<string, string | undefined>> {}

export interface RunV1AuditOptions {
  readonly args: readonly string[];
  readonly environment?: V1AuditEnvironment;
  readonly workingDirectory?: string;
}

interface AuditFilesystemState {
  readonly evidenceExists: (relativePath: string) => boolean;
  readonly log: V1AuditLogState;
}

const CRITICAL_EVIDENCE_EVENTS = new Set<RuntimeEventType>([
  'TASK_FAILED',
  'AUTH_EXPIRED',
  'SELECTOR_FAILURE',
  'DELIVERY_UNKNOWN',
]);

export function runV1Audit(options: RunV1AuditOptions): V1AuditResult {
  const environment = options.environment ?? process.env;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const dates = parseV1AuditDates(options.args);
  const schedulerConfig = resolveSchedulerConfig(environment);
  if (schedulerConfig.accountId === undefined) {
    throw new Error('SCHEDULER_ACCOUNT_ID is required for V1 audit.');
  }
  const observability = resolveObservabilityConfig(environment, workingDirectory);
  const databasePath = resolveDatabasePath({ environment, cwd: workingDirectory });
  const client = openDatabaseReadOnly({ databasePath });
  try {
    const readModel = new V1ReleaseReadModel(client);
    const days = dates.map((businessDate) => {
      const data = readModel.readAuditDay(schedulerConfig.accountId!, businessDate);
      return summarizeV1AuditDay(
        data,
        inspectAuditFilesystem(
          observability.dataDirectory,
          observability.logDirectory,
          businessDate,
        ),
      );
    });
    return { days, passed: days.length > 0 && days.every((day) => day.gateStatus === 'PASS') };
  } finally {
    client.close();
  }
}

export function summarizeV1AuditDay(
  data: V1AuditDayData,
  filesystem: AuditFilesystemState,
): V1AuditDaySummary {
  const statusCount = (status: SendRecordStatus): number =>
    data.sendRecords.filter((record) => record.status === status).length;
  const friendCounts = new Map<string, number>();
  const successCounts = new Map<string, number>();
  for (const record of data.sendRecords) {
    friendCounts.set(record.friendId, (friendCounts.get(record.friendId) ?? 0) + 1);
    if (record.status === 'SUCCESS')
      successCounts.set(record.friendId, (successCounts.get(record.friendId) ?? 0) + 1);
  }
  const duplicateSendRecordViolations = [...friendCounts.values()].filter(
    (value) => value > 1,
  ).length;
  const duplicateSuccessViolations = [...successCounts.values()].filter(
    (value) => value > 1,
  ).length;
  const eventCount = (eventType: RuntimeEventType): number =>
    data.systemEvents.filter((event) => event.eventType === eventType).length;
  const authExpiredEventCount = eventCount('AUTH_EXPIRED');
  const taskFailedEventCount = eventCount('TASK_FAILED');
  const selectorFailureEventCount = eventCount('SELECTOR_FAILURE');
  const deliveryUnknownEventCount = eventCount('DELIVERY_UNKNOWN');
  const successCount = statusCount('SUCCESS');
  const failedCount = statusCount('FAILED');
  const retryWaitCount = statusCount('RETRY_WAIT');
  const deliveryUnknownCount = statusCount('DELIVERY_UNKNOWN');
  const runningCount = statusCount('RUNNING');
  const attemptCounts = data.sendRecords.map((record) => record.attemptCount ?? 0);
  const totalAttemptCount = attemptCounts.reduce((total, value) => total + value, 0);
  const maxAttemptCount = attemptCounts.length === 0 ? 0 : Math.max(...attemptCounts);
  const missingSystemEventCount =
    Number(data.dailyRunStatus === 'AUTH_EXPIRED' && authExpiredEventCount === 0) +
    Number(failedCount > 0 && taskFailedEventCount === 0) +
    Number(deliveryUnknownCount > 0 && deliveryUnknownEventCount === 0);

  const evidencePaths = data.systemEvents.flatMap((event) =>
    [event.screenshotPath, event.tracePath].filter((value): value is string => value !== null),
  );
  const evidenceCount = evidencePaths.filter(filesystem.evidenceExists).length;
  const missingConfiguredEvidence = evidencePaths.length - evidenceCount;
  const criticalEventCount = data.systemEvents.filter((event) =>
    CRITICAL_EVIDENCE_EVENTS.has(event.eventType),
  ).length;
  const missingEvidenceCount =
    missingConfiguredEvidence + Number(criticalEventCount > 0 && evidencePaths.length === 0);

  const hasFailure =
    data.dailyRunStatus === 'FAILED' ||
    data.dailyRunStatus === 'AUTH_EXPIRED' ||
    failedCount > 0 ||
    deliveryUnknownCount > 0 ||
    duplicateSendRecordViolations > 0 ||
    duplicateSuccessViolations > 0 ||
    missingSystemEventCount > 0 ||
    missingEvidenceCount > 0 ||
    !filesystem.log.present ||
    filesystem.log.parseErrorCount > 0 ||
    (data.dailyRunStatus === 'SUCCESS' && successCount !== data.enabledFriendCount);
  const incomplete =
    data.dailyRunStatus === 'READY' ||
    data.dailyRunStatus === 'RUNNING' ||
    retryWaitCount > 0 ||
    runningCount > 0;
  const gateStatus: V1AuditGateStatus =
    data.dailyRunStatus === undefined
      ? 'NO_DATA'
      : hasFailure
        ? 'FAILED'
        : incomplete
          ? 'INCOMPLETE'
          : 'PASS';

  return {
    businessDate: data.businessDate,
    gateStatus,
    dailyRunStatus: data.dailyRunStatus ?? 'MISSING',
    enabledFriendCount: data.enabledFriendCount,
    sendRecordCount: data.sendRecords.length,
    successCount,
    failedCount,
    retryWaitCount,
    deliveryUnknownCount,
    runningCount,
    totalAttemptCount,
    maxAttemptCount,
    duplicateSendRecordViolations,
    duplicateSuccessViolations,
    systemEventCount: data.systemEvents.length,
    authExpiredEventCount,
    taskFailedEventCount,
    selectorFailureEventCount,
    deliveryUnknownEventCount,
    missingSystemEventCount,
    evidenceCount,
    missingEvidenceCount,
    log: filesystem.log,
  };
}

export function parseV1AuditDates(args: readonly string[]): readonly BusinessDate[] {
  const options = parseAuditOptions(args[0] === '--' ? args.slice(1) : args);
  const date = options.get('date');
  const from = options.get('from');
  const to = options.get('to');
  if (date !== undefined) {
    if (from !== undefined || to !== undefined)
      throw new Error('--date cannot be combined with a range.');
    return [parseBusinessDate(date)];
  }
  if (from === undefined || to === undefined) {
    throw new Error('Use --date YYYY-MM-DD or --from YYYY-MM-DD --to YYYY-MM-DD.');
  }
  const start = parseBusinessDate(from);
  const end = parseBusinessDate(to);
  if (start > end) throw new Error('Audit --from must not be after --to.');
  const dates: BusinessDate[] = [];
  for (
    let cursor = new Date(`${start}T00:00:00.000Z`);
    cursor <= new Date(`${end}T00:00:00.000Z`);
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    dates.push(parseBusinessDate(cursor.toISOString().slice(0, 10)));
  }
  return dates;
}

export function renderV1Audit(result: V1AuditResult): string {
  return result.days
    .map((day) =>
      [
        `BusinessDate: ${day.businessDate}`,
        `Gate status: ${day.gateStatus}`,
        `DailyRun status: ${day.dailyRunStatus}`,
        `Enabled Friend count: ${day.enabledFriendCount}`,
        `SendRecord count: ${day.sendRecordCount}`,
        `SUCCESS count: ${day.successCount}`,
        `FAILED count: ${day.failedCount}`,
        `RETRY_WAIT count: ${day.retryWaitCount}`,
        `DELIVERY_UNKNOWN count: ${day.deliveryUnknownCount}`,
        `RUNNING count: ${day.runningCount}`,
        `Total Attempts: ${day.totalAttemptCount}`,
        `Max Attempts for one Friend: ${day.maxAttemptCount}`,
        `Duplicate idempotency violations: ${day.duplicateSendRecordViolations}`,
        `Duplicate SUCCESS violations: ${day.duplicateSuccessViolations}`,
        `SystemEvent count: ${day.systemEventCount}`,
        `AUTH_EXPIRED count: ${day.authExpiredEventCount}`,
        `TASK_FAILED count: ${day.taskFailedEventCount}`,
        `SELECTOR_FAILURE count: ${day.selectorFailureEventCount}`,
        `DELIVERY_UNKNOWN SystemEvent count: ${day.deliveryUnknownEventCount}`,
        `Missing SystemEvent count: ${day.missingSystemEventCount}`,
        `Evidence count: ${day.evidenceCount}`,
        `Missing evidence count: ${day.missingEvidenceCount}`,
        `Log file: ${day.log.present ? 'PRESENT' : 'MISSING'}`,
        `Entries: ${day.log.entryCount}`,
        `Parse errors: ${day.log.parseErrorCount}`,
      ].join('\n'),
    )
    .join('\n\n');
}

function inspectAuditFilesystem(
  dataDirectory: string,
  logDirectory: string,
  businessDate: BusinessDate,
): AuditFilesystemState {
  const root = path.resolve(dataDirectory);
  return {
    evidenceExists: (relativePath) => {
      if (!relativePath.startsWith('screenshots/') && !relativePath.startsWith('traces/'))
        return false;
      const absolutePath = path.resolve(root, relativePath);
      const relative = path.relative(root, absolutePath);
      if (
        relative === '' ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        return false;
      try {
        assertEvidencePathHasNoSymlink(root, absolutePath);
        return existsSync(absolutePath) && statSync(absolutePath).isFile();
      } catch {
        return false;
      }
    },
    log: inspectLog(path.join(logDirectory, `sparkkeeper-${businessDate}.log`)),
  };
}

function inspectLog(filePath: string): V1AuditLogState {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return { present: false, entryCount: 0, parseErrorCount: 0 };
  }
  const lines = readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  let parseErrorCount = 0;
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        parseErrorCount += 1;
    } catch {
      parseErrorCount += 1;
    }
  }
  return { present: true, entryCount: lines.length, parseErrorCount };
}

function parseAuditOptions(args: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith('--') || value === undefined)
      throw new Error('Audit arguments must use --name value pairs.');
    const name = flag.slice(2);
    if (!['date', 'from', 'to'].includes(name) || options.has(name))
      throw new Error(`Unsupported or duplicate audit option: --${name}.`);
    options.set(name, value);
  }
  return options;
}
