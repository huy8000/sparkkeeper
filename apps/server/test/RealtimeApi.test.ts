import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApiApplication } from '../src/http/ApiApplication.js';
import { RuntimeEventHub } from '../src/realtime/RuntimeEventHub.js';
import { createAuthenticatedTestSession } from './authFixture.js';

const FIXED_NOW = new Date('2026-03-04T05:06:07.000Z');

test('SSE route streams ready, runtime events, heartbeat, and cleans every connection', async (context) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-realtime-test-'));
  const dbPath = path.join(dir, 'fixture.db');
  const hub = new RuntimeEventHub(() => FIXED_NOW);

  const app = createApiApplication({
    databasePath: dbPath,
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    },
    logger: false,
    clock: () => FIXED_NOW,
    realtime: hub,
    sseHeartbeatMs: 20,
    sseRetryMs: 3_000,
  });

  context.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const session = await createAuthenticatedTestSession(app);

  await app.server.listen({ host: '127.0.0.1', port: 8080 });
  const url = `http://127.0.0.1:8080/api/events/stream`;

  const first = await openStream(url, 8080, session.cookieHeader);
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

  const second = await openStream(url, 8080, session.cookieHeader);
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
  hub.publish({
    type: 'RUNTIME_EVENT',
    data: {
      eventType: 'RUN_FINISHED',
      level: 'info',
      message: 'Daily run finished',
      runId: 'fixture-buffered-run-id',
      runResult: 'SUCCESS',
    },
  });
  await app.server.close();
  await waitFor(() => hub.subscriberCount === 0);
  await waitForStreamEnd(second.reader);
});

test('SSE route requires authenticated session and rejects unauthenticated requests', async (context) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-realtime-test-'));
  const dbPath = path.join(dir, 'fixture.db');
  const hub = new RuntimeEventHub(() => FIXED_NOW);

  const app = createApiApplication({
    databasePath: dbPath,
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    },
    logger: false,
    clock: () => FIXED_NOW,
    realtime: hub,
    sseHeartbeatMs: 20,
    sseRetryMs: 3_000,
  });

  context.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const unauthenticated = await app.server.inject({ method: 'GET', url: '/api/events/stream' });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unauthenticated.json().error.code, 'UNAUTHENTICATED');
  assert.equal(hub.subscriberCount, 0);
});

interface OpenStream {
  readonly response: Response;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly abort: AbortController;
}

async function openStream(url: string, port: number, cookie: string): Promise<OpenStream> {
  const abort = new AbortController();
  const origin = `http://127.0.0.1:${port}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'text/event-stream',
      Origin: origin,
      Host: `127.0.0.1:${port}`,
      'Sec-Fetch-Site': 'same-origin',
      Cookie: cookie,
    },
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

async function waitForStreamEnd(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  for (let bufferedChunk = 0; bufferedChunk < 20; bufferedChunk += 1) {
    let timeout: NodeJS.Timeout | undefined;
    try {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Timed out waiting for the SSE client stream to close.')),
            1_000,
          );
        }),
      ]);
      if (chunk.done) return;
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
  await reader.cancel().catch(() => undefined);
  assert.fail('SSE client stream did not close after draining buffered events.');
}
