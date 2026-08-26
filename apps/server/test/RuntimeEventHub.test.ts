import assert from 'node:assert/strict';
import test from 'node:test';

import type { RealtimeConfigEvent, RealtimeRuntimeEvent } from '../src/realtime/RealtimeEvent.js';
import { RuntimeEventHub } from '../src/realtime/RuntimeEventHub.js';

const FIXED_NOW = new Date('2026-03-04T05:06:07.000Z');

test('RuntimeEventHub publishes monotonic safe events to multiple subscribers', () => {
  const hub = new RuntimeEventHub(() => FIXED_NOW);
  const received: Array<RealtimeRuntimeEvent | RealtimeConfigEvent> = [];
  hub.subscribe(() => {
    throw new Error('fixture subscriber failure');
  });
  const unsubscribe = hub.subscribe((event) => received.push(event));

  const ready = hub.createReadyEvent();
  hub.publish({
    type: 'RUNTIME_EVENT',
    data: {
      eventType: 'RUN_STARTED',
      level: 'info',
      message: 'Daily run started',
      runId: 'fixture-run-id',
      accountId: 'fixture-account-id',
      businessDate: '2026-03-04',
    },
  });
  hub.publish({
    type: 'CONFIG_CHANGED',
    data: {
      entityType: 'FRIEND',
      entityId: 'fixture-friend-id',
      accountId: 'fixture-account-id',
    },
  });

  assert.equal(ready.id, '1');
  assert.equal(ready.timestamp, FIXED_NOW.toISOString());
  assert.deepEqual(
    received.map((event) => event.id),
    ['2', '3'],
  );
  assert.equal(hub.subscriberCount, 2);
  unsubscribe();
  unsubscribe();
  assert.equal(hub.subscriberCount, 1);
});

test('RuntimeEventHub publish is safe without subscribers and exposes no private payload fields', () => {
  const hub = new RuntimeEventHub(() => FIXED_NOW);
  assert.doesNotThrow(() =>
    hub.publish({
      type: 'RUNTIME_EVENT',
      data: {
        eventType: 'TASK_FAILED',
        level: 'error',
        message: 'Task finished with failure',
        errorCode: 'FIXTURE_FAILURE',
      },
    }),
  );

  const events: unknown[] = [];
  hub.subscribe((event) => events.push(event));
  hub.publish({
    type: 'CONFIG_CHANGED',
    data: { entityType: 'TEMPLATE', entityId: 'fixture-template-id' },
  });
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(
    serialized,
    /messageText|cookie|token|Authorization|browserProfile|databasePath|screenshotPath|tracePath|stack|SQL/u,
  );
});

test('RuntimeEventHub projects and freezes producer data at the broadcast boundary', () => {
  const hub = new RuntimeEventHub(() => FIXED_NOW);
  const received: unknown[] = [];
  hub.subscribe((event) => {
    assert.equal(Reflect.set(event.data, 'token', 'SUBSCRIBER_TOKEN_SENTINEL'), false);
  });
  hub.subscribe((event) => received.push(event));

  hub.publish({
    type: 'RUNTIME_EVENT',
    data: {
      eventType: 'TASK_FAILED',
      level: 'error',
      message: 'Task finished with failure',
      runId: 'fixture-run-id',
      messageText: 'PRIVATE_MESSAGE_SENTINEL',
      cookie: 'PRIVATE_COOKIE_SENTINEL',
      token: 'PRIVATE_TOKEN_SENTINEL',
      screenshotPath: '/private/evidence',
    },
  } as Parameters<RuntimeEventHub['publish']>[0]);

  const serialized = JSON.stringify(received);
  assert.doesNotMatch(
    serialized,
    /PRIVATE_|SUBSCRIBER_|messageText|cookie|token|screenshotPath|\/private\/evidence/u,
  );
});
