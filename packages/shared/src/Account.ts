export const ACCOUNT_PROFILE_STATES = [
  'PROVISIONING',
  'READY',
  'MIGRATION_REQUIRED',
  'MISSING',
  'QUARANTINED',
] as const;
export type AccountProfileState = (typeof ACCOUNT_PROFILE_STATES)[number];

export function isAccountProfileState(value: unknown): value is AccountProfileState {
  return typeof value === 'string' && ACCOUNT_PROFILE_STATES.includes(value as AccountProfileState);
}

export const ACCOUNT_LIFECYCLE_STATUSES = ['ACTIVE', 'UNBOUND'] as const;
export type AccountLifecycleStatus = (typeof ACCOUNT_LIFECYCLE_STATUSES)[number];

export function isAccountLifecycleStatus(value: unknown): value is AccountLifecycleStatus {
  return (
    typeof value === 'string' &&
    ACCOUNT_LIFECYCLE_STATUSES.includes(value as AccountLifecycleStatus)
  );
}

export const ACCOUNT_LOGIN_PURPOSES = ['ADD_ACCOUNT', 'RELOGIN'] as const;
export type AccountLoginPurpose = (typeof ACCOUNT_LOGIN_PURPOSES)[number];

export function isAccountLoginPurpose(value: unknown): value is AccountLoginPurpose {
  return typeof value === 'string' && ACCOUNT_LOGIN_PURPOSES.includes(value as AccountLoginPurpose);
}

export const ACCOUNT_LOGIN_SESSION_STATUSES = [
  'PENDING',
  'STARTING',
  'AWAITING_USER',
  'READY_DETECTED',
  'COMPLETING',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
] as const;
export type AccountLoginSessionStatus = (typeof ACCOUNT_LOGIN_SESSION_STATUSES)[number];

export function isAccountLoginSessionStatus(value: unknown): value is AccountLoginSessionStatus {
  return (
    typeof value === 'string' &&
    ACCOUNT_LOGIN_SESSION_STATUSES.includes(value as AccountLoginSessionStatus)
  );
}

export const ACCOUNT_LOGIN_FAILURE_CODES = [
  'START_FAILED',
  'PROFILE_LEASE_CONFLICT',
  'PROFILE_PREPARE_FAILED',
  'CONSOLE_START_FAILED',
  'AUTH_NOT_READY',
  'PROFILE_IDENTITY_UNAVAILABLE',
  'PROFILE_IDENTITY_CONFLICT',
  'READY_TIMEOUT',
  'PROCESS_EXITED',
  'FINALIZE_FAILED',
  'INTEGRITY_ERROR',
] as const;
export type AccountLoginFailureCode = (typeof ACCOUNT_LOGIN_FAILURE_CODES)[number];

export function isAccountLoginFailureCode(value: unknown): value is AccountLoginFailureCode {
  return (
    typeof value === 'string' &&
    ACCOUNT_LOGIN_FAILURE_CODES.includes(value as AccountLoginFailureCode)
  );
}

export class AccountValidationError extends Error {
  readonly code:
    | 'INVALID_ACCOUNT_NAME'
    | 'INVALID_DOUYIN_ID'
    | 'INVALID_PROFILE_STATE'
    | 'INVALID_LIFECYCLE_STATUS';

  constructor(code: AccountValidationError['code'], message: string) {
    super(message);
    this.name = 'AccountValidationError';
    this.code = code;
  }
}

export function validateAccountName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AccountValidationError('INVALID_ACCOUNT_NAME', 'Account name must not be empty.');
  }
  return trimmed;
}

export function normalizeOptionalIdentifier(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AccountValidationError(
      'INVALID_DOUYIN_ID',
      'Identifier must not be empty if provided.',
    );
  }
  return trimmed;
}
