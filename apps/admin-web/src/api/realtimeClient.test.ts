import { describe, expect, it, vi } from 'vitest';

import { RUN_ID } from '../test/fixtures';
import { FakeEventSource, configEvent, readyEvent, runtimeEvent } from '../test/realtime';
import { RealtimeClient, parseRealtimeEvent } from './realtimeClient';

describe('RealtimeClient', () => {
  it('connects once, reports lifecycle state, receives known events, and cleans up', () => {
    const source = new FakeEventSource('/api/events/stream');
    const client = new RealtimeClient('/api/events/stream', () => source);
    const states: string[] = [];
    const events: string[] = [];
    client.subscribeState((state) => states.push(state));
    client.subscribe((event) => events.push(event.type));

    client.connect();
    client.connect();
    source.emit('open');
    source.emit('ready', readyEvent());
    source.emit('runtime', runtimeEvent(RUN_ID));
    source.emit('config-changed', configEvent('ACCOUNT', 'fixture-account-id'));
    source.emit('error');
    client.disconnect();

    expect(states).toEqual([
      'DISCONNECTED',
      'CONNECTING',
      'CONNECTED',
      'RECONNECTING',
      'DISCONNECTED',
    ]);
    expect(events).toEqual(['READY', 'RUNTIME_EVENT', 'CONFIG_CHANGED']);
    expect(source.closed).toBe(true);
  });

  it('shares one EventSource across multiple event and state subscribers', () => {
    const source = new FakeEventSource('/api/events/stream');
    const factory = vi.fn(() => source);
    const client = new RealtimeClient('/api/events/stream', factory);
    const first = vi.fn();
    const second = vi.fn();
    const firstState = vi.fn();
    const secondState = vi.fn();
    client.subscribe(first);
    client.subscribe(second);
    client.subscribeState(firstState);
    client.subscribeState(secondState);

    client.connect();
    client.connect();
    source.emit('runtime', runtimeEvent(RUN_ID));

    expect(factory).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(firstState).toHaveBeenCalledWith('CONNECTING');
    expect(secondState).toHaveBeenCalledWith('CONNECTING');
  });

  it('ignores malformed, mismatched, and unknown events without exposing raw payloads', () => {
    const source = new FakeEventSource('/api/events/stream');
    const client = new RealtimeClient('/api/events/stream', () => source);
    const subscriber = vi.fn();
    client.subscribe(subscriber);
    client.connect();

    source.emitRaw('runtime', '{broken');
    source.emit('runtime', readyEvent());
    source.emit('runtime', {
      id: '4',
      type: 'UNKNOWN_EVENT',
      timestamp: '2026-01-02T03:04:05.000Z',
      data: { stack: 'PRIVATE_STACK_SENTINEL' },
    });
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('allowlists parsed runtime fields and drops sensitive extras', () => {
    const parsed = parseRealtimeEvent(
      JSON.stringify({
        ...runtimeEvent(RUN_ID),
        data: {
          ...runtimeEvent(RUN_ID).data,
          messageText: 'PRIVATE_MESSAGE_SENTINEL',
          cookie: 'PRIVATE_COOKIE_SENTINEL',
          token: 'PRIVATE_TOKEN_SENTINEL',
          browserProfilePath: '/private/profile',
          screenshotPath: '/private/evidence',
          stack: 'PRIVATE_STACK_SENTINEL',
        },
      }),
      'RUNTIME_EVENT',
    );
    const serialized = JSON.stringify(parsed);

    expect(parsed?.type).toBe('RUNTIME_EVENT');
    expect(serialized).not.toMatch(
      /PRIVATE_|messageText|cookie|token|browserProfile|screenshotPath|stack/u,
    );
  });

  it('falls back to disconnected when EventSource construction fails', () => {
    const client = new RealtimeClient('/api/events/stream', () => {
      throw new Error('fixture connection failure');
    });
    const states: string[] = [];
    client.subscribeState((state) => states.push(state));
    expect(() => client.connect()).not.toThrow();
    expect(states).toEqual(['DISCONNECTED', 'CONNECTING', 'DISCONNECTED']);
  });

  it('isolates failing state subscribers from the connection lifecycle and other listeners', () => {
    const source = new FakeEventSource('/api/events/stream');
    const client = new RealtimeClient('/api/events/stream', () => source);
    const states: string[] = [];
    client.subscribeState(() => {
      throw new Error('fixture state subscriber failure');
    });
    client.subscribeState((state) => states.push(state));

    expect(() => {
      client.connect();
      source.emit('open');
      source.emit('error');
    }).not.toThrow();
    expect(states).toEqual(['DISCONNECTED', 'CONNECTING', 'CONNECTED', 'RECONNECTING']);
  });
});
