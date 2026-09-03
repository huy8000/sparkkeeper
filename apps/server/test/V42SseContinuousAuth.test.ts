import assert from 'node:assert/strict';
import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createApiApplication,
  listenApiApplication,
  type ApiApplication,
} from '../src/http/ApiApplication.js';
import { resolveHttpConfig } from '../src/http/config/HttpConfig.js';
import { ApiError } from '../src/http/errors/ApiError.js';
import { failure } from '../src/http/serializers/envelope.js';
import { registerAdminAuthGuards } from '../src/http/plugins/AdminAuthGuards.js';
import { registerAuthRoutes } from '../src/http/routes/authRoutes.js';
import { registerRealtimeRoutesInternal } from '../src/http/routes/realtimeRoutes.js';
import { RuntimeEventHub } from '../src/realtime/RuntimeEventHub.js';
import { LoginRateLimiter } from '../src/security/LoginRateLimiter.js';
import { PasswordHasher } from '../src/security/PasswordHasher.js';
import { AdminAuthenticationService } from '../src/security/AdminAuthenticationService.js';
import { AdminSessionService } from '../src/security/AdminSessionService.js';
import { defaultRandomSource } from '../src/security/TokenUtils.js';
import { AdminAuthRepository, createDatabase } from '@sparkkeeper/database';
import { bootstrapTestAdmin, DEFAULT_TEST_PASSWORD } from './authFixture.js';

/**
 * RR-05: the deterministic revalidation timing seam lives ONLY inside this
 * test-owned composition (registerRealtimeRoutesInternal). Production
 * createServer/ApiApplication expose no revalidation trigger; the
 * production-composition scenarios below run against the real app with a
 * short revalidation interval instead of any seam.
 */
interface InternalComposition {
  readonly server: import('fastify').FastifyInstance;
  readonly seam: { triggerRevalidation: () => void; activeRevalidationLoops: () => number };
  readonly hub: RuntimeEventHub;
  readonly repo: AdminAuthRepository;
  readonly dbPath: string;
  readonly dir: string;
  readonly canonicalAuthority: string;
  readonly canonicalOrigin: string;
  readonly close: () => Promise<void>;
}

function createInternalComposition(): InternalComposition {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-sse-internal-'));
  const db = createDatabase({ databasePath: path.join(dir, 'test.db') });
  db.migrate();
  const repo = new AdminAuthRepository(db);
  const auth = new AdminAuthenticationService(
    repo,
    new PasswordHasher(),
    new LoginRateLimiter(),
    defaultRandomSource,
  );
  const sessions = new AdminSessionService(repo);
  const hub = new RuntimeEventHub();
  const config = resolveHttpConfig({
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
  });
  const server = Fastify({ logger: false });
  server.register(fastifyCookie);
  registerAdminAuthGuards(server, { config, sessionService: sessions });
  server.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(failure(error.code, error.message));
    }
    return reply
      .code(500)
      .send(failure('INTERNAL_ERROR', 'An unexpected internal error occurred.'));
  });
  registerAuthRoutes(server, { auth, sessions } as never, config);
  const { seam } = registerRealtimeRoutesInternal(server, {
    events: hub,
    sessionService: sessions,
    config,
  });
  return {
    server,
    seam,
    hub,
    repo,
    dbPath: path.join(dir, 'test.db'),
    dir,
    canonicalAuthority: config.canonicalAuthority,
    canonicalOrigin: config.canonicalOrigin,
    close: async () => {
      await server.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function loginInject(composition: InternalComposition, payload: unknown) {
  return composition.server.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: {
      host: composition.canonicalAuthority,
      origin: composition.canonicalOrigin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    payload: payload as Record<string, unknown>,
  });
}

/** Waits for a condition using microtask/macrotask turns (no fixed sleeps). */
async function waitFor(condition: () => boolean, maxTurns = 5000): Promise<void> {
  for (let i = 0; i < maxTurns; i++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('waitFor condition not met');
}

async function openStream(composition: InternalComposition, cookie: string): Promise<void> {
  // Stream open through the real guard + route; hijacked responses are
  // intentionally never awaited (they end when the guard/loop closes them).
  void composition.server.inject({
    method: 'GET',
    url: '/api/events/stream',
    headers: { cookie },
  });
  await waitFor(() => composition.hub.subscriberCount === 1);
}

test('V42-FR-04 A: valid session opens stream; revocation after open closes it deterministically (client-visible EOF)', async () => {
  const c = createInternalComposition();
  try {
    const hasher = new PasswordHasher();
    c.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_SseA',
      passwordHash: await hasher.hash(DEFAULT_TEST_PASSWORD),
    });

    const login = await loginInject(c, { username: 'Admin_SseA', password: DEFAULT_TEST_PASSWORD });
    assert.equal(login.statusCode, 200);
    const body = JSON.parse(login.body) as { data: { csrfToken: string } };
    const cookie = (login.headers['set-cookie'] as unknown as string).split(';', 1)[0]!;

    // Open the stream RETAINING a real client reader: payloadAsStream hands the
    // hijacked response body to the test as a Readable the client consumes.
    const streamPromise = c.server.inject({
      method: 'GET',
      url: '/api/events/stream',
      headers: { cookie },
      payloadAsStream: true,
    });
    await waitFor(() => c.hub.subscriberCount === 1);
    assert.equal(c.seam.activeRevalidationLoops(), 1);

    const streamResponse = await streamPromise;
    const clientStream = streamResponse.stream();
    const clientChunks: string[] = [];
    clientStream.on('data', (chunk: Buffer) => clientChunks.push(chunk.toString()));
    const clientEof = new Promise<string>((resolve) =>
      clientStream.on('end', () => resolve('EOF')),
    );
    // The client actually received the ready event bytes.
    await waitFor(() => clientChunks.join('').includes('event: ready'));

    // Revoke via the real logout path.
    const logout = await c.server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie,
        host: c.canonicalAuthority,
        origin: c.canonicalOrigin,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'x-sparkkeeper-csrf': body.data.csrfToken,
      },
      payload: {},
    });
    assert.equal(logout.statusCode, 204);

    // Deterministic revalidation pass (WHEN seam only; real service decides).
    c.seam.triggerRevalidation();
    await waitFor(() => c.hub.subscriberCount === 0);
    assert.equal(c.seam.activeRevalidationLoops(), 0, 'revalidation loop cleaned up');

    // The CLIENT observes the close as a real end-of-stream on its reader.
    assert.equal(await clientEof, 'EOF', 'client-visible EOF on invalidation');

    // A post-close published event is NOT received: no new bytes after EOF.
    c.hub.publish({
      type: 'RUNTIME_EVENT',
      data: {
        eventType: 'RUN_FINISHED',
        level: 'info',
        message: 'post-close probe',
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(c.hub.subscriberCount, 0, 'no subscriber after close');
    assert.equal(
      clientChunks.join('').includes('post-close probe'),
      false,
      'post-close event never reached the client reader',
    );
  } finally {
    await c.close();
  }
});

