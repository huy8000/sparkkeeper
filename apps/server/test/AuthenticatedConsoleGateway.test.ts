import assert from 'node:assert/strict';
import { test } from 'node:test';

import fastifyWebsocket from '@fastify/websocket';
import fastifyCookie from '@fastify/cookie';
import type { AccountOnboardingSession } from '@sparkkeeper/database';
import Fastify from 'fastify';
import WebSocket, { WebSocketServer } from 'ws';

import { resolveHttpConfig } from '../src/http/config/HttpConfig.js';
import { ApiError } from '../src/http/errors/ApiError.js';
import {
  registerAuthenticatedConsoleRoutes,
  type ConsoleSessionSource,
} from '../src/onboarding/AuthenticatedConsoleGateway.js';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID = '00000000-0000-4000-8000-000000000002';
const NOW = new Date('2030-01-01T00:00:00.000Z');
const CONFIG = resolveHttpConfig({
  SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
  SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
});

test('console shell is owner/auth/origin gated and never exposes the loopback endpoint', async () => {
  const server = await createConsoleServer(session('AWAITING_USER'));
  const headers = sameOriginHeaders();

  const unauthenticated = await server.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console`,
    headers,
  });
  assert.equal(unauthenticated.statusCode, 401);

  const shell = await server.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console`,
    headers: { ...headers, 'x-test-admin': ADMIN_ID },
  });
  assert.equal(shell.statusCode, 200);
  assert.equal(shell.headers['cache-control'], 'no-store');
  assert.match(String(shell.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.equal(shell.headers['x-frame-options'], 'DENY');
  assert.doesNotMatch(shell.body, /48321|127\.0\.0\.1/);
  assert.match(shell.body, /assets\/bootstrap\.js/);

  await server.close();
});

test('terminal, foreign, missing-origin and traversal requests fail closed', async () => {
  const terminal = await createConsoleServer(session('COMPLETED'));
  const terminalResponse = await terminal.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console`,
    headers: { ...sameOriginHeaders(), 'x-test-admin': ADMIN_ID },
  });
  assert.equal(terminalResponse.statusCode, 404);
  await terminal.close();

  const active = await createConsoleServer(session('AWAITING_USER'));
  const foreign = await active.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console`,
    headers: { ...sameOriginHeaders(), 'x-test-admin': '00000000-0000-4000-8000-000000000099' },
  });
  assert.equal(foreign.statusCode, 404);

  const noOrigin = await active.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console`,
    headers: { host: CONFIG.canonicalAuthority, 'x-test-admin': ADMIN_ID },
  });
  assert.equal(noOrigin.statusCode, 403);

  const traversal = await active.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console/assets/%2e%2e%2fpackage.js`,
    headers: { ...sameOriginHeaders(), 'x-test-admin': ADMIN_ID },
  });
  assert.equal(traversal.statusCode, 404);
  await active.close();
});

test('private noVNC assets are served only through the authenticated allowlist', async () => {
  const server = await createConsoleServer(session('STARTING'));
  const response = await server.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console/assets/core/rfb.js`,
    headers: { ...sameOriginHeaders(), 'x-test-admin': ADMIN_ID },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.body, /class RFB/);
  assert.doesNotMatch(response.body, /sourceMappingURL/u);
  await server.close();
});

test('same-origin browser GET without Origin is accepted, but a supplied foreign Origin is denied', async () => {
  const server = await createConsoleServer(session('AWAITING_USER'));
  const allowed = await server.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console`,
    headers: {
      host: CONFIG.canonicalAuthority,
      'sec-fetch-site': 'same-origin',
      'x-test-admin': ADMIN_ID,
    },
  });
  assert.equal(allowed.statusCode, 200);
  const rejected = await server.inject({
    method: 'GET',
    url: `/api/account-login-sessions/${SESSION_ID}/console`,
    headers: {
      ...sameOriginHeaders(),
      origin: 'http://evil.example',
      'x-test-admin': ADMIN_ID,
    },
  });
  assert.equal(rejected.statusCode, 403);
  await server.close();
});

