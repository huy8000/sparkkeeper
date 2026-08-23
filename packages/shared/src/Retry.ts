export const DEFAULT_MAX_ATTEMPTS = 3;
export const MIN_MAX_ATTEMPTS = 1;
export const MAX_MAX_ATTEMPTS = 5;
export const DEFAULT_RETRY_INTERVAL_SECONDS = 60;
export const MIN_RETRY_INTERVAL_SECONDS = 1;
export const MAX_RETRY_INTERVAL_SECONDS = 86_400;

export type RetryFailureCode =
  | 'NETWORK_TRANSIENT'
  | 'PAGE_LOAD_TIMEOUT'
  | 'CONTACT_LIST_NOT_READY'
  | 'BROWSER_TRANSIENT'
  | 'CONTACT_NOT_FOUND'
  | 'AMBIGUOUS_CONTACT'
  | 'SELECTOR_FAILURE'
  | 'CONVERSATION_VERIFICATION_FAILED'
  | 'MESSAGE_INPUT_FAILED'
  | 'SEND_ACTION_FAILED'
  | 'VERIFY_FAILED'
  | 'AUTH_EXPIRED'
  | 'AUTH_UNKNOWN'
  | 'TEMPLATE_INVALID'
  | 'CONFIG_INVALID'
  | 'PROCESS_INTERRUPTED_BEFORE_SEND'
  | 'RETRY_WINDOW_EXPIRED'
  | 'MAX_ATTEMPTS_EXHAUSTED'
  | 'DELIVERY_UNKNOWN';

export type ExternalActionState = 'NOT_STARTED' | 'NOT_TRIGGERED' | 'UNCERTAIN';

export class RetryConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryConfigurationError';
  }
}

export function validateMaxAttempts(value: number): number {
  if (!Number.isInteger(value) || value < MIN_MAX_ATTEMPTS || value > MAX_MAX_ATTEMPTS) {
    throw new RetryConfigurationError(
      `maxAttempts must be an integer from ${MIN_MAX_ATTEMPTS} through ${MAX_MAX_ATTEMPTS}.`,
    );
  }
  return value;
}

export function validateRetryIntervalSeconds(value: number): number {
  if (
    !Number.isInteger(value) ||
    value < MIN_RETRY_INTERVAL_SECONDS ||
    value > MAX_RETRY_INTERVAL_SECONDS
  ) {
    throw new RetryConfigurationError(
      `retryIntervalSeconds must be an integer from ${MIN_RETRY_INTERVAL_SECONDS} through ${MAX_RETRY_INTERVAL_SECONDS}.`,
    );
  }
  return value;
}
