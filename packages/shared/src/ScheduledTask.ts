import type {
  ExecutionRunStatus,
  TargetSendFailureCode,
  TargetSendMachineStatus,
} from './Execution.js';
import { resolveBusinessDate } from './BusinessDate.js';

export interface TaskConfiguration {
  name: string;
  accountId: string;
  templateId: string;
  schedule: {
    type: 'DAILY_WINDOW';
    startTime: string;
    endTime: string;
    timezone: string;
    maxAttempts: number;
    retryIntervalSeconds: number;
  };
  contactIds: string[];
}
export interface TaskDetail extends TaskConfiguration {
  id: string;
  enabled: boolean;
  archivedAt: string | null;
  updatedAt: string;
  state: 'DISABLED' | 'ENABLED' | 'BLOCKED' | 'ARCHIVED';
  overlaps: string[];
  latestRun: { id: string; status: ExecutionRunStatus; businessDate: string } | null;
}
export interface ScheduledRunDetail {
  runId: string;
  kind: 'SCHEDULED_TASK';
  accountId: string;
  taskId: string;
  businessDate: string;
  status: ExecutionRunStatus;
  finishedAt: string | null;
  records: {
    id: string;
    contactId: string;
    machineStatus: TargetSendMachineStatus;
    attemptCount: number;
    failureCode: TargetSendFailureCode | null;
    nextRetryAt: string | null;
    sendActionStartedAt: string | null;
  }[];
}
/** Wall time only: repeated DST hours share a durable day key, nonexistent times are not shifted. */
export function taskWindow(now: Date, schedule: TaskConfiguration['schedule']) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: schedule.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const time = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
  return {
    businessDate: resolveBusinessDate(now, schedule.timezone),
    open: time >= schedule.startTime && time < schedule.endTime,
  };
}
