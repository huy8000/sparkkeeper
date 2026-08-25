import type {
  RealtimeConfigData,
  RealtimeEvent,
  RealtimeEventInput,
  RealtimeEventSource,
  RealtimeReadyEvent,
  RealtimeRuntimeData,
  RealtimeSubscriber,
} from './RealtimeEvent.js';

export class RuntimeEventHub implements RealtimeEventSource {
  private sequence = 0;
  private readonly subscribers = new Set<RealtimeSubscriber>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  publish(input: RealtimeEventInput): void {
    const event = this.createEvent(input);
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber(event);
      } catch {
        // A realtime subscriber is an optional side channel and cannot block others.
      }
    }
  }

  createReadyEvent(): RealtimeReadyEvent {
    return Object.freeze({
      id: this.nextId(),
      type: 'READY',
      timestamp: this.clock().toISOString(),
      data: Object.freeze({ serviceStatus: 'READY' as const }),
    });
  }

  subscribe(subscriber: RealtimeSubscriber): () => void {
    this.subscribers.add(subscriber);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.subscribers.delete(subscriber);
    };
  }

  private createEvent(input: RealtimeEventInput): Exclude<RealtimeEvent, RealtimeReadyEvent> {
    const id = this.nextId();
    const timestamp = this.clock().toISOString();
    return input.type === 'RUNTIME_EVENT'
      ? Object.freeze({
          id,
          timestamp,
          type: 'RUNTIME_EVENT' as const,
          data: projectRuntimeData(input.data),
        })
      : Object.freeze({
          id,
          timestamp,
          type: 'CONFIG_CHANGED' as const,
          data: projectConfigData(input.data),
        });
  }

  private nextId(): string {
    this.sequence += 1;
    return String(this.sequence);
  }
}

function projectRuntimeData(data: RealtimeRuntimeData): RealtimeRuntimeData {
  return Object.freeze({
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
  });
}

function projectConfigData(data: RealtimeConfigData): RealtimeConfigData {
  return Object.freeze({
    entityType: data.entityType,
    entityId: data.entityId,
    ...(data.accountId === undefined ? {} : { accountId: data.accountId }),
  });
}
