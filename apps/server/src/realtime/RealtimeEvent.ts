import type { BusinessDate, RuntimeEventType } from '@sparkkeeper/shared';

export const CONFIG_ENTITY_TYPES = ['ACCOUNT', 'FRIEND', 'TEMPLATE', 'SCHEDULE'] as const;

export type ConfigEntityType = (typeof CONFIG_ENTITY_TYPES)[number];
export type RealtimeRunResult = 'SUCCESS' | 'FAILED' | 'AUTH_EXPIRED' | 'RETRY_WAIT' | 'SKIPPED';

export interface RealtimeRuntimeData {
  readonly eventType: RuntimeEventType;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly runId?: string;
  readonly accountId?: string;
  readonly friendId?: string;
  readonly businessDate?: BusinessDate;
  readonly attempt?: number;
  readonly errorCode?: string;
  readonly nextRetryAt?: string;
  readonly successCount?: number;
  readonly failedCount?: number;
  readonly retryWaitCount?: number;
  readonly idempotentSkipCount?: number;
  readonly runResult?: RealtimeRunResult;
}

export interface RealtimeConfigData {
  readonly entityType: ConfigEntityType;
  readonly entityId: string;
  readonly accountId?: string;
}

export type RealtimeEventInput =
  | { readonly type: 'RUNTIME_EVENT'; readonly data: RealtimeRuntimeData }
  | { readonly type: 'CONFIG_CHANGED'; readonly data: RealtimeConfigData };

export interface RealtimeReadyEvent {
  readonly id: string;
  readonly type: 'READY';
  readonly timestamp: string;
  readonly data: { readonly serviceStatus: 'READY' };
}

export interface RealtimeRuntimeEvent {
  readonly id: string;
  readonly type: 'RUNTIME_EVENT';
  readonly timestamp: string;
  readonly data: RealtimeRuntimeData;
}

export interface RealtimeConfigEvent {
  readonly id: string;
  readonly type: 'CONFIG_CHANGED';
  readonly timestamp: string;
  readonly data: RealtimeConfigData;
}

export type RealtimeEvent = RealtimeReadyEvent | RealtimeRuntimeEvent | RealtimeConfigEvent;

export interface RealtimeEventPublisher {
  publish(input: RealtimeEventInput): void;
}

export interface RealtimeEventSource extends RealtimeEventPublisher {
  createReadyEvent(): RealtimeReadyEvent;
  subscribe(subscriber: RealtimeSubscriber): () => void;
}

export type RealtimeSubscriber = (event: RealtimeRuntimeEvent | RealtimeConfigEvent) => void;
