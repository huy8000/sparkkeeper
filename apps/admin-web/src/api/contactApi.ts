import {
  CONTACT_TYPES,
  CONTACT_AVAILABILITY_STATUSES,
  CONTACT_IDENTITY_STATUSES,
  CONTACT_SYNC_RUN_STATUSES,
  CONTACT_SYNC_FAILURE_CODES,
  CONTACT_IDENTITY_KINDS,
  CONTACT_IDENTITY_STATES,
  type ContactType,
  type ContactAvailabilityStatus,
  type ContactIdentityStatus,
  type ContactSyncRunStatus,
} from '@sparkkeeper/shared';
import { ApiClient, type ApiClientOptions } from './client';
export interface ContactSummary {
  id: string;
  accountId: string;
  type: ContactType;
  displayName: string;
  remarkName: string | null;
  avatarAssetId: string | null;
  streakDays: number | null;
  streakUpdatedAt: string | null;
  availabilityStatus: ContactAvailabilityStatus;
  identityStatus: ContactIdentityStatus;
  discoveredAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface SyncSummary {
  id: string;
  accountId: string;
  status: ContactSyncRunStatus;
  isComplete: boolean;
  candidateCount: number;
  createdCount: number;
  updatedCount: number;
  staleCount: number;
  unavailableCount: number;
  issueCount: number;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface ContactDetail extends ContactSummary {
  identities: {
    id: string;
    kind: string;
    state: string;
    isPreferred: boolean;
    maskedValue: string;
    firstObservedAt: string;
    lastObservedAt: string;
  }[];
  identityReady: boolean;
  discoveryEligibilityReason: string;
}
export interface ContactPage {
  items: ContactSummary[];
  nextCursor: string | null;
  latestSync: SyncSummary | null;
}
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nullableString = (v: unknown) => v === null || typeof v === 'string';
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/iu.test(v);
function parseContact(v: unknown): ContactSummary | undefined {
  if (
    !object(v) ||
    !uuid(v.id) ||
    !uuid(v.accountId) ||
    !CONTACT_TYPES.includes(v.type as ContactType) ||
    typeof v.displayName !== 'string' ||
    !nullableString(v.remarkName) ||
    !nullableString(v.avatarAssetId) ||
    !CONTACT_AVAILABILITY_STATUSES.includes(v.availabilityStatus as ContactAvailabilityStatus) ||
    !CONTACT_IDENTITY_STATUSES.includes(v.identityStatus as ContactIdentityStatus) ||
    !['createdAt', 'updatedAt', 'discoveredAt', 'lastSeenAt'].every((k) => iso(v[k])) ||
    (v.streakDays !== null &&
      (!Number.isSafeInteger(v.streakDays) || (v.streakDays as number) < 0)) ||
    (v.streakUpdatedAt !== null && !iso(v.streakUpdatedAt))
  )
    return undefined;
  return v as unknown as ContactSummary;
}
function parseSync(v: unknown): SyncSummary | undefined {
  if (
    !object(v) ||
    !uuid(v.id) ||
    !uuid(v.accountId) ||
    !CONTACT_SYNC_RUN_STATUSES.includes(v.status as ContactSyncRunStatus) ||
    typeof v.isComplete !== 'boolean' ||
    (v.failureCode !== null &&
      !CONTACT_SYNC_FAILURE_CODES.includes(
        v.failureCode as (typeof CONTACT_SYNC_FAILURE_CODES)[number],
      )) ||
    !iso(v.createdAt) ||
    (v.startedAt !== null && !iso(v.startedAt)) ||
    (v.finishedAt !== null && !iso(v.finishedAt)) ||
    ![
      'candidateCount',
      'createdCount',
      'updatedCount',
      'staleCount',
      'unavailableCount',
      'issueCount',
    ].every((k) => Number.isSafeInteger(v[k]) && (v[k] as number) >= 0)
  )
    return undefined;
  return v as unknown as SyncSummary;
}
function parsePage(v: unknown): ContactPage | undefined {
  if (
    !object(v) ||
    !Array.isArray(v.items) ||
    v.items.length > 200 ||
    !nullableString(v.nextCursor)
  )
    return undefined;
  const items = v.items.map(parseContact);
  if (items.some((i) => !i)) return undefined;
  const latest = v.latestSync === null ? null : parseSync(v.latestSync);
  if (latest === undefined) return undefined;
  return {
    items: items as ContactSummary[],
    nextCursor: v.nextCursor as string | null,
    latestSync: latest,
  };
}
function parseDetail(v: unknown): ContactDetail | undefined {
  if (
    !parseContact(v) ||
    !object(v) ||
    !Array.isArray(v.identities) ||
    v.identities.length > 100 ||
    typeof v.identityReady !== 'boolean' ||
    ![
      'UNSUPPORTED_TYPE',
      'IDENTITY_REVIEW_REQUIRED',
      'CONTACT_UNAVAILABLE',
      'IDENTITY_READY',
    ].includes(v.discoveryEligibilityReason as string)
  )
    return undefined;
  if (
    !v.identities.every(
      (i) =>
        object(i) &&
        uuid(i.id) &&
        CONTACT_IDENTITY_KINDS.includes(i.kind as (typeof CONTACT_IDENTITY_KINDS)[number]) &&
        CONTACT_IDENTITY_STATES.includes(i.state as (typeof CONTACT_IDENTITY_STATES)[number]) &&
        typeof i.isPreferred === 'boolean' &&
        typeof i.maskedValue === 'string' &&
        iso(i.firstObservedAt) &&
        iso(i.lastObservedAt),
    )
  )
    return undefined;
  return v as unknown as ContactDetail;
}
export function createContactsApi(options: ApiClientOptions) {
  const client = new ApiClient(options);
  return {
    list: (accountId: string, filters: Record<string, string>, signal?: AbortSignal) =>
      client.get(
        `/accounts/${encodeURIComponent(accountId)}/contacts?${new URLSearchParams(filters)}`,
        parsePage,
        signal,
      ),
    status: (id: string, signal?: AbortSignal) =>
      client.get(`/contact-syncs/${encodeURIComponent(id)}`, parseSync, signal),
    detail: (id: string, signal?: AbortSignal) =>
      client.get(`/contacts/${encodeURIComponent(id)}`, parseDetail, signal),
    start: (accountId: string, key: string, signal?: AbortSignal) =>
      client.mutateIdempotent(
        'POST',
        `/accounts/${encodeURIComponent(accountId)}/contact-syncs`,
        {},
        (v) =>
          object(v) &&
          uuid(v.syncRunId) &&
          CONTACT_SYNC_RUN_STATUSES.includes(v.status as ContactSyncRunStatus)
            ? { syncRunId: v.syncRunId as string, status: v.status as ContactSyncRunStatus }
            : undefined,
        key,
        signal,
      ),
  };
}
