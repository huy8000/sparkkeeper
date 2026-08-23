export const SYSTEM_EVENT_LEVELS = ['INFO', 'WARN', 'ERROR'] as const;

export type SystemEventLevel = (typeof SYSTEM_EVENT_LEVELS)[number];

export const RUNTIME_EVENT_TYPES = [
  'RUN_STARTED',
  'RUN_FINISHED',
  'AUTH_CHECKING',
  'AUTH_EXPIRED',
  'AUTH_UNKNOWN',
  'FRIEND_RESOLVING',
  'CONTACT_NOT_FOUND',
  'AMBIGUOUS_CONTACT',
  'MESSAGE_BUILDING',
  'MESSAGE_SENDING',
  'VERIFYING',
  'VERIFY_SUCCESS',
  'RETRY_WAIT',
  'TASK_FAILED',
  'SELECTOR_FAILURE',
  'BROWSER_ERROR',
  'DELIVERY_UNKNOWN',
  'CONVERSATION_VERIFICATION_FAILED',
  'SKIPPED_IDEMPOTENT',
  'CONSECUTIVE_RUN_FAILURE',
  'OBSERVABILITY_ERROR',
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export function isSystemEventLevel(value: unknown): value is SystemEventLevel {
  return typeof value === 'string' && SYSTEM_EVENT_LEVELS.includes(value as SystemEventLevel);
}

export function isRuntimeEventType(value: unknown): value is RuntimeEventType {
  return typeof value === 'string' && RUNTIME_EVENT_TYPES.includes(value as RuntimeEventType);
}