test('V42-FR-04 B: idle expiry after stream open closes it deterministically (client-visible EOF)', async () => {
  const c = createInternalComposition();
  try {
    const hasher = new PasswordHasher();
    c.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_SseB',
      passwordHash: await hasher.hash(DEFAULT_TEST_PASSWORD),
    });
    const login = await loginInject(c, { username: 'Admin_SseB', password: DEFAULT_TEST_PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string).split(';', 1)[0]!;

    // Real client reader retained on the hijacked stream.
    const streamPromise = c.server.inject({
      method: 'GET',
      url: '/api/events/stream',
      headers: { cookie },
      payloadAsStream: true,
    });
    await waitFor(() => c.hub.subscriberCount === 1);
    const streamResponse = await streamPromise;
    const clientStream = streamResponse.stream();
    // Flowing mode is required for the reader to observe 'end' at all.
    clientStream.on('data', () => undefined);
    const clientEof = new Promise<string>((resolve) =>
      clientStream.on('end', () => resolve('EOF')),
    );

    // Real fact: rewrite the stored idle deadline into the past (numeric
    // epoch-ms columns), then run the deterministic pass.
    const dbFile = createDatabase({ databasePath: c.dbPath });
    dbFile.sqlite
      .prepare('UPDATE admin_sessions SET last_seen_at = created_at, idle_expires_at = ?')
      .run(Date.now());
    dbFile.close();

    c.seam.triggerRevalidation();
    await waitFor(() => c.hub.subscriberCount === 0);
    assert.equal(c.seam.activeRevalidationLoops(), 0);
    assert.equal(await clientEof, 'EOF', 'client-visible EOF on expiry');
  } finally {
    await c.close();
  }
});

test('V42-FR-04 C: Admin DISABLED while streaming closes the stream', async () => {
  const c = createInternalComposition();
  try {
    const hasher = new PasswordHasher();
    c.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_SseC',
      passwordHash: await hasher.hash(DEFAULT_TEST_PASSWORD),
    });
    const login = await loginInject(c, { username: 'Admin_SseC', password: DEFAULT_TEST_PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string).split(';', 1)[0]!;
    await openStream(c, cookie);

    const dbFile = createDatabase({ databasePath: c.dbPath });
    dbFile.sqlite.prepare("UPDATE admin_users SET status = 'DISABLED'").run();
    dbFile.close();

    c.seam.triggerRevalidation();
    await waitFor(() => c.hub.subscriberCount === 0);
    assert.equal(c.seam.activeRevalidationLoops(), 0);
  } finally {
    await c.close();
  }
});

