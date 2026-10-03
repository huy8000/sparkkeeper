import { ApiClient, type ApiClientOptions } from './client';
import type {
  LegacyFriendSummary,
  LegacyScheduleSummary,
  UnifiedRun,
  UnifiedSendRecord,
  ResolutionSummary,
  Page,
} from '@sparkkeeper/shared';
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 128;
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const parser =
  <T>(check: (v: Record<string, unknown>) => boolean) =>
  (v: unknown): T | undefined =>
    obj(v) && check(v) ? (v as unknown as T) : undefined;
const run = parser<UnifiedRun>(
  (v) =>
    id(v.id) &&
    id(v.accountId) &&
    ['LEGACY_V3', 'V4'].includes(v.source as string) &&
    ['LEGACY_DAILY', 'TEST_SEND', 'SCHEDULED_TASK'].includes(v.kind as string) &&
    [
      'READY',
      'PENDING',
      'RUNNING',
      'SUCCESS',
      'PARTIAL_FAILED',
      'FAILED',
      'DELIVERY_UNKNOWN',
      'AUTH_EXPIRED',
      'CANCELLED',
      'RETRY_WAIT',
      'SKIPPED',
    ].includes(v.status as string) &&
    iso(v.createdAt) &&
    iso(v.updatedAt),
);
const resolution = parser<ResolutionSummary>(
  (v) =>
    id(v.id) &&
    v.source === 'HUMAN' &&
    v.originalMachineStatus === 'DELIVERY_UNKNOWN' &&
    ['CONFIRMED_DELIVERED', 'CONFIRMED_NOT_DELIVERED', 'INCONCLUSIVE'].includes(
      v.resolution as string,
    ) &&
    iso(v.resolvedAt) &&
    (v.note === null || typeof v.note === 'string'),
);
const record = parser<UnifiedSendRecord>(
  (v) =>
    id(v.id) &&
    id(v.runId) &&
    ['LEGACY_V3', 'V4'].includes(v.source as string) &&
    typeof v.status === 'string' &&
    typeof v.sendActionStarted === 'boolean' &&
    Number.isInteger(v.attempts) &&
    (v.latestResolution === null || resolution(v.latestResolution) !== undefined),
);
const friend = parser<LegacyFriendSummary>(
  (v) =>
    id(v.id) &&
    id(v.friendId) &&
    id(v.accountId) &&
    ['PENDING', 'BOUND', 'DISMISSED'].includes(v.status as string) &&
    iso(v.updatedAt),
);
const schedule = parser<LegacyScheduleSummary>(
  (v) =>
    id(v.id) &&
    id(v.scheduleId) &&
    id(v.accountId) &&
    ['PENDING', 'CONVERTED', 'DISMISSED'].includes(v.status as string) &&
    ['startTimeSnapshot', 'endTimeSnapshot', 'timezoneSnapshot'].every(
      (k) => typeof v[k] === 'string',
    ) &&
    iso(v.updatedAt),
);
function array<T>(p: (v: unknown) => T | undefined) {
  return (v: unknown): T[] | undefined => {
    if (!Array.isArray(v)) return;
    const rows = v.map(p);
    return rows.every((r) => r !== undefined) ? (rows as T[]) : undefined;
  };
}
function page<T>(p: (v: unknown) => T | undefined) {
  return (v: unknown): Page<T> | undefined => {
    if (!obj(v)) return;
    const items = array(p)(v.items);
    return items && (v.nextCursor === null || typeof v.nextCursor === 'string')
      ? { items, nextCursor: v.nextCursor }
      : undefined;
  };
}
const ack = parser<{ id: string; updatedAt?: string }>((v) => id(v.id));
export function createMigrationApi(options: ApiClientOptions = {}) {
  const c = new ApiClient(options);
  return {
    friends: (accountId: string, cursor = '') =>
      c.get(
        `/accounts/${encodeURIComponent(accountId)}/legacy-friend-bindings${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        page(friend),
      ),
    schedules: (accountId: string, cursor = '') =>
      c.get(
        `/legacy-schedule-imports?accountId=${encodeURIComponent(accountId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        page(schedule),
      ),
    bind: (r: LegacyFriendSummary, contactId: string) =>
      c.mutate(
        'POST',
        `/legacy-friend-bindings/${r.id}/bind`,
        { contactId, expectedUpdatedAt: r.updatedAt, confirmationText: 'BIND' },
        ack,
      ),
    dismissFriend: (r: LegacyFriendSummary) =>
      c.mutate(
        'POST',
        `/legacy-friend-bindings/${r.id}/dismiss`,
        { expectedUpdatedAt: r.updatedAt, confirmationText: 'DISMISS' },
        ack,
      ),
    convert: (r: LegacyScheduleSummary, name: string, templateId: string, contactIds: string[]) =>
      c.mutate(
        'POST',
        `/legacy-schedule-imports/${r.id}/convert`,
        {
          name,
          templateId,
          contactIds,
          expectedUpdatedAt: r.updatedAt,
          confirmationText: 'IMPORT DISABLED',
        },
        ack,
      ),
    dismissSchedule: (r: LegacyScheduleSummary) =>
      c.mutate(
        'POST',
        `/legacy-schedule-imports/${r.id}/dismiss`,
        { expectedUpdatedAt: r.updatedAt, confirmationText: 'DISMISS' },
        ack,
      ),
    runs: (offset = 0) =>
      c.get(`/runs?limit=50${offset ? `&cursor=${btoa(`v1:${offset}`)}` : ''}`, array(run)),
    run: (id: string, signal?: AbortSignal) =>
      c.get(`/runs/${encodeURIComponent(id)}`, run, signal),
    records: (id: string, offset = 0, signal?: AbortSignal) =>
      c.get(
        `/runs/${encodeURIComponent(id)}/send-records?limit=50${offset ? `&cursor=${btoa(`v1:${offset}`)}` : ''}`,
        array(record),
        signal,
      ),
    resolutions: (id: string) =>
      c.get(`/send-records/${encodeURIComponent(id)}/resolutions`, page(resolution)),
    resolve: (r: UnifiedSendRecord, value: ResolutionSummary['resolution'], note: string) =>
      c.mutate(
        'POST',
        `/send-records/${r.id}/resolutions`,
        {
          resolution: value,
          ...(note.trim() ? { note: note.trim() } : {}),
          expectedLatestResolutionId: r.latestResolution?.id ?? null,
          confirmationText: 'RESOLVE WITHOUT RESEND',
        },
        resolution,
      ),
    audits: () =>
      c.get(
        '/system/audit-events',
        parser<{ items: Record<string, unknown>[] }>(
          (v) => Array.isArray(v.items) && v.items.every(obj),
        ),
      ),
  };
}
