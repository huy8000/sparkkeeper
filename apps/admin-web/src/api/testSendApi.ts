import {
  EXECUTION_RUN_STATUSES,
  TARGET_SEND_MACHINE_STATUSES,
  TARGET_SEND_FAILURE_CODES,
  type TestSendPreview,
  type TestSendAccepted,
  type TestSendDetail,
} from '@sparkkeeper/shared';
import { ApiClient, type ApiClientOptions } from './client';
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(v);
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function parseTestPreview(v: unknown): TestSendPreview | undefined {
  if (
    !object(v) ||
    !uuid(v.intentId) ||
    !iso(v.expiresAt) ||
    typeof v.payloadDigest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(v.payloadDigest) ||
    !object(v.account) ||
    !uuid(v.account.id) ||
    typeof v.account.name !== 'string' ||
    !object(v.templateSummary) ||
    !uuid(v.templateSummary.id) ||
    typeof v.templateSummary.name !== 'string' ||
    !['STATIC', 'RANDOM'].includes(v.templateSummary.providerType as string) ||
    !Array.isArray(v.orderedTargets) ||
    v.orderedTargets.length !== 1 ||
    !object(v.orderedTargets[0]) ||
    !uuid(v.orderedTargets[0].id) ||
    typeof v.orderedTargets[0].displayName !== 'string' ||
    !['PERSON', 'GROUP'].includes(v.orderedTargets[0].type as string) ||
    !Array.isArray(v.warnings) ||
    !v.warnings.every((w) => typeof w === 'string')
  )
    return undefined;
  return v as unknown as TestSendPreview;
}
export function parseTestAccepted(v: unknown): TestSendAccepted | undefined {
  if (
    !object(v) ||
    !uuid(v.runId) ||
    !EXECUTION_RUN_STATUSES.includes(v.status as TestSendAccepted['status'])
  )
    return undefined;
  return { runId: v.runId, status: v.status as TestSendAccepted['status'] };
}
export function parseTestDetail(v: unknown): TestSendDetail | undefined {
  if (
    !parseTestAccepted(v) ||
    !object(v) ||
    v.kind !== 'TEST_SEND' ||
    !uuid(v.accountId) ||
    !iso(v.confirmedAt) ||
    !(v.finishedAt === null || iso(v.finishedAt)) ||
    !object(v.record)
  )
    return undefined;
  const r = v.record;
  if (
    !uuid(r.id) ||
    !uuid(r.contactId) ||
    !TARGET_SEND_MACHINE_STATUSES.includes(
      r.machineStatus as TestSendDetail['record']['machineStatus'],
    ) ||
    !(
      r.failureCode === null ||
      TARGET_SEND_FAILURE_CODES.includes(
        r.failureCode as NonNullable<TestSendDetail['record']['failureCode']>,
      )
    ) ||
    ![0, 1].includes(r.attemptCount as number) ||
    ![r.sendActionStartedAt, r.sentAt].every((d) => d === null || iso(d))
  )
    return undefined;
  return v as unknown as TestSendDetail;
}
export function createTestSendApi(options: ApiClientOptions = {}) {
  const client = new ApiClient(options);
  return {
    preview: (
      accountId: string,
      templateId: string,
      contactId: string,
      key: string,
      signal?: AbortSignal,
    ) =>
      client.mutateIdempotent(
        'POST',
        `/accounts/${encodeURIComponent(accountId)}/test-send-intents`,
        { templateId, contactIds: [contactId] },
        parseTestPreview,
        key,
        signal,
      ),
    confirm: (accountId: string, preview: TestSendPreview, key: string, signal?: AbortSignal) =>
      client.mutateIdempotent(
        'POST',
        `/accounts/${encodeURIComponent(accountId)}/test-sends`,
        { intentId: preview.intentId, payloadDigest: preview.payloadDigest, confirm: true },
        parseTestAccepted,
        key,
        signal,
      ),
    detail: (runId: string, signal?: AbortSignal) =>
      client.get(`/test-sends/${encodeURIComponent(runId)}`, parseTestDetail, signal),
  };
}
