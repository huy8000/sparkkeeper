import type { RuntimeEventType } from '../types/api';

/**
 * V3 centralized runtime-event → human label mapping. Timeline items must never
 * present raw enums (RUN_STARTED, FRIEND_RESOLVING, …) as their only text, and
 * future V3-UI-9 localization will extract labels from this single map.
 */
const RUNTIME_EVENT_LABELS: Record<RuntimeEventType, string> = {
  RUN_STARTED: 'Run started',
  RUN_FINISHED: 'Run finished',
  AUTH_CHECKING: 'Checking login',
  AUTH_EXPIRED: 'Login expired',
  AUTH_UNKNOWN: 'Login status uncertain',
  FRIEND_RESOLVING: 'Resolving contact',
  CONTACT_NOT_FOUND: 'Contact not found',
  AMBIGUOUS_CONTACT: 'Ambiguous contact match',
  MESSAGE_BUILDING: 'Preparing message',
  MESSAGE_SENDING: 'Sending message',
  VERIFYING: 'Verifying delivery',
  VERIFY_SUCCESS: 'Delivery verified',
  RETRY_WAIT: 'Waiting to retry',
  TASK_FAILED: 'Delivery attempt failed',
  SELECTOR_FAILURE: 'Page element not found',
  BROWSER_ERROR: 'Browser error',
  DELIVERY_UNKNOWN: 'Delivery uncertain',
  CONVERSATION_VERIFICATION_FAILED: 'Conversation verification failed',
  SKIPPED_IDEMPOTENT: 'Skipped (already sent)',
  CONSECUTIVE_RUN_FAILURE: 'Consecutive run failures',
  OBSERVABILITY_ERROR: 'Observability error',
};

/** Human-readable label for a persisted runtime event; unknown values get a safe fallback. */
export function runtimeEventLabel(eventType: RuntimeEventType | (string & {})): string {
  return RUNTIME_EVENT_LABELS[eventType as RuntimeEventType] ?? 'Unknown runtime event';
}

/** Whether the event type is part of the known V3 mapping (unknown enums render secondary). */
export function isKnownRuntimeEvent(eventType: string): eventType is RuntimeEventType {
  return Object.hasOwn(RUNTIME_EVENT_LABELS, eventType);
}
