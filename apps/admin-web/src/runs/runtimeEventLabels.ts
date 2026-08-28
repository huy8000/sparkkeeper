import type { RuntimeEventType } from '../types/api';

/**
 * V3 centralized runtime-event → translation key mapping. Timeline items must
 * never present raw enums (RUN_STARTED, FRIEND_RESOLVING, …) as their only
 * text, and per-language label text lives only in the locale resources.
 */
const RUNTIME_EVENT_KEYS: Record<RuntimeEventType, string> = {
  RUN_STARTED: 'runtimeEvent.runStarted',
  RUN_FINISHED: 'runtimeEvent.runFinished',
  AUTH_CHECKING: 'runtimeEvent.authChecking',
  AUTH_EXPIRED: 'runtimeEvent.authExpired',
  AUTH_UNKNOWN: 'runtimeEvent.authUnknown',
  FRIEND_RESOLVING: 'runtimeEvent.friendResolving',
  CONTACT_NOT_FOUND: 'runtimeEvent.contactNotFound',
  AMBIGUOUS_CONTACT: 'runtimeEvent.ambiguousContact',
  MESSAGE_BUILDING: 'runtimeEvent.messageBuilding',
  MESSAGE_SENDING: 'runtimeEvent.messageSending',
  VERIFYING: 'runtimeEvent.verifying',
  VERIFY_SUCCESS: 'runtimeEvent.verifySuccess',
  RETRY_WAIT: 'runtimeEvent.retryWait',
  TASK_FAILED: 'runtimeEvent.taskFailed',
  SELECTOR_FAILURE: 'runtimeEvent.selectorFailure',
  BROWSER_ERROR: 'runtimeEvent.browserError',
  DELIVERY_UNKNOWN: 'runtimeEvent.deliveryUnknown',
  CONVERSATION_VERIFICATION_FAILED: 'runtimeEvent.conversationVerificationFailed',
  SKIPPED_IDEMPOTENT: 'runtimeEvent.skippedIdempotent',
  CONSECUTIVE_RUN_FAILURE: 'runtimeEvent.consecutiveRunFailure',
  OBSERVABILITY_ERROR: 'runtimeEvent.observabilityError',
};

/** Translation key for a persisted runtime event; unknown values get a safe fallback key. */
export function runtimeEventKey(eventType: RuntimeEventType | (string & {})): string {
  return RUNTIME_EVENT_KEYS[eventType as RuntimeEventType] ?? 'runtimeEvent.unknown';
}

/** Whether the event type is part of the known V3 mapping (unknown enums render secondary). */
export function isKnownRuntimeEvent(eventType: string): eventType is RuntimeEventType {
  return Object.hasOwn(RUNTIME_EVENT_KEYS, eventType);
}