test(
  'console WebSocket requires exact Origin and proxies binary only to the in-memory loopback endpoint',
  { timeout: 5_000 },
  async (context) => {
    const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => upstream.once('listening', resolve));
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    upstream.on('connection', (socket) => {
      socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }));
    });
    const server = await createConsoleServer(session('AWAITING_USER'), address.port);
    context.after(async () => {
      for (const client of upstream.clients) client.terminate();
      await server.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });
    const listeningAddress = await server.listen({ host: '127.0.0.1', port: 0 });
    const url = `${listeningAddress.replace(/^http/u, 'ws')}/api/account-login-sessions/${SESSION_ID}/console/ws`;

    const badOrigin = new WebSocket(url, 'binary', {
      headers: {
        host: CONFIG.canonicalAuthority,
        origin: 'http://evil.example',
        'sec-fetch-site': 'same-origin',
        'x-test-admin': ADMIN_ID,
      },
    });
    const badClose = await new Promise<number>((resolve, reject) => {
      badOrigin.once('close', (code) => resolve(code));
      badOrigin.once('error', reject);
      badOrigin.once('unexpected-response', (_request, response) => {
        let body = '';
        response.on('data', (chunk) => (body += String(chunk)));
        response.once('end', () =>
          reject(new Error(`WebSocket handshake ${response.statusCode}: ${body}`)),
        );
      });
    });
    assert.equal(badClose, 1008);

    const owner = new WebSocket(url, 'binary', {
      headers: {
        host: CONFIG.canonicalAuthority,
        origin: CONFIG.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'x-test-admin': ADMIN_ID,
      },
    });
    await new Promise<void>((resolve, reject) => {
      owner.once('open', resolve);
      owner.once('error', reject);
    });
    const reply = new Promise<Buffer>((resolve, reject) => {
      owner.once('message', (data, isBinary) => {
        if (!isBinary) reject(new Error('Expected binary RFB proxy frame.'));
        else resolve(Buffer.from(data as Buffer));
      });
      owner.once('error', reject);
    });
    owner.send(Buffer.from([1, 2, 3]), { binary: true });
    assert.deepEqual(await reply, Buffer.from([1, 2, 3]));
    owner.close();
    await new Promise((resolve) => owner.once('close', resolve));
  },
);

async function createConsoleServer(row: AccountOnboardingSession, endpointPort = 48_321) {
  const server = Fastify({ logger: false });
  server.register(fastifyCookie);
  server.register(fastifyWebsocket);
  server.addHook('onRequest', async (request) => {
    const adminId = request.headers['x-test-admin'];
    if (typeof adminId === 'string') {
      request.authContext = {
        adminUserId: adminId,
        username: 'test-admin',
        sessionId: '00000000-0000-4000-8000-000000000003',
        reauthenticatedAt: NOW,
        idleExpiresAt: new Date(NOW.getTime() + 60_000),
        absoluteExpiresAt: new Date(NOW.getTime() + 60_000),
        now: NOW,
      };
    }
  });
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ code: error.code });
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
  const source: ConsoleSessionSource = {
    findByIdForAdmin: (_sessionId, adminUserId) =>
      adminUserId === row.createdByAdminUserId ? row : undefined,
  };
  const consoleOptions = {
    config: CONFIG,
    sessions: {
      validateSession: () => ({ outcome: 'VALID', adminUser: { id: ADMIN_ID } }),
    } as never,
    loginSessions: source,
    supervisor: {
      owns: (sessionId) => sessionId === row.id,
      getConsoleEndpoint: (sessionId) =>
        sessionId === row.id ? { host: '127.0.0.1', port: endpointPort } : undefined,
    },
    leaseOwner: { ownsRuntimeLease: (sessionId) => sessionId === row.id },
    clock: () => NOW,
  };
  server.register(async (consoleServer) => {
    registerAuthenticatedConsoleRoutes(consoleServer, consoleOptions);
  });
  await server.ready();
  return server;
}

function session(status: AccountOnboardingSession['status']): AccountOnboardingSession {
  return {
    id: SESSION_ID,
    purpose: 'ADD_ACCOUNT',
    accountId: null,
    pendingAccountId: '00000000-0000-4000-8000-000000000004',
    createdByAdminUserId: ADMIN_ID,
    status,
    expiresAt: new Date(NOW.getTime() + 60_000),
    startedAt: NOW,
    readyDetectedAt: null,
    completedAt: null,
    cancelledAt: null,
    failureCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    idempotencyKeyDigest: null,
  };
}

function sameOriginHeaders(): Record<string, string> {
  return {
    host: CONFIG.canonicalAuthority,
    origin: CONFIG.canonicalOrigin,
    'sec-fetch-site': 'same-origin',
  };
}
