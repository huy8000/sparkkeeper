import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AccountOnboardingRepository, AccountRepository } from '@sparkkeeper/database';

import {
  AccountLoginWorkerSupervisor,
  type AccountLoginWorkerProcess,
} from '../src/onboarding/AccountLoginWorkerSupervisor.js';
import { createApiApplication } from '../src/http/ApiApplication.js';
import { createAuthenticatedTestSession, injectAuthenticated } from './authFixture.js';

class FixtureProcess extends EventEmitter implements AccountLoginWorkerProcess {
  private treeAlive = true;

  send(message: unknown): boolean {
    if ((message as { type?: string }).type === 'STOP') {
      queueMicrotask(() => {
        this.treeAlive = false;
        this.emit('exit', 0, null);
      });
    }
    return true;
  }
  terminateTree(signal: NodeJS.Signals): boolean {
    this.treeAlive = false;
    queueMicrotask(() => this.emit('exit', 0, signal));
    return true;
  }
  isTreeAlive(): boolean {
    return this.treeAlive;
  }
}

test('V4-3 API admits one owner flow, replays the key, redacts status and supports CAS cancel', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-onboarding-api-'));
  const supervisor = new AccountLoginWorkerSupervisor({
    factory: { spawn: () => new FixtureProcess() },
    stopGraceMs: 10,
  });
  const app = createApiApplication({
    databasePath: path.join(directory, 'sparkkeeper.db'),
    environment: {
      DATA_DIR: directory,
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
    },
    onboardingSupervisor: supervisor,
    logger: false,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const admin = await createAuthenticatedTestSession(app);
  const start = () =>
    injectAuthenticated(app, admin, {
      method: 'POST',
      url: '/api/account-login-sessions',
      headers: { 'idempotency-key': 'api-start-1' },
      payload: { purpose: 'ADD_ACCOUNT' },
    });

  const first = await start();
  assert.equal(first.statusCode, 202, first.body);
  const firstBody = JSON.parse(first.body) as {
    data: {
      session: { id: string; updatedAt: string; status: string; consoleAvailable: boolean };
      consolePath: string;
    };
  };
  assert.equal(firstBody.data.session.status, 'STARTING');
  assert.equal(firstBody.data.session.consoleAvailable, false);
  assert.equal(
    firstBody.data.consolePath,
    `/api/account-login-sessions/${firstBody.data.session.id}/console`,
  );
  assert.doesNotMatch(first.body, /profilePath|pendingAccountId|identity|48321|browser-profiles/u);

  const replay = await start();
  assert.equal(replay.statusCode, 202, replay.body);
  assert.equal(JSON.parse(replay.body).data.session.id, firstBody.data.session.id);

  const conflict = await injectAuthenticated(app, admin, {
    method: 'POST',
    url: '/api/account-login-sessions',
    headers: { 'idempotency-key': 'api-start-2' },
    payload: { purpose: 'ADD_ACCOUNT' },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(JSON.parse(conflict.body).error.code, 'LOGIN_SESSION_ACTIVE');

  const active = await injectAuthenticated(app, admin, {
    method: 'GET',
    url: '/api/account-login-sessions/active',
  });
  assert.equal(active.statusCode, 200);
  assert.equal(JSON.parse(active.body).data.session.id, firstBody.data.session.id);

  const cancelled = await injectAuthenticated(app, admin, {
    method: 'POST',
    url: `/api/account-login-sessions/${firstBody.data.session.id}/cancel`,
    payload: { expectedUpdatedAt: firstBody.data.session.updatedAt },
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(JSON.parse(cancelled.body).data.status, 'CANCELLED');
  assert.equal(supervisor.owns(firstBody.data.session.id), false);
});

test('V4-3 API rejects client paths and the legacy manual Account creation route', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-onboarding-api-boundary-'));
  const app = createApiApplication({
    databasePath: path.join(directory, 'sparkkeeper.db'),
    environment: {
      DATA_DIR: directory,
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
    },
    onboardingSupervisor: new AccountLoginWorkerSupervisor({
      factory: { spawn: () => new FixtureProcess() },
      stopGraceMs: 10,
    }),
    logger: false,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const admin = await createAuthenticatedTestSession(app);

  const pathAttempt = await injectAuthenticated(app, admin, {
    method: 'POST',
    url: '/api/account-login-sessions',
    headers: { 'idempotency-key': 'no-path' },
    payload: { purpose: 'ADD_ACCOUNT', profilePath: '/tmp/owned-by-client' },
  });
  assert.equal(pathAttempt.statusCode, 400);

  const legacy = await injectAuthenticated(app, admin, {
    method: 'POST',
    url: '/api/accounts',
    payload: { name: 'Legacy bypass' },
  });
  assert.equal(legacy.statusCode, 404);
});

test('V4-3 API fails closed while another browser-operation release gate is enabled', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-onboarding-api-gate-'));
  const supervisor = new AccountLoginWorkerSupervisor({
    factory: { spawn: () => new FixtureProcess() },
    stopGraceMs: 10,
  });
  const app = createApiApplication({
    databasePath: path.join(directory, 'sparkkeeper.db'),
    environment: {
      DATA_DIR: directory,
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
      MANUAL_RUN_ENABLED: 'true',
    },
    onboardingSupervisor: supervisor,
    logger: false,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const admin = await createAuthenticatedTestSession(app);

  const response = await injectAuthenticated(app, admin, {
    method: 'POST',
    url: '/api/account-login-sessions',
    headers: { 'idempotency-key': 'release-gate-closed' },
    payload: { purpose: 'ADD_ACCOUNT' },
  });

  assert.equal(response.statusCode, 503, response.body);
  assert.equal(JSON.parse(response.body).error.code, 'RELEASE_GATE_CLOSED');
  assert.equal(supervisor.owns('any-session'), false);
});

test('transaction-A PROVISIONING Account remains invisible and non-operable through ordinary APIs', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-onboarding-api-provisioning-'));
  const app = createApiApplication({
    databasePath: path.join(directory, 'sparkkeeper.db'),
    environment: {
      DATA_DIR: directory,
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
    },
    onboardingSupervisor: new AccountLoginWorkerSupervisor({
      factory: { spawn: () => new FixtureProcess() },
      stopGraceMs: 10,
    }),
    logger: false,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const admin = await createAuthenticatedTestSession(app);
  const repository = new AccountOnboardingRepository(app.database);
  const now = new Date('2030-01-01T00:00:00.000Z');
  const started = repository.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: admin.adminId,
    idempotencyKey: 'transaction-a-api-invisibility',
    now,
  });
  assert.equal(started.outcome, 'CREATED');
  if (started.outcome !== 'CREATED') return;
  repository.markStarting(started.session.id, new Date(now.getTime() + 1_000));
  repository.markAwaitingUser(started.session.id, new Date(now.getTime() + 2_000));
  repository.markReadyDetected(started.session.id, new Date(now.getTime() + 3_000));
  const begun = repository.beginAddCompletion(
    started.session.id,
    { displayName: 'Provisioning Fixture', douyinSecUid: 'provisioning-sec-uid' },
    new Date(now.getTime() + 4_000),
  );
  assert.equal(begun.outcome, 'COMPLETING');
  if (begun.outcome !== 'COMPLETING') return;
  assert.equal(
    new AccountRepository(app.database).findById(begun.account.id, {
      includeProvisioning: true,
    })?.profileState,
    'PROVISIONING',
  );

  const list = await injectAuthenticated(app, admin, { method: 'GET', url: '/api/accounts' });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(
    list.json().data.some((account: { readonly id: string }) => account.id === begun.account.id),
    false,
  );
  const detail = await injectAuthenticated(app, admin, {
    method: 'GET',
    url: `/api/accounts/${begun.account.id}`,
  });
  assert.equal(detail.statusCode, 404, detail.body);
  const update = await injectAuthenticated(app, admin, {
    method: 'PATCH',
    url: `/api/accounts/${begun.account.id}`,
    payload: { enabled: false },
  });
  assert.equal(update.statusCode, 404, update.body);
});
