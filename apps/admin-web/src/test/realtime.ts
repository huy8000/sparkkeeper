import { vi } from 'vitest';

type Listener = (event: unknown) => void;

export class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Set<Listener>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, data?: unknown): void {
    const event = data === undefined ? new Event(type) : { data: JSON.stringify(data) };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  emitRaw(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  close(): void {
    this.closed = true;
  }
}

export function installEventSource(): typeof FakeEventSource {
  FakeEventSource.instances.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  return FakeEventSource;
}

export function readyEvent(id = '1') {
  return {
    id,
    type: 'READY',
    timestamp: '2026-01-02T03:04:05.000Z',
    data: { serviceStatus: 'READY' },
  } as const;
}

export function runtimeEvent(runId: string, eventType = 'RUN_STARTED', id = '2') {
  return {
    id,
    type: 'RUNTIME_EVENT',
    timestamp: '2026-01-02T03:04:05.000Z',
    data: {
      eventType,
      level: 'info',
      message: 'A safe fixture runtime event.',
      runId,
      businessDate: '2026-01-02',
    },
  } as const;
}

export function configEvent(
  entityType: 'ACCOUNT' | 'FRIEND' | 'TEMPLATE' | 'SCHEDULE',
  entityId: string,
  accountId?: string,
  id = '3',
) {
  return {
    id,
    type: 'CONFIG_CHANGED',
    timestamp: '2026-01-02T03:04:05.000Z',
    data: {
      entityType,
      entityId,
      ...(accountId === undefined ? {} : { accountId }),
    },
  } as const;
}
