export const AUDIT_OUTCOMES = ['SUCCESS', 'REJECTED', 'FAILED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export function isAuditOutcome(value: unknown): value is AuditOutcome {
  return typeof value === 'string' && AUDIT_OUTCOMES.includes(value as AuditOutcome);
}

export const AUDIT_ACTIONS = [
  'ADMIN_INITIALIZED',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'LOGOUT',
  'SESSION_REVOKED',
  'PASSWORD_CHANGED',
  'ACCOUNT_LOGIN_STARTED',
  'ACCOUNT_LOGIN_CANCELLED',
  'ACCOUNT_CREATED',
  'ACCOUNT_RELOGIN_COMPLETED',
  'ACCOUNT_UNBOUND',
  'CONTACT_SYNC_STARTED',
  'CONTACT_SYNC_FINISHED',
  'PREFERRED_IDENTITY_CHANGED',
  'LEGACY_FRIEND_BOUND',
  'LEGACY_FRIEND_DISMISSED',
  'TEMPLATE_CREATED',
  'TEMPLATE_UPDATED',
  'TASK_CREATED',
  'TASK_UPDATED',
  'TASK_ENABLED',
  'TASK_DISABLED',
  'TASK_ARCHIVED',
  'TEST_SEND_CONFIRMED',
  'DELIVERY_RESOLVED',
  'NOTIFICATION_CONFIG_UPDATED',
  'NOTIFICATION_TEST_CONFIRMED',
  'SESSION_CLEANUP',
  'PROFILE_QUARANTINED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && AUDIT_ACTIONS.includes(value as AuditAction);
}

export const AUDIT_ENTITY_TYPES = [
  'ADMIN_USER',
  'ADMIN_SESSION',
  'ACCOUNT_LOGIN_SESSION',
  'DOUYIN_ACCOUNT',
  'CONTACT_SYNC_RUN',
  'CONTACT',
  'CONTACT_IDENTITY',
  'TEMPLATE',
  'SEND_TASK',
  'EXECUTION_RUN',
  'TARGET_SEND_RECORD',
  'DELIVERY_RESOLUTION',
  'NOTIFICATION_CONFIG',
  'LEGACY_FRIEND_BINDING',
  'LEGACY_SCHEDULE_IMPORT',
  'SYSTEM',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export function isAuditEntityType(value: unknown): value is AuditEntityType {
  return typeof value === 'string' && AUDIT_ENTITY_TYPES.includes(value as AuditEntityType);
}

export class AuditValidationError extends Error {
  readonly code: 'INVALID_REASON_CODE' | 'INVALID_CORRELATION_DIGEST';

  constructor(code: AuditValidationError['code'], message: string) {
    super(message);
    this.name = 'AuditValidationError';
    this.code = code;
  }
}

const REASON_CODE_REGEX = /^[A-Z][A-Z0-9_]{0,63}$/;

export function validateAuditReasonCode(reasonCode: string | null | undefined): string | null {
  if (reasonCode === null || reasonCode === undefined) {
    return null;
  }
  const trimmed = reasonCode.trim();
  if (trimmed.length === 0 || !REASON_CODE_REGEX.test(trimmed)) {
    throw new AuditValidationError(
      'INVALID_REASON_CODE',
      'Audit reason code must be an uppercase alphanumeric identifier matching ^[A-Z][A-Z0-9_]{0,63}$.',
    );
  }
  return trimmed;
}

export function validateCorrelationDigest(digest: string | null | undefined): string | null {
  if (digest === null || digest === undefined) {
    return null;
  }
  const trimmed = digest.trim();
  if (trimmed.length === 0) {
    throw new AuditValidationError(
      'INVALID_CORRELATION_DIGEST',
      'Correlation digest must not be empty if provided.',
    );
  }
  return trimmed;
}
