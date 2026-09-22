import {
  isAccountLoginFailureCode,
  isAccountLoginPurpose,
  validateDouyinAccountIdentity,
  type AccountLoginFailureCode,
  type AccountLoginPurpose,
  type DouyinAccountIdentity,
} from '@sparkkeeper/shared';

export const MAX_WORKER_MESSAGE_BYTES = 16 * 1024;

export interface AccountLoginWorkerStart {
  readonly type: 'START';
  readonly runtimeMode: 'INTERACTIVE' | 'COMPLETION_RECOVERY';
  readonly sessionId: string;
  readonly purpose: AccountLoginPurpose;
  readonly accountId: string;
  readonly profilePath: string;
  readonly profileKind: 'ACCOUNT' | 'STAGING';
  readonly expiresAt: string;
}

export interface LoopbackConsoleEndpoint {
  readonly host: '127.0.0.1';
  readonly port: number;
}

export type AccountLoginWorkerEvent =
  | { readonly type: 'WORKER_STARTED'; readonly sessionId: string; readonly display: number }
  | { readonly type: 'BROWSER_LAUNCHING'; readonly sessionId: string }
  | {
      readonly type: 'BROWSER_STARTED';
      readonly sessionId: string;
      readonly browserPid: number;
      readonly browserPgid: number;
    }
  | { readonly type: 'BROWSER_LAUNCH_ABORTED'; readonly sessionId: string }
  | {
      readonly type: 'CONSOLE_READY';
      readonly sessionId: string;
      readonly endpoint: LoopbackConsoleEndpoint;
    }
  | { readonly type: 'AWAITING_USER'; readonly sessionId: string }
  | { readonly type: 'READY_DETECTED'; readonly sessionId: string }
  | { readonly type: 'INTERACTIVE_EXPIRED'; readonly sessionId: string }
  | {
      readonly type: 'IDENTITY_EXTRACTED';
      readonly sessionId: string;
      readonly identity: DouyinAccountIdentity;
    }
  | {
      readonly type: 'WORKER_FAILED';
      readonly sessionId: string;
      readonly failureCode: AccountLoginFailureCode;
    }
  | { readonly type: 'WORKER_EXITED'; readonly sessionId: string };

const EVENT_TYPES = new Set([
  'WORKER_STARTED',
  'BROWSER_LAUNCHING',
  'BROWSER_STARTED',
  'BROWSER_LAUNCH_ABORTED',
  'CONSOLE_READY',
  'AWAITING_USER',
  'READY_DETECTED',
  'INTERACTIVE_EXPIRED',
  'IDENTITY_EXTRACTED',
  'WORKER_FAILED',
  'WORKER_EXITED',
]);

export function validateWorkerStart(value: unknown): AccountLoginWorkerStart {
  const record = requireRecord(value);
  if (
    record.type !== 'START' ||
    (record.runtimeMode !== 'INTERACTIVE' && record.runtimeMode !== 'COMPLETION_RECOVERY') ||
    !isUuid(record.sessionId) ||
    !isAccountLoginPurpose(record.purpose) ||
    !isUuid(record.accountId) ||
    typeof record.profilePath !== 'string' ||
    record.profilePath.length === 0 ||
    record.profilePath.length > 4_096 ||
    (record.profileKind !== 'ACCOUNT' && record.profileKind !== 'STAGING') ||
    typeof record.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(record.expiresAt))
  ) {
    throw new Error('Invalid Account login worker start message.');
  }
  return record as unknown as AccountLoginWorkerStart;
}

export function validateWorkerEvent(value: unknown): AccountLoginWorkerEvent {
  assertBoundedMessage(value);
  const record = requireRecord(value);
  if (
    typeof record.type !== 'string' ||
    !EVENT_TYPES.has(record.type) ||
    !isUuid(record.sessionId)
  ) {
    throw new Error('Invalid Account login worker event.');
  }

  if (record.type === 'WORKER_STARTED') {
    if (
      typeof record.display !== 'number' ||
      !Number.isInteger(record.display) ||
      record.display < 90 ||
      record.display > 199
    ) {
      throw new Error('Invalid worker display reservation.');
    }
  } else if (record.type === 'BROWSER_STARTED') {
    if (
      typeof record.browserPid !== 'number' ||
      !Number.isSafeInteger(record.browserPid) ||
      record.browserPid <= 1 ||
      typeof record.browserPgid !== 'number' ||
      !Number.isSafeInteger(record.browserPgid) ||
      record.browserPgid !== record.browserPid
    ) {
      throw new Error('Invalid Chromium process identity.');
    }
  } else if (record.type === 'CONSOLE_READY') {
    const endpoint = requireRecord(record.endpoint);
    if (
      endpoint.host !== '127.0.0.1' ||
      typeof endpoint.port !== 'number' ||
      !Number.isInteger(endpoint.port) ||
      endpoint.port < 1 ||
      endpoint.port > 65_535
    ) {
      throw new Error('Invalid loopback console endpoint.');
    }
  } else if (record.type === 'IDENTITY_EXTRACTED') {
    record.identity = validateDouyinAccountIdentity(requireRecord(record.identity) as never);
  } else if (record.type === 'WORKER_FAILED' && !isAccountLoginFailureCode(record.failureCode)) {
    throw new Error('Invalid worker failure code.');
  }

  return record as unknown as AccountLoginWorkerEvent;
}

function assertBoundedMessage(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Worker message is not serializable.');
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKER_MESSAGE_BYTES) {
    throw new Error('Worker message exceeds the allowed size.');
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Worker message must be an object.');
  }
  return value as Record<string, unknown>;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}
