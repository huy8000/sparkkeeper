import type { RuntimeEventType } from '@sparkkeeper/shared';

import type { RealtimeEvent } from '../types/api';

const RUN_EVENTS = new Set<RuntimeEventType>([
  'RUN_STARTED',
  'RUN_FINISHED',
  'AUTH_EXPIRED',
  'TASK_FAILED',
]);

export function invalidatesWorkspaceAccount(event: RealtimeEvent, accountId: string): boolean {
  return (
    event.type === 'CONFIG_CHANGED' &&
    event.data.entityType === 'ACCOUNT' &&
    event.data.entityId === accountId
  );
}

export function invalidatesWorkspaceFriends(event: RealtimeEvent, accountId: string): boolean {
  return (
    event.type === 'CONFIG_CHANGED' &&
    event.data.entityType === 'FRIEND' &&
    event.data.accountId === accountId
  );
}

export function invalidatesWorkspaceSchedule(event: RealtimeEvent, accountId: string): boolean {
  return (
    event.type === 'CONFIG_CHANGED' &&
    event.data.entityType === 'SCHEDULE' &&
    event.data.accountId === accountId
  );
}

export function invalidatesWorkspaceTemplates(event: RealtimeEvent): boolean {
  return event.type === 'CONFIG_CHANGED' && event.data.entityType === 'TEMPLATE';
}

export function invalidatesWorkspaceRuns(event: RealtimeEvent, accountId: string): boolean {
  return (
    event.type === 'RUNTIME_EVENT' &&
    event.data.accountId === accountId &&
    RUN_EVENTS.has(event.data.eventType)
  );
}

export function invalidatesWorkspacePreflight(
  event: RealtimeEvent,
  accountId: string,
  templateId: string,
): boolean {
  if (invalidatesWorkspaceRuns(event, accountId)) return true;
  if (event.type !== 'CONFIG_CHANGED') return false;
  if (event.data.entityType === 'ACCOUNT') return event.data.entityId === accountId;
  if (event.data.entityType === 'FRIEND' || event.data.entityType === 'SCHEDULE') {
    return event.data.accountId === accountId;
  }
  return event.data.entityType === 'TEMPLATE' && event.data.entityId === templateId;
}
