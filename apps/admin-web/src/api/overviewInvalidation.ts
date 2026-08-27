import type { RuntimeEventType } from '@sparkkeeper/shared';

import type { RealtimeEvent } from '../types/api';

const OVERVIEW_RUN_EVENTS = new Set<RuntimeEventType>([
  'RUN_STARTED',
  'RUN_FINISHED',
  'AUTH_EXPIRED',
  'TASK_FAILED',
  'DELIVERY_UNKNOWN',
  'VERIFY_SUCCESS',
]);

export function invalidatesOverviewAccounts(event: RealtimeEvent): boolean {
  return event.type === 'CONFIG_CHANGED' && event.data.entityType === 'ACCOUNT';
}

export function invalidatesOverviewRuns(event: RealtimeEvent): boolean {
  return (
    invalidatesOverviewAccounts(event) ||
    (event.type === 'RUNTIME_EVENT' && OVERVIEW_RUN_EVENTS.has(event.data.eventType))
  );
}