test('V42-FR-04 D: sessionVersion mismatch while streaming closes the stream', async () => {
  const c = createInternalComposition();
  try {
    const hasher = new PasswordHasher();
    c.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_SseD',
      passwordHash: await hasher.hash(DEFAULT_TEST_PASSWORD),
    });
    const login = await loginInject(c, { username: 'Admin_SseD', password: DEFAULT_TEST_PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string).split(';', 1)[0]!;
    await openStream(c, cookie);

    const dbFile = createDatabase({ databasePath: c.dbPath });
    dbFile.sqlite.prepare('UPDATE admin_users SET session_version = session_version + 1').run();
    dbFile.close();

    c.seam.triggerRevalidation();
    await waitFor(() => c.hub.subscriberCount === 0);
    assert.equal(c.seam.activeRevalidationLoops(), 0);
  } finally {
    await c.close();
  }
});

test('V42-FR-04 E: validation infrastructure failure (closed DB) closes the stream fail-closed', async () => {
  const c = createInternalComposition();
  try {
    const hasher = new PasswordHasher();
    c.repo.bootstrapInitialAdminWithAudit({
      username: 'Admin_SseE',
      passwordHash: await hasher.hash(DEFAULT_TEST_PASSWORD),
    });
    const login = await loginInject(c, { username: 'Admin_SseE', password: DEFAULT_TEST_PASSWORD });
    const cookie = (login.headers['set-cookie'] as unknown as string).split(';', 1)[0]!;
    await openStream(c, cookie);

    // Real infrastructure failure: close the database connection the session
    // service uses, then run the deterministic pass.
    (c.repo as unknown as { client: { close: () => void } }).client.close();
    c.seam.triggerRevalidation();
    await waitFor(() => c.hub.subscriberCount === 0);
    assert.equal(c.seam.activeRevalidationLoops(), 0);
  } finally {
    await c.close();
  }
});

// ---------------------------------------------------------------------------
// Production-composition scenarios (real createApiApplication, real TCP).
// ---------------------------------------------------------------------------

interface ProdFixture {
  readonly app: ApiApplication;
  readonly dir: string;
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

async function createProdFixture(): Promise<ProdFixture> {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-sse-prod-'));
  const app = createApiApplication({
    databasePath: path.join(dir, 'test.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      DATA_DIR: dir,
    },
    logger: false,
    sseSessionRevalidateMs: 5,
  });
  const address = await listenApiApplication(app);
  const port = new URL(address).port;
  return {
    app,
    dir,
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function prodLogin(
  fixture: ProdFixture,
  username: string,
): Promise<{ cookie: string; csrfToken: string }> {
  const res = await fetch(`${fixture.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      host: fixture.app.config.canonicalAuthority,
      origin: fixture.app.config.canonicalOrigin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ username, password: DEFAULT_TEST_PASSWORD }),
  });
  assert.equal(res.status, 200);
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')!];
  const body = (await res.json()) as { data: { csrfToken: string } };
  return { cookie: setCookie[0]!.split(';', 1)[0]!, csrfToken: body.data.csrfToken };
}

test('V42-FR-04 F: client close cleans up subscription and revalidation resources (production)', async () => {
  const fixture = await createProdFixture();
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_SseF', DEFAULT_TEST_PASSWORD);
    const { cookie } = await prodLogin(fixture, 'Admin_SseF');

    const controller = new AbortController();
    const response = await fetch(`${fixture.baseUrl}/api/events/stream`, {
      headers: { cookie },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    await waitFor(() => fixture.app.realtime.subscriberCount === 1);

    controller.abort();
    await waitFor(() => fixture.app.realtime.subscriberCount === 0);
  } finally {
    await fixture.close();
  }
});

test('V42-FR-04 G: server close ends all streams and cleans every resource (production)', async () => {
  const fixture = await createProdFixture();
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_SseG', DEFAULT_TEST_PASSWORD);
    const { cookie } = await prodLogin(fixture, 'Admin_SseG');

    const controller = new AbortController();
    const response = await fetch(`${fixture.baseUrl}/api/events/stream`, {
      headers: { cookie },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    await waitFor(() => fixture.app.realtime.subscriberCount === 1);

    await fixture.app.close();
    assert.equal(fixture.app.realtime.subscriberCount, 0);
    controller.abort();
  } finally {
    await fixture.close();
  }
});

test('V42-FR-04: SSE registrar cannot construct an unauthenticated stream (production)', async () => {
  const fixture = await createProdFixture();
  try {
    await bootstrapTestAdmin(fixture.app, 'Admin_SseH', DEFAULT_TEST_PASSWORD);
    const response = await fetch(`${fixture.baseUrl}/api/events/stream`);
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'UNAUTHENTICATED');
    assert.equal(fixture.app.realtime.subscriberCount, 0);
  } finally {
    await fixture.close();
  }
});

test('V42-FR-04: production composition exposes no revalidation seam', async () => {
  const fixture = await createProdFixture();
  try {
    // The production surface must have no seam property whatsoever.
    assert.equal('sseSeam' in fixture.app, false);
    const { createServer } = await import('../src/http/createServer.js');
    void createServer;
    // The seam type is not exported and no property carrying a trigger exists.
    const appKeys = Object.keys(fixture.app);
    assert.equal(
      appKeys.some((key) => /seam|revalidat/iu.test(key)),
      false,
    );
  } finally {
    await fixture.close();
  }
});
