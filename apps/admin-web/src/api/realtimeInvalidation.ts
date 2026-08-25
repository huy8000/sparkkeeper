import type { RuntimeEventType } from '@sparkkeeper/shared';

import type { RealtimeEvent } from '../types/api';

const RUNTIME_STATUS_EVENTS = new Set<RuntimeEventType>([
  'RUN_STARTED',
  'RUN_FINISHED',
  'AUTH_EXPIRED',
  'TASK_FAILED',
]);

const RUN_LIST_EVENTS = RUNTIME_STATUS_EVENTS;

const RUN_DETAIL_EVENTS = new Set<RuntimeEventType>([
  ...RUN_LIST_EVENTS,
  'AUTH_UNKNOWN',
  'CONTACT_NOT_FOUND',
  'AMBIGUOUS_CONTACT',
  'VERIFY_SUCCESS',
  'RETRY_WAIT',
  'SELECTOR_FAILURE',
  'BROWSER_ERROR',
  'DELIVERY_UNKNOWN',
  'CONVERSATION_VERIFICATION_FAILED',
  'SKIPPED_IDEMPOTENT',
]);

export function invalidatesRuntimeStatus(event: RealtimeEvent): boolean {
  return (
    event.type === 'READY' ||
    event.type === 'CONFIG_CHANGED' ||
    (event.type === 'RUNTIME_EVENT' && RUNTIME_STATUS_EVENTS.has(event.data.eventType))
  );
}

export function invalidatesRunList(event: RealtimeEvent): boolean {
  return (
    event.type === 'RUNTIME_EVENT' &&
    event.data.runId !== undefined &&
    RUN_LIST_EVENTS.has(event.data.eventType)
  );
}

export function invalidatesRunDetail(event: RealtimeEvent, runId: string): boolean {
  return (
    event.type === 'RUNTIME_EVENT' &&
    event.data.runId === runId &&
    RUN_DETAIL_EVENTS.has(event.data.eventType)
  );
}
