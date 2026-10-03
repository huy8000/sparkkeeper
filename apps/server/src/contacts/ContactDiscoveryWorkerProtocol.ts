import {
  isContactSyncFailureCode,
  validateContactObservation,
  type ContactObservation,
} from '@sparkkeeper/shared';
export interface DiscoveryWorkerStart {
  type: 'START';
  runId: string;
  accountId: string;
  profilePath: string;
  runtimeRoot: string;
  deadline: number;
  expected: { secUid: string | null; uniqueId: string | null };
}
export type DiscoveryWorkerEvent =
  | { type: 'BROWSER_LAUNCHING' | 'BROWSER_STARTED' | 'BROWSER_LAUNCH_ABORTED'; runId: string }
  | { type: 'BATCH'; runId: string; sequence: number; observations: ContactObservation[] }
  | {
      type: 'RESULT';
      runId: string;
      status: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'AUTH_EXPIRED';
      failureCode: ReturnType<typeof failure>;
      issueCount: number;
      authChecked: boolean;
    };
function failure(v: unknown) {
  if (v === null) return null;
  if (!isContactSyncFailureCode(v)) throw new Error('Invalid failure code.');
  return v;
}
export const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v);
export function validateDiscoveryEvent(v: unknown, runId: string): DiscoveryWorkerEvent {
  if (
    Buffer.byteLength(JSON.stringify(v) ?? '') > 16384 ||
    typeof v !== 'object' ||
    v === null ||
    Array.isArray(v)
  )
    throw new Error('Invalid discovery IPC.');
  const e = v as Record<string, unknown>;
  if (e.runId !== runId) throw new Error('Invalid discovery IPC.');
  if (
    e.type === 'BROWSER_LAUNCHING' ||
    e.type === 'BROWSER_STARTED' ||
    e.type === 'BROWSER_LAUNCH_ABORTED'
  ) {
    if (Object.keys(e).length !== 2) throw new Error('Invalid launch event.');
    return { type: e.type, runId };
  }
  if (e.type === 'BATCH') {
    if (
      Object.keys(e).length !== 4 ||
      !Array.isArray(e.observations) ||
      e.observations.length > 10 ||
      !Number.isSafeInteger(e.sequence) ||
      (e.sequence as number) < 0
    )
      throw new Error('Invalid discovery batch.');
    return {
      type: 'BATCH',
      runId,
      sequence: e.sequence as number,
      observations: e.observations.map(validateContactObservation),
    };
  }
  if (e.type === 'RESULT') {
    if (
      Object.keys(e).length !== 6 ||
      !['COMPLETE', 'PARTIAL', 'FAILED', 'AUTH_EXPIRED'].includes(e.status as string) ||
      !Number.isSafeInteger(e.issueCount) ||
      (e.issueCount as number) < 0 ||
      (e.issueCount as number) > 500 ||
      typeof e.authChecked !== 'boolean'
    )
      throw new Error('Invalid discovery outcome.');
    const code = failure(e.failureCode);
    if (
      (e.status === 'COMPLETE') !== (code === null) ||
      (['COMPLETE', 'PARTIAL', 'AUTH_EXPIRED'].includes(e.status as string) && !e.authChecked) ||
      (e.status === 'AUTH_EXPIRED' && code !== 'AUTH_EXPIRED')
    )
      throw new Error('Invalid discovery outcome.');
    return {
      type: 'RESULT',
      runId,
      status: e.status as 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'AUTH_EXPIRED',
      failureCode: code,
      issueCount: e.issueCount as number,
      authChecked: e.authChecked,
    };
  }
  throw new Error('Invalid discovery IPC.');
}
export function validateDiscoveryStart(v: unknown): DiscoveryWorkerStart {
  if (Buffer.byteLength(JSON.stringify(v) ?? '') > 4096 || typeof v !== 'object' || v === null)
    throw new Error('Invalid discovery start.');
  const e = v as DiscoveryWorkerStart;
  if (
    e.type !== 'START' ||
    !uuid(e.runId) ||
    !uuid(e.accountId) ||
    typeof e.profilePath !== 'string' ||
    !e.profilePath.startsWith('/') ||
    typeof e.runtimeRoot !== 'string' ||
    !e.runtimeRoot.startsWith('/') ||
    !Number.isSafeInteger(e.deadline) ||
    e.deadline <= Date.now() ||
    e.deadline > Date.now() + 90000 ||
    !e.expected ||
    (e.expected.secUid !== null && typeof e.expected.secUid !== 'string') ||
    (e.expected.uniqueId !== null && typeof e.expected.uniqueId !== 'string')
  )
    throw new Error('Invalid discovery start.');
  return e;
}
