import { isRuntimeEventType } from '@sparkkeeper/shared';

import type {
  ConfigEntityType,
  RealtimeConnectionState,
  RealtimeEvent,
  RealtimeRuntimeEvent,
} from '../types/api';
import { normalizeBaseUrl } from './client';

interface EventSourceMessage {
  readonly data: string;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;
export type RealtimeEventSubscriber = (event: RealtimeEvent) => void;
export type RealtimeStateSubscriber = (state: RealtimeConnectionState) => void;

export class RealtimeClient {
  private source: EventSourceLike | undefined;
  private state: RealtimeConnectionState = 'DISCONNECTED';
  private readonly eventSubscribers = new Set<RealtimeEventSubscriber>();
  private readonly stateSubscribers = new Set<RealtimeStateSubscriber>();

  constructor(
    private readonly url = `${normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL)}/events/stream`,
    private readonly createEventSource: EventSourceFactory = defaultEventSourceFactory,
  ) {}

  connect(): void {
    if (this.source !== undefined) return;
    this.setState('CONNECTING');
    try {
      const source = this.createEventSource(this.url);
      this.source = source;
      source.addEventListener('open', () => this.setState('CONNECTED'));
      source.addEventListener('error', () => {
        if (this.source === source) this.setState('RECONNECTING');
      });
      source.addEventListener('ready', (event) => this.receive(source, event, 'READY'));
      source.addEventListener('runtime', (event) => this.receive(source, event, 'RUNTIME_EVENT'));
      source.addEventListener('config-changed', (event) =>
        this.receive(source, event, 'CONFIG_CHANGED'),
      );
    } catch {
      this.source = undefined;
      this.setState('DISCONNECTED');
    }
  }

  disconnect(): void {
    const source = this.source;
    this.source = undefined;
    source?.close();
    this.setState('DISCONNECTED');
  }

  subscribe(subscriber: RealtimeEventSubscriber): () => void {
    this.eventSubscribers.add(subscriber);
    return () => this.eventSubscribers.delete(subscriber);
  }

  subscribeState(subscriber: RealtimeStateSubscriber): () => void {
    this.stateSubscribers.add(subscriber);
    notifyStateSubscriber(subscriber, this.state);
    return () => this.stateSubscribers.delete(subscriber);
  }

  private receive(
    source: EventSourceLike,
    rawEvent: unknown,
    expectedType: RealtimeEvent['type'],
  ): void {
    if (this.source !== source || !isEventSourceMessage(rawEvent)) return;
    const event = parseRealtimeEvent(rawEvent.data, expectedType);
    if (event === undefined) return;
    if (event.type === 'READY') this.setState('CONNECTED');
    for (const subscriber of [...this.eventSubscribers]) {
      try {
        subscriber(event);
      } catch {
        // One UI subscriber cannot disrupt the shared realtime connection.
      }
    }
  }

  private setState(state: RealtimeConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    for (const subscriber of [...this.stateSubscribers]) notifyStateSubscriber(subscriber, state);
  }
}

function notifyStateSubscriber(
  subscriber: RealtimeStateSubscriber,
  state: RealtimeConnectionState,
): void {
  try {
    subscriber(state);
  } catch {
    // One UI state subscriber cannot disrupt the shared realtime connection.
  }
}

export function parseRealtimeEvent(
  value: string,
  expectedType?: RealtimeEvent['type'],
): RealtimeEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const event = record(parsed);
  if (event === undefined || !nonblank(event.id) || !validTimestamp(event.timestamp))
    return undefined;
  const id = event.id;
  const timestamp = event.timestamp;
  if (event.type !== 'READY' && event.type !== 'RUNTIME_EVENT' && event.type !== 'CONFIG_CHANGED') {
    return undefined;
  }
  if (expectedType !== undefined && event.type !== expectedType) return undefined;
  if (event.type === 'READY') return parseReadyEvent(event, id, timestamp);
  if (event.type === 'CONFIG_CHANGED') return parseConfigEvent(event, id, timestamp);
  return parseRuntimeEvent(event, id, timestamp);
}

function parseReadyEvent(
  event: Record<string, unknown>,
  id: string,
  timestamp: string,
): RealtimeEvent | undefined {
  const data = record(event.data);
  if (data?.serviceStatus !== 'READY') return undefined;
  return {
    id,
    type: 'READY',
    timestamp,
    data: { serviceStatus: 'READY' },
  };
}

