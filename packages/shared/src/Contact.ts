export const CONTACT_TYPES = ['PERSON', 'GROUP', 'SYSTEM', 'UNKNOWN'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export function isContactType(value: unknown): value is ContactType {
  return typeof value === 'string' && CONTACT_TYPES.includes(value as ContactType);
}

export const CONTACT_AVAILABILITY_STATUSES = ['AVAILABLE', 'STALE', 'UNAVAILABLE'] as const;
export type ContactAvailabilityStatus = (typeof CONTACT_AVAILABILITY_STATUSES)[number];

export function isContactAvailabilityStatus(value: unknown): value is ContactAvailabilityStatus {
  return (
    typeof value === 'string' &&
    CONTACT_AVAILABILITY_STATUSES.includes(value as ContactAvailabilityStatus)
  );
}

export const CONTACT_IDENTITY_STATUSES = [
  'READY',
  'UNAVAILABLE',
  'CHANGED',
  'AMBIGUOUS',
  'LEGACY_UNBOUND',
] as const;
export type ContactIdentityStatus = (typeof CONTACT_IDENTITY_STATUSES)[number];

export function isContactIdentityStatus(value: unknown): value is ContactIdentityStatus {
  return (
    typeof value === 'string' && CONTACT_IDENTITY_STATUSES.includes(value as ContactIdentityStatus)
  );
}

export const CONTACT_IDENTITY_KINDS = [
  'SEC_UID',
  'UNIQUE_ID',
  'SHORT_ID',
  'REMARK_NAME',
  'DISPLAY_NAME',
  'CONVERSATION_ID',
] as const;
export type ContactIdentityKind = (typeof CONTACT_IDENTITY_KINDS)[number];

export function isContactIdentityKind(value: unknown): value is ContactIdentityKind {
  return typeof value === 'string' && CONTACT_IDENTITY_KINDS.includes(value as ContactIdentityKind);
}

export const CONTACT_IDENTITY_SOURCES = [
  'DOM',
  'PAGE_DATA',
  'RESPONSE_PARSER',
  'LEGACY_MANUAL',
  'HUMAN_REBIND',
] as const;
export type ContactIdentitySource = (typeof CONTACT_IDENTITY_SOURCES)[number];

export function isContactIdentitySource(value: unknown): value is ContactIdentitySource {
  return (
    typeof value === 'string' && CONTACT_IDENTITY_SOURCES.includes(value as ContactIdentitySource)
  );
}

export const CONTACT_IDENTITY_STATES = ['ACTIVE', 'SUPERSEDED'] as const;
export type ContactIdentityState = (typeof CONTACT_IDENTITY_STATES)[number];

export function isContactIdentityState(value: unknown): value is ContactIdentityState {
  return (
    typeof value === 'string' && CONTACT_IDENTITY_STATES.includes(value as ContactIdentityState)
  );
}

export const CONTACT_SYNC_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETE',
  'PARTIAL',
  'FAILED',
  'AUTH_EXPIRED',
] as const;
export type ContactSyncRunStatus = (typeof CONTACT_SYNC_RUN_STATUSES)[number];

export function isContactSyncRunStatus(value: unknown): value is ContactSyncRunStatus {
  return (
    typeof value === 'string' && CONTACT_SYNC_RUN_STATUSES.includes(value as ContactSyncRunStatus)
  );
}

export const CONTACT_SYNC_FAILURE_CODES = [
  'PROFILE_UNAVAILABLE',
  'PROFILE_BUSY',
  'AUTH_EXPIRED',
  'AUTH_UNKNOWN',
  'CHAT_NOT_READY',
  'DISCOVERY_TIMEOUT',
  'CANDIDATE_LIMIT_REACHED',
  'PARSER_CONTRACT_FAILURE',
  'BROWSER_FAILURE',
  'PERSISTENCE_FAILURE',
] as const;
export type ContactSyncFailureCode = (typeof CONTACT_SYNC_FAILURE_CODES)[number];

export function isContactSyncFailureCode(value: unknown): value is ContactSyncFailureCode {
  return (
    typeof value === 'string' &&
    CONTACT_SYNC_FAILURE_CODES.includes(value as ContactSyncFailureCode)
  );
}

export class ContactValidationError extends Error {
  readonly code:
    | 'INVALID_DISPLAY_NAME'
    | 'INVALID_REMARK_NAME'
    | 'INVALID_IDENTITY_VALUE'
    | 'INVALID_STREAK_DAYS'
    | 'INVALID_AVATAR_URL';

  constructor(code: ContactValidationError['code'], message: string) {
    super(message);
    this.name = 'ContactValidationError';
    this.code = code;
  }
}

export function validateContactDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) {
    throw new ContactValidationError(
      'INVALID_DISPLAY_NAME',
      'Contact display name must not be empty.',
    );
  }
  return trimmed;
}

export function validateOptionalContactString(
  value: string | null | undefined,
  field: 'remarkName' | 'avatarRemoteUrl',
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ContactValidationError(
      field === 'remarkName' ? 'INVALID_REMARK_NAME' : 'INVALID_AVATAR_URL',
      `Contact ${field} must not be empty if provided.`,
    );
  }
  return trimmed;
}

export function validateIdentityValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ContactValidationError('INVALID_IDENTITY_VALUE', 'Identity value must not be empty.');
  }
  return trimmed;
}

export function validateStreakDays(streakDays: number | null | undefined): number | null {
  if (streakDays === null || streakDays === undefined) {
    return null;
  }
  if (!Number.isInteger(streakDays) || streakDays < 0) {
    throw new ContactValidationError(
      'INVALID_STREAK_DAYS',
      'Streak days must be an integer greater than or equal to 0.',
    );
  }
  return streakDays;
}
