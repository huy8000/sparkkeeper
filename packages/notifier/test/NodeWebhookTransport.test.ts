import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import test from 'node:test';

import {
  NodeWebhookTransport,
  WebhookTransportError,
  type NotificationPayload,
  type ValidatedWebhookDestination,
} from '../src/index.js';

const payload: NotificationPayload = {
  serviceName: 'SparkKeeper',
  eventType: 'AUTH_EXPIRED',
  severity: 'WARN',
  message: 'Authentication expired',
  timestamp: '2026-08-25T02:20:00.000Z',
};

test('node webhook transport posts JSON to the pinned address without following redirects', async (context) => {
  const received: Array<{ url: string; body: string; headers: IncomingMessage['headers'] }> = [];
  let redirectedRequests = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/redirected') redirectedRequests += 1;
    let body = '';
    for await (const chunk of request) body += String(chunk);
    received.push({ url: request.url ?? '', body, headers: request.headers });
    response.writeHead(302, { Location: '/redirected' });
    response.end('ignored response body');
  });
  const port = await listen(server);
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const result = await new NodeWebhookTransport().deliver({
    destination: destination(`http://public.example:${port}/hook`),
    payload,
    timeoutMs: 1_000,
  });

  assert.equal(result.statusCode, 302);
  assert.equal(redirectedRequests, 0);
  assert.equal(received.length, 1);
  assert.equal(received[0]?.url, '/hook');
  assert.equal(received[0]?.headers['content-type'], 'application/json');
  assert.equal(received[0]?.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(received[0]?.body ?? ''), payload);
});

test('node webhook transport applies a hard request timeout', async (context) => {
  const server = createServer(() => {
    // Intentionally leave the response pending beyond the transport timeout.
  });
  const port = await listen(server);
  context.after(() => {
    server.closeAllConnections();
    server.close();
  });

  await assert.rejects(
    new NodeWebhookTransport().deliver({
      destination: destination(`http://public.example:${port}/timeout`),
      payload,
      timeoutMs: 100,
    }),
    (error: unknown) => error instanceof WebhookTransportError && error.code === 'TIMEOUT',
  );
});

function destination(value: string): ValidatedWebhookDestination {
  return {
    url: new URL(value),
    addresses: [{ address: '127.0.0.1', family: 4 }],
  };
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null)
    throw new Error('Test receiver unavailable.');
  return address.port;
}
