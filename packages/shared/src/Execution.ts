export const EXECUTION_RUN_KINDS = ['TEST_SEND', 'SCHEDULED_TASK'] as const;
export type ExecutionRunKind = (typeof EXECUTION_RUN_KINDS)[number];

export function isExecutionRunKind(value: unknown): value is ExecutionRunKind {
  return typeof value === 'string' && EXECUTION_RUN_KINDS.includes(value as ExecutionRunKind);
}

export const EXECUTION_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'PARTIAL_FAILED',
  'FAILED',
  'DELIVERY_UNKNOWN',
  'AUTH_EXPIRED',
  'CANCELLED',
] as const;
export type ExecutionRunStatus = (typeof EXECUTION_RUN_STATUSES)[number];

export function isExecutionRunStatus(value: unknown): value is ExecutionRunStatus {
  return typeof value === 'string' && EXECUTION_RUN_STATUSES.includes(value as ExecutionRunStatus);
}

export const TARGET_SEND_MACHINE_STATUSES = [
  'READY',
  'RUNNING',
  'RETRY_WAIT',
  'SUCCESS',
  'FAILED',
  'DELIVERY_UNKNOWN',
  'SKIPPED',
] as const;
export type TargetSendMachineStatus = (typeof TARGET_SEND_MACHINE_STATUSES)[number];

export function isTargetSendMachineStatus(value: unknown): value is TargetSendMachineStatus {
  return (
    typeof value === 'string' &&
    TARGET_SEND_MACHINE_STATUSES.includes(value as TargetSendMachineStatus)
  );
}

export const TARGET_SEND_FAILURE_CODES = [
  'NAVIGATION_FAILED',
  'PAGE_LOAD_TIMEOUT',
  'CONTACT_LIST_NOT_READY',
  'TARGET_NOT_FOUND',
  'TARGET_AMBIGUOUS',
  'TARGET_IDENTITY_UNAVAILABLE',
  'IDENTITY_CHANGED',
  'CONVERSATION_VERIFICATION_FAILED',
  'COMPOSER_NOT_READY',
  'MESSAGE_INPUT_FAILED',
  'SEND_ACTION_NOT_TRIGGERED',
  'AUTH_EXPIRED',
  'AUTH_UNKNOWN',
  'CAPTCHA_OR_RISK_CONTROL',
  'BROWSER_FAILURE',
  'PROFILE_UNAVAILABLE',
  'TEMPLATE_INVALID',
  'CONFIG_INVALID',
  'PROCESS_INTERRUPTED_BEFORE_SEND',
  'RETRY_WINDOW_EXPIRED',
  'MAX_ATTEMPTS_EXHAUSTED',
  'BATCH_ABORTED',
  'DELIVERY_VERIFICATION_TIMEOUT',
  'DELIVERY_EVIDENCE_INSUFFICIENT',
  'PAGE_CLOSED_AFTER_ACTION',
  'NAVIGATION_AFTER_ACTION',
  'AUTH_STATE_CHANGED_AFTER_ACTION',
  'PROCESS_INTERRUPTED_AFTER_ACTION',
] as const;
export type TargetSendFailureCode = (typeof TARGET_SEND_FAILURE_CODES)[number];

export function isTargetSendFailureCode(value: unknown): value is TargetSendFailureCode {
  return (
    typeof value === 'string' && TARGET_SEND_FAILURE_CODES.includes(value as TargetSendFailureCode)
  );
}

export const DELIVERY_RESOLUTION_VALUES = [
  'CONFIRMED_DELIVERED',
  'CONFIRMED_NOT_DELIVERED',
  'INCONCLUSIVE',
] as const;
export type DeliveryResolutionValue = (typeof DELIVERY_RESOLUTION_VALUES)[number];

export function isDeliveryResolutionValue(value: unknown): value is DeliveryResolutionValue {
  return (
    typeof value === 'string' &&
    DELIVERY_RESOLUTION_VALUES.includes(value as DeliveryResolutionValue)
  );
}

export const DELIVERY_RESOLUTION_SOURCES = ['HUMAN'] as const;
export type DeliveryResolutionSource = (typeof DELIVERY_RESOLUTION_SOURCES)[number];

export function isDeliveryResolutionSource(value: unknown): value is DeliveryResolutionSource {
  return (
    typeof value === 'string' &&
    DELIVERY_RESOLUTION_SOURCES.includes(value as DeliveryResolutionSource)
  );
}

export const LEGACY_BINDING_STATUSES = ['PENDING', 'BOUND', 'DISMISSED'] as const;
export type LegacyBindingStatus = (typeof LEGACY_BINDING_STATUSES)[number];

export function isLegacyBindingStatus(value: unknown): value is LegacyBindingStatus {
  return (
    typeof value === 'string' && LEGACY_BINDING_STATUSES.includes(value as LegacyBindingStatus)
  );
}

export const LEGACY_SCHEDULE_IMPORT_STATUSES = ['PENDING', 'CONVERTED', 'DISMISSED'] as const;
export type LegacyScheduleImportStatus = (typeof LEGACY_SCHEDULE_IMPORT_STATUSES)[number];

export function isLegacyScheduleImportStatus(value: unknown): value is LegacyScheduleImportStatus {
  return (
    typeof value === 'string' &&
    LEGACY_SCHEDULE_IMPORT_STATUSES.includes(value as LegacyScheduleImportStatus)
  );
}

export class ExecutionValidationError extends Error {
  readonly code: 'INVALID_IDEMPOTENCY_KEY' | 'INVALID_MESSAGE_TEXT' | 'INVALID_RESOLUTION_NOTE';

  constructor(code: ExecutionValidationError['code'], message: string) {
    super(message);
    this.name = 'ExecutionValidationError';
    this.code = code;
  }
}

export function validateIdempotencyKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new ExecutionValidationError(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency key must not be empty.',
    );
  }
  return trimmed;
}

export function validateResolutionNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined) {
    return null;
  }
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    throw new ExecutionValidationError(
      'INVALID_RESOLUTION_NOTE',
      'Resolution note must not be empty if provided.',
    );
  }
  // Check Unicode code point length <= 500
  const codePoints = Array.from(trimmed);
  if (codePoints.length > 500) {
    throw new ExecutionValidationError(
      'INVALID_RESOLUTION_NOTE',
      'Resolution note must be at most 500 Unicode code points.',
    );
  }
  return trimmed;
}