function parseConfigEvent(
  event: Record<string, unknown>,
  id: string,
  timestamp: string,
): RealtimeEvent | undefined {
  const data = record(event.data);
  if (
    data === undefined ||
    !isConfigEntityType(data.entityType) ||
    !nonblank(data.entityId) ||
    !optionalString(data.accountId)
  ) {
    return undefined;
  }
  return {
    id,
    type: 'CONFIG_CHANGED',
    timestamp,
    data: {
      entityType: data.entityType,
      entityId: data.entityId,
      ...(data.accountId === undefined ? {} : { accountId: data.accountId }),
    },
  };
}

function parseRuntimeEvent(
  event: Record<string, unknown>,
  id: string,
  timestamp: string,
): RealtimeEvent | undefined {
  const data = record(event.data);
  if (
    data === undefined ||
    !isRuntimeEventType(data.eventType) ||
    !isRuntimeLevel(data.level) ||
    !nonblank(data.message) ||
    !optionalString(data.runId) ||
    !optionalString(data.accountId) ||
    !optionalString(data.friendId) ||
    !optionalBusinessDate(data.businessDate) ||
    !optionalPositiveInteger(data.attempt) ||
    !optionalString(data.errorCode) ||
    !optionalTimestamp(data.nextRetryAt) ||
    !optionalNonnegativeInteger(data.successCount) ||
    !optionalNonnegativeInteger(data.failedCount) ||
    !optionalNonnegativeInteger(data.retryWaitCount) ||
    !optionalNonnegativeInteger(data.idempotentSkipCount) ||
    !optionalRunResult(data.runResult)
  ) {
    return undefined;
  }
  const safeData: RealtimeRuntimeEvent['data'] = {
    eventType: data.eventType,
    level: data.level,
    message: data.message,
    ...(data.runId === undefined ? {} : { runId: data.runId }),
    ...(data.accountId === undefined ? {} : { accountId: data.accountId }),
    ...(data.friendId === undefined ? {} : { friendId: data.friendId }),
    ...(data.businessDate === undefined ? {} : { businessDate: data.businessDate }),
    ...(data.attempt === undefined ? {} : { attempt: data.attempt }),
    ...(data.errorCode === undefined ? {} : { errorCode: data.errorCode }),
    ...(data.nextRetryAt === undefined ? {} : { nextRetryAt: data.nextRetryAt }),
    ...(data.successCount === undefined ? {} : { successCount: data.successCount }),
    ...(data.failedCount === undefined ? {} : { failedCount: data.failedCount }),
    ...(data.retryWaitCount === undefined ? {} : { retryWaitCount: data.retryWaitCount }),
    ...(data.idempotentSkipCount === undefined
      ? {}
      : { idempotentSkipCount: data.idempotentSkipCount }),
    ...(data.runResult === undefined ? {} : { runResult: data.runResult }),
  };
  return {
    id,
    type: 'RUNTIME_EVENT',
    timestamp,
    data: safeData,
  };
}

function defaultEventSourceFactory(url: string): EventSourceLike {
  if (typeof globalThis.EventSource !== 'function') throw new Error('EventSource is unavailable.');
  return new globalThis.EventSource(url) as unknown as EventSourceLike;
}

function isEventSourceMessage(value: unknown): value is EventSourceMessage {
  const candidate = record(value);
  return candidate !== undefined && typeof candidate.data === 'string';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || nonblank(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function optionalTimestamp(value: unknown): value is string | undefined {
  return value === undefined || validTimestamp(value);
}

function optionalBusinessDate(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function optionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || (Number.isInteger(value) && (value as number) > 0);
}

function optionalNonnegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || (Number.isInteger(value) && (value as number) >= 0);
}

function isRuntimeLevel(value: unknown): value is RealtimeRuntimeEvent['data']['level'] {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

function optionalRunResult(
  value: unknown,
): value is RealtimeRuntimeEvent['data']['runResult'] | undefined {
  return (
    value === undefined ||
    value === 'SUCCESS' ||
    value === 'FAILED' ||
    value === 'AUTH_EXPIRED' ||
    value === 'RETRY_WAIT' ||
    value === 'SKIPPED'
  );
}

function isConfigEntityType(value: unknown): value is ConfigEntityType {
  return (
    value === 'ACCOUNT' ||
    value === 'FRIEND' ||
    value === 'TEMPLATE' ||
    value === 'SCHEDULE' ||
    value === 'NOTIFICATION'
  );
}
