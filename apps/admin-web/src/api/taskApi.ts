import type { TaskConfiguration, TaskDetail, ScheduledRunDetail } from '@sparkkeeper/shared';
import {
  EXECUTION_RUN_STATUSES,
  TARGET_SEND_MACHINE_STATUSES,
  TARGET_SEND_FAILURE_CODES,
} from '@sparkkeeper/shared';
import { ApiClient, type ApiClientOptions } from './client';
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function parseTask(v: unknown): TaskDetail | undefined {
  if (
    !obj(v) ||
    !uuid(v.id) ||
    !uuid(v.accountId) ||
    !uuid(v.templateId) ||
    typeof v.name !== 'string' ||
    typeof v.enabled !== 'boolean' ||
    !iso(v.updatedAt) ||
    !(v.archivedAt === null || iso(v.archivedAt)) ||
    !['DISABLED', 'ENABLED', 'BLOCKED', 'ARCHIVED'].includes(v.state as string) ||
    !Array.isArray(v.contactIds) ||
    v.contactIds.length < 1 ||
    v.contactIds.length > 100 ||
    !v.contactIds.every(uuid) ||
    new Set(v.contactIds).size !== v.contactIds.length ||
    !Array.isArray(v.overlaps) ||
    !v.overlaps.every(uuid) ||
    !obj(v.schedule) ||
    v.schedule.type !== 'DAILY_WINDOW' ||
    !['startTime', 'endTime', 'timezone'].every(
      (k) => typeof (v.schedule as Record<string, unknown>)[k] === 'string',
    ) ||
    !Number.isInteger(v.schedule.maxAttempts) ||
    (v.schedule.maxAttempts as number) < 1 ||
    (v.schedule.maxAttempts as number) > 5 ||
    !Number.isInteger(v.schedule.retryIntervalSeconds) ||
    (v.schedule.retryIntervalSeconds as number) < 1 ||
    (v.schedule.retryIntervalSeconds as number) > 86400 ||
    !(
      v.latestRun === null ||
      (obj(v.latestRun) &&
        uuid(v.latestRun.id) &&
        EXECUTION_RUN_STATUSES.includes(v.latestRun.status as ScheduledRunDetail['status']) &&
        typeof v.latestRun.businessDate === 'string')
    )
  )
    return undefined;
  return v as unknown as TaskDetail;
}
export function parseScheduledRun(v: unknown): ScheduledRunDetail | undefined {
  if (
    !obj(v) ||
    !uuid(v.runId) ||
    v.kind !== 'SCHEDULED_TASK' ||
    !uuid(v.accountId) ||
    !uuid(v.taskId) ||
    typeof v.businessDate !== 'string' ||
    !EXECUTION_RUN_STATUSES.includes(v.status as ScheduledRunDetail['status']) ||
    !(v.finishedAt === null || iso(v.finishedAt)) ||
    !Array.isArray(v.records) ||
    v.records.length < 1 ||
    v.records.length > 100 ||
    !v.records.every(
      (r) =>
        obj(r) &&
        uuid(r.id) &&
        uuid(r.contactId) &&
        TARGET_SEND_MACHINE_STATUSES.includes(
          r.machineStatus as ScheduledRunDetail['records'][number]['machineStatus'],
        ) &&
        Number.isInteger(r.attemptCount) &&
        (r.attemptCount as number) >= 0 &&
        (r.attemptCount as number) <= 5 &&
        (r.failureCode === null ||
          TARGET_SEND_FAILURE_CODES.includes(
            r.failureCode as NonNullable<ScheduledRunDetail['records'][number]['failureCode']>,
          )) &&
        [r.nextRetryAt, r.sendActionStartedAt].every((d) => d === null || iso(d)),
    )
  )
    return undefined;
  return v as unknown as ScheduledRunDetail;
}
export function createTaskApi(options: ApiClientOptions = {}) {
  const c = new ApiClient(options);
  return {
    list: (accountId?: string, signal?: AbortSignal) =>
      c.get(
        '/tasks' + (accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''),
        (v) => {
          if (
            !obj(v) ||
            !Array.isArray(v.items) ||
            v.items.length > 100 ||
            !v.items.every(parseTask) ||
            typeof v.masterOpen !== 'boolean' ||
            typeof v.released !== 'boolean'
          )
            return undefined;
          return v as unknown as { items: TaskDetail[]; masterOpen: boolean; released: boolean };
        },
        signal,
      ),
    create: (input: TaskConfiguration, signal?: AbortSignal) =>
      c.mutate('POST', '/tasks', input, parseTask, signal),
    update: (task: TaskDetail, input: TaskConfiguration, signal?: AbortSignal) =>
      c.mutate(
        'PATCH',
        `/tasks/${task.id}`,
        { ...input, expectedUpdatedAt: task.updatedAt },
        parseTask,
        signal,
      ),
    operate: (
      task: TaskDetail,
      operation: 'enable' | 'disable' | 'archive',
      signal?: AbortSignal,
    ) =>
      c.mutate(
        'POST',
        `/tasks/${task.id}/${operation}`,
        {
          expectedUpdatedAt: task.updatedAt,
          ...(operation === 'enable'
            ? { acknowledgeOverlaps: true }
            : operation === 'archive'
              ? { confirmationText: 'ARCHIVE' }
              : {}),
        },
        parseTask,
        signal,
      ),
    run: (id: string, signal?: AbortSignal) =>
      c.get(`/scheduled-runs/${encodeURIComponent(id)}`, parseScheduledRun, signal),
  };
}
