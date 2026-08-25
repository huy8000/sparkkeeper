import assert from 'node:assert/strict';
import test from 'node:test';

import { createServer } from '../src/http/createServer.js';
import type { MutationGuardOptions } from '../src/http/plugins/MutationGuard.js';
import type { ApiServices } from '../src/http/services/ApiServices.js';
import { RuntimeEventHub } from '../src/realtime/RuntimeEventHub.js';

const ADMIN_ORIGIN = 'http://127.0.0.1:5173';
const FIXED_NOW = new Date('2026-03-04T05:06:07.000Z');

test('SSE route streams ready, runtime events, heartbeat, and cleans every connection', async (context) => {
  const hub = new RuntimeEventHub(() => FIXED_NOW);
  const allowedHosts = new Set<string>();
  const access: MutationGuardOptions = {
    allowedHosts,
    allowedOrigins: new Set([ADMIN_ORIGIN]),
  };
  const server = createServer({
    services: unusedServices(),
    logger: false,
    realtime: { events: hub, access, heartbeatMs: 20, retryMs: 3_000 },
  });
  context.after(() => server.close());
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  assert.ok(address !== null && typeof address !== 'string');
  allowedHosts.add(`127.0.0.1:${address.port}`);
  const url = `http://127.0.0.1:${address.port}/api/events/stream`;

  const first = await openStream(url);
  assert.equal(first.response.status, 200);
  assert.match(first.response.headers.get('content-type') ?? '', /^text\/event-stream/u);
  assert.equal(first.response.headers.get('cache-control'), 'no-cache, no-transform');
  assert.equal(first.response.headers.get('access-control-allow-origin'), null);
  const firstReady = await readUntil(first.reader, 'event: ready');
  assert.match(firstReady, /retry: 3000/u);
  assert.match(firstReady, /id: 1\nevent: ready/u);
  const readyPayload = extractData(firstReady);
  assert.deepEqual(readyPayload, {
    id: '1',
    type: 'READY',
    timestamp: FIXED_NOW.toISOString(),
    data: { serviceStatus: 'READY' },
  });

  const second = await openStream(url);
  await readUntil(second.reader, 'event: ready');
  assert.equal(hub.subscriberCount, 2);
  hub.publish({
    type: 'RUNTIME_EVENT',
    data: {
      eventType: 'AUTH_EXPIRED',
      level: 'error',
      message: 'Authentication expired',
      runId: 'fixture-run-id',
      errorCode: 'AUTH_EXPIRED',
    },
  });
  const runtimeChunk = await readUntil(first.reader, 'event: runtime');
  assert.match(runtimeChunk, /id: 3\nevent: runtime/u);
  const runtimePayload = extractData(runtimeChunk);
  assert.ok(typeof runtimePayload === 'object' && runtimePayload !== null);
  assert.equal(Reflect.get(runtimePayload, 'type'), 'RUNTIME_EVENT');
  assert.doesNotMatch(
    JSON.stringify(runtimePayload),
    /cookie|token|Authorization|messageText|browserProfile|databasePath|screenshotPath|tracePath|stack|SQL/u,
  );

  const heartbeat = await readUntil(second.reader, ': heartbeat');
  assert.match(heartbeat, /: heartbeat\n\n/u);

  first.abort.abort();
  await waitFor(() => hub.subscriberCount === 1);
  await server.close();
  await waitFor(() => hub.subscriberCount === 0);
  const finalRead = await second.reader.read();
  assert.equal(finalRead.done, true);
});

test('SSE local access guard rejects invalid Host and Origin without mutation headers', async (context) => {
  const hub = new RuntimeEventHub(() => FIXED_NOW);
  const server = createServer({
    services: unusedServices(),
    logger: false,
    realtime: {
      events: hub,
      access: {
        allowedHosts: new Set(['127.0.0.1:8080']),
        allowedOrigins: new Set([ADMIN_ORIGIN]),
      },
      heartbeatMs: 20,
    },
  });
  context.after(() => server.close());

  for (const headers of [
    { host: '127.0.0.1.evil.test:8080', origin: ADMIN_ORIGIN },
    { host: '127.0.0.1:8080', origin: 'http://127.0.0.1.evil.test:5173' },
    { host: 'localhost.evil:5173', origin: 'null' },
  ]) {
    const response = await server.inject({ method: 'GET', url: '/api/events/stream', headers });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'EVENT_STREAM_REJECTED');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  assert.equal(hub.subscriberCount, 0);
});

interface OpenStream {
  readonly response: Response;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly abort: AbortController;
}

async function openStream(url: string): Promise<OpenStream> {
  const abort = new AbortController();
  const response = await fetch(url, {
    headers: { Accept: 'text/event-stream', Origin: ADMIN_ORIGIN },
    signal: abort.signal,
  });
  assert.ok(response.body !== null);
  return { response, reader: response.body.getReader(), abort };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (text.includes(expected)) return text;
  }
  assert.fail(`SSE fixture did not contain ${expected}.`);
}

function extractData(chunk: string): unknown {
  const line = chunk.split('\n').find((candidate) => candidate.startsWith('data: '));
  assert.ok(line !== undefined);
  return JSON.parse(line.slice('data: '.length));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for the SSE lifecycle fixture.');
}

function unusedServices(): ApiServices {
  const unavailable = (): never => {
    throw new Error('Fixture service should not be called.');
  };
  return {
    status: { health: unavailable, runtime: unavailable },
    read: {
      listAccounts: unavailable,
      getAccount: unavailable,
      listFriends: unavailable,
      getFriend: unavailable,
      listSchedules: unavailable,
      getSchedule: unavailable,
      listRuns: unavailable,
      getRun: unavailable,
      listSendRecords: unavailable,
      listSystemEvents: unavailable,
    },
    configuration: {
      createAccount: unavailable,
      updateAccount: unavailable,
      createFriend: unavailable,
      updateFriend: unavailable,
      listTemplates: unavailable,
      getTemplate: unavailable,
      createTemplate: unavailable,
      updateTemplate: unavailable,
      configureSchedule: unavailable,
    },
  };
}
