import type { ExternalActionState, RetryFailureCode } from '@sparkkeeper/shared';

export interface FailureClassification {
  readonly retryable: boolean;
  readonly scope: 'FRIEND_LOCAL' | 'RUN_GLOBAL';
  readonly deliveryUncertain: boolean;
}

export function classifyFailure(
  failureCode: RetryFailureCode,
  externalActionState: ExternalActionState,
): FailureClassification {
  if (
    externalActionState === 'UNCERTAIN' ||
    failureCode === 'DELIVERY_UNKNOWN' ||
    failureCode === 'VERIFY_FAILED'
  ) {
    return { retryable: false, scope: 'RUN_GLOBAL', deliveryUncertain: true };
  }

  const retryable = RETRYABLE_FAILURES.has(failureCode);
  return {
    retryable,
    scope: RUN_GLOBAL_FAILURES.has(failureCode) ? 'RUN_GLOBAL' : 'FRIEND_LOCAL',
    deliveryUncertain: false,
  };
}

const RETRYABLE_FAILURES = new Set<RetryFailureCode>([
  'NETWORK_TRANSIENT',
  'PAGE_LOAD_TIMEOUT',
  'CONTACT_LIST_NOT_READY',
  'BROWSER_TRANSIENT',
  'SEND_ACTION_FAILED',
  'PROCESS_INTERRUPTED_BEFORE_SEND',
]);

const RUN_GLOBAL_FAILURES = new Set<RetryFailureCode>([
  'NETWORK_TRANSIENT',
  'PAGE_LOAD_TIMEOUT',
  'CONTACT_LIST_NOT_READY',
  'BROWSER_TRANSIENT',
  'AUTH_EXPIRED',
  'AUTH_UNKNOWN',
  'DELIVERY_UNKNOWN',
  'VERIFY_FAILED',
]);
