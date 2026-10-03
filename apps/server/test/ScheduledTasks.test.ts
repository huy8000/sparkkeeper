import assert from 'node:assert/strict';
import test, { before, after, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { DouyinDeliveryPage, DouyinTargetResolverPage } from '@sparkkeeper/automation';
import {
  AdminUserRepository,
  ContactRepository,
  TargetResolverSnapshotRepository,
  AccountRepository,
} from '@sparkkeeper/database';
import { scheduledFixture } from '../../../packages/database/test/scheduledFixture.js';
import { SendTaskScheduler } from '../src/scheduling/SendTaskScheduler.js';
import type { TestSendRuntimeFactory } from '../src/test-send/TestSendManager.js';
import {
  TargetResolutionService,
  bindExistingTargetResolverRuntime,
} from '../src/automation/TargetResolutionService.js';
import { BrowserOperationCoordinator } from '../src/onboarding/BrowserOperationCoordinator.js';
import { AccountProfileStore } from '../src/onboarding/AccountProfileStore.js';
import { createApiApplication } from '../src/http/ApiApplication.js';
import {
  createAuthenticatedTestSession,
  injectAuthenticated,
  DEFAULT_TEST_PASSWORD,
} from './authFixture.js';
import { PasswordHasher } from '../src/security/PasswordHasher.js';
let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
});
const html = (
  success: boolean,
) => `<!doctype html><html><body><div data-sk-resolver-auth="READY"></div><div data-sk-resolver-self data-sec-uid="synthetic-self">Self</div>
<div data-sk-resolver-directory="static-v1" data-sk-resolver-complete="true">${['Fixture-001', 'fixture-second'].map((id, index) => `<button type="button" data-sk-resolver-conversation data-contact-type="PERSON" data-conversation-id="chat-${index}" data-sec-uid="${id}" onclick="document.querySelector('header').setAttribute('data-sec-uid','${id}');for(const n of document.querySelectorAll('header,[data-sk-delivery-list],textarea,[data-sk-delivery-control]'))n.setAttribute('data-conversation-id','chat-${index}')">Same name</button>`).join('')}</div>
<header data-sk-resolver-current data-contact-type="PERSON" data-conversation-id="old" data-sec-uid="old">Current</header>
<div data-sk-delivery-list="static-v1" data-sk-delivery-at-tail="true" data-conversation-id="old"></div><textarea data-sk-delivery-composer data-conversation-id="old"></textarea><button type="button" data-sk-delivery-control data-conversation-id="old">Synthetic</button>
<script>window.actions=0;document.querySelector('[data-sk-delivery-control]').onclick=()=>{window.actions++;${success ? `const row=document.createElement('div');row.setAttribute('data-sk-delivery-bubble','');row.setAttribute('data-message-id','new');row.setAttribute('data-message-sequence','1');row.setAttribute('data-direction','OUTGOING');row.setAttribute('data-message-kind','TEXT');const span=document.createElement('span');span.setAttribute('data-sk-delivery-text','');span.textContent=document.querySelector('textarea').value;row.append(span);document.querySelector('[data-sk-delivery-list]').append(row);` : ''}document.querySelector('textarea').value='';};</script></body></html>`;
class FixtureRuntime implements TestSendRuntimeFactory {
  kind = 'CONTROLLED_LOCAL' as const;
  opens = 0;
  actions = 0;
  recoveries = 0;
  held = Promise.resolve();
  failClose = false;
  authUnknown = false;
  authExpired = false;
  beforeAction: (() => void) | undefined;
  afterOpen: (() => void) | undefined;
  private context: BrowserContext | undefined;
  private directory: DouyinTargetResolverPage | undefined;
  private runId: string | undefined;
  constructor(private readonly success = true) {}
  inventory() {
    return this.runId ? [this.runId] : [];
  }
  async open(o: Parameters<TestSendRuntimeFactory['open']>[0]) {
    this.opens++;
    this.runId = o.runId;
    this.context = await browser.newContext({ serviceWorkers: 'block' });
    await this.context.route('**/*', (r) =>
      r.fulfill({ body: html(this.success), contentType: 'text/html' }),
    );
    const page = await this.context.newPage();
    await page.goto('http://127.0.0.1/chat');
    this.afterOpen?.();
    if (this.authUnknown || this.authExpired)
      await page
        .locator('[data-sk-resolver-auth]')
        .evaluate(
          (node, state) => node.setAttribute('data-sk-resolver-auth', state),
          this.authExpired ? 'AUTH_EXPIRED' : 'UNKNOWN',
        );
    const directory = DouyinTargetResolverPage.forControlledLocalPage(page);
    this.directory = directory;
    const supervision = {
      accountId: o.accountId,
      operationId: o.lease.operationId,
      generation: {},
      assertRecoveredOwnership: async () => {
        if (this.runId !== o.runId || page.isClosed()) throw new Error('NOT_OWNED');
      },
    };
    const runtime = bindExistingTargetResolverRuntime({ ...o, directory, supervision });
    const observation = DouyinDeliveryPage.forControlledLocalTestSend(page),
      invoke = observation.invokeOnce.bind(observation);
    observation.invokeOnce = async (budget) => {
      this.beforeAction?.();
      await invoke(budget);
    };
    return { runtime, observation, assertOwned: supervision.assertRecoveredOwnership };
  }
  async close() {
    await this.held;
    if (this.failClose) throw new Error('UNPROVEN_CLEANUP');
    if (this.context) {
      const page = this.context.pages()[0];
      if (page && !page.isClosed())
        this.actions += await page.evaluate(
          () => (window as unknown as { actions: number }).actions,
        );
      await this.directory?.dispose();
      await this.context.close();
      this.context = undefined;
    }
    this.runId = undefined;
  }
  async recover() {
    this.recoveries++;
    await this.close();
  }
}
async function setup(t: TestContext, runtime = new FixtureRuntime(), recovered = true) {
  const f = scheduledFixture(t),
    coordinator = new BrowserOperationCoordinator(),
    profiles = new AccountProfileStore(f.directory),
    staging = randomUUID();
  profiles.prepareStaging(staging, f.account.id);
  profiles.finalizeStaging(staging, f.account.id);
  let master = true;
  const options = {
    coordinator,
    profiles,
    targets: new TargetResolutionService(new TargetResolverSnapshotRepository(f.client)),
    isolated: () => true,
    runtime,
    master: () => master,
    released: () => true,
    clock: f.clock,
    limits: { verificationTimeoutMs: 150, pollIntervalMs: 5 },
  };
  const scheduler = new SendTaskScheduler(f.repository, options);
  t.after(async () => {
    runtime.held = Promise.resolve();
    runtime.failClose = false;
    await scheduler.stop().catch(() => undefined);
    await runtime.close();
  });
  if (recovered) await scheduler.recover();
  return {
    ...f,
    coordinator,
    profiles,
    runtime,
    scheduler,
    options,
    setMaster: (value: boolean) => {
      master = value;
    },
  };
}
test('concurrent ticks join actual Resolver/Verifier/boundary, sequential tasks allow independent intent but never repeat day snapshots', async (t) => {
  const f = await setup(t);
  const second = new ContactRepository(f.client).createWithPreferredIdentity({
    accountId: f.account.id,
    type: 'PERSON',
    displayName: 'Same name',
    initialIdentity: { kind: 'SEC_UID', value: 'fixture-second', source: 'DOM' },
  });
  const cfg = { ...f.configuration, contactIds: [f.target.contact.id, second.contact.id] };
  f.repository.tasks.mutate(f.task.id, f.task.updatedAt, f.admin.id, 'patch', cfg);
  f.enable();
  let persisted = 0;
  f.runtime.beforeAction = () => {
    const run = f.repository.unfinished()[0]!;
    const row = f.repository.run(run.runId).records.find((r) => r.machineStatus === 'RUNNING')!;
    assert.ok(row.sendActionStartedAt);
    assert.equal(row.messageText, '  Synthetic message\nexact  ');
    persisted++;
  };
  await Promise.all([f.scheduler.tick(), f.scheduler.tick()]);
  assert.equal(f.runtime.actions, 2);
  assert.equal(persisted, 2);
  const first = f.repository.canonical(f.task.id, '2026-10-03')!;
  assert.equal(f.repository.detail(first.id).status, 'SUCCESS');
  const another = f.repository.tasks.create(cfg, f.admin.id, f.clock());
  f.repository.tasks.mutate(
    another.id,
    another.updatedAt,
    f.admin.id,
    'enable',
    undefined,
    true,
    f.clock(),
  );
  await f.scheduler.tick();
  assert.equal(f.runtime.actions, 4);
  await f.scheduler.tick();
  assert.equal(f.runtime.actions, 4);
  assert.equal(f.repository.run(first.id).records[0]!.attemptCount, 1);
});
test('completed first dispatch page cannot starve a later enabled Task', async (t) => {
  const f = await setup(t);
  f.enable();
  for (let i = 0; i < 100; i++) {
    const task = f.repository.tasks.create(
      { ...f.configuration, name: `Synthetic task ${i}` },
      f.admin.id,
      f.clock(),
    );
    f.repository.tasks.mutate(
      task.id,
      task.updatedAt,
      f.admin.id,
      'enable',
      undefined,
      true,
      f.clock(),
    );
  }
  const all = f.repository.tasks.list({ enabled: true, limit: 101 }, true);
  for (const task of all.slice(0, 100)) {
    const run = f.repository.publish(task.id, f.repository.prepare(task.id), [
      f.template.messages[0]!,
    ]);
    f.repository.abort(run.id);
    f.repository.recoveredRun(run.id); // No runtime was ever opened for these untouched records.
  }
  await f.scheduler.tick();
  assert.equal(f.runtime.actions, 1);
  assert.equal(
    f.repository.detail(f.repository.canonical(all[100]!.id, '2026-10-03')!.id).status,
    'SUCCESS',
  );
});
test('post-action timeout/auth drift is UNKNOWN, aborts remaining targets and cannot retry on subsequent ticks', async (t) => {
  for (const authDrift of [false, true]) {
    const f = await setup(t, new FixtureRuntime(authDrift));
    const second = new ContactRepository(f.client).createWithPreferredIdentity({
      accountId: f.account.id,
      type: 'PERSON',
      displayName: 'Same name',
      initialIdentity: { kind: 'SEC_UID', value: 'fixture-second', source: 'DOM' },
    });
    f.repository.tasks.mutate(f.task.id, f.task.updatedAt, f.admin.id, 'patch', {
      ...f.configuration,
      contactIds: [f.target.contact.id, second.contact.id],
    });
    f.enable();
    if (authDrift)
      f.runtime.beforeAction = () => {
        new AccountRepository(f.client).update(f.account.id, { loginStatus: 'AUTH_EXPIRED' });
      };
    await f.scheduler.tick();
    const run = f.repository.canonical(f.task.id, '2026-10-03')!;
    assert.equal(
      f.repository.detail(run.id).status,
      authDrift ? 'AUTH_EXPIRED' : 'DELIVERY_UNKNOWN',
    );
    assert.deepEqual(
      f.repository.detail(run.id).records.map((r) => r.machineStatus),
      ['DELIVERY_UNKNOWN', 'SKIPPED'],
    );
    await f.scheduler.tick();
    assert.equal(f.runtime.actions, 1);
    assert.equal(f.runtime.opens, 1);
  }
});
test('UNKNOWN/expired DOM auth and expired DB auth are global failures, never target-local failures or actions', async (t) => {
  for (const authSource of ['DOM_UNKNOWN', 'DOM_EXPIRED', 'DB_EXPIRED'] as const) {
    const authFailure = authSource === 'DOM_UNKNOWN' ? 'AUTH_UNKNOWN' : 'AUTH_EXPIRED';
    const runtime = new FixtureRuntime();
    runtime.authUnknown = authSource === 'DOM_UNKNOWN';
    runtime.authExpired = authSource === 'DOM_EXPIRED';
    const f = await setup(t, runtime);
    if (authSource === 'DB_EXPIRED')
      runtime.afterOpen = () => {
        new AccountRepository(f.client).update(f.account.id, { loginStatus: 'AUTH_EXPIRED' });
      };
    const second = new ContactRepository(f.client).createWithPreferredIdentity({
      accountId: f.account.id,
      type: 'PERSON',
      displayName: 'Same name',
      initialIdentity: { kind: 'SEC_UID', value: 'fixture-second', source: 'DOM' },
    });
    f.repository.tasks.mutate(f.task.id, f.task.updatedAt, f.admin.id, 'patch', {
      ...f.configuration,
      contactIds: [f.target.contact.id, second.contact.id],
    });
    f.enable();
    await f.scheduler.tick();
    const detail = f.repository.detail(f.repository.canonical(f.task.id, '2026-10-03')!.id);
    assert.equal(detail.records[0]!.failureCode, authFailure);
    if (authFailure === 'AUTH_EXPIRED') {
      assert.equal(
        new AccountRepository(f.client).findById(f.account.id)!.loginStatus,
        'AUTH_EXPIRED',
      );
      assert.equal(f.repository.tasks.detail(f.task.id, true).state, 'BLOCKED');
      assert.equal(f.repository.tasks.row(f.task.id).enabled, true);
    }
    assert.deepEqual(
      detail.records.map((r) => r.machineStatus),
      ['FAILED', 'SKIPPED'],
    );
    assert.equal(runtime.opens, 1);
    assert.equal(runtime.actions, 0);
    await f.scheduler.tick();
    assert.equal(runtime.opens, 1);
  }
});
test('master false causes zero materialization/claims/runtime opens; cleanup holds the global lease until proof', async (t) => {
  const f = await setup(t);
  f.enable();
  f.setMaster(false);
  await f.scheduler.tick();
  assert.equal(f.repository.unfinished().length, 0);
  assert.equal(f.runtime.opens, 0);
  f.setMaster(true);
  let release!: () => void;
  f.runtime.held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = f.scheduler.tick();
  for (let i = 0; i < 100 && !f.repository.canonical(f.task.id, '2026-10-03')?.finishedAt; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.coordinator.acquire('other', f.account.id), undefined);
  release();
  await pending;
  const lease = f.coordinator.acquire('other', f.account.id);
  assert.ok(lease);
  lease.release();
});
test('restart awaits real stale context cleanup before null-boundary retry; no uncertain send replay', async (t) => {
  for (const boundary of [false, true]) {
    const f = await setup(t, new FixtureRuntime(), false);
    f.enable();
    const run = f.publish();
    f.repository.acquireRun(run.id, 'crashed');
    const record = f.repository.run(run.id).records[0]!;
    f.repository.claim(record.id);
    if (boundary) f.repository.boundary(record.id);
    const lease = f.coordinator.acquire(run.id, f.account.id)!;
    await f.runtime.open({
      runId: run.id,
      accountId: f.account.id,
      lease,
      coordinator: f.coordinator,
      profiles: f.profiles,
    });
    lease.release();
    let release!: () => void;
    f.runtime.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recovery = f.scheduler.recover();
    await f.scheduler.tick();
    assert.equal(f.runtime.opens, 1);
    assert.equal(f.repository.execution(record.id).record.machineStatus, 'RUNNING');
    release();
    await recovery;
    assert.equal(f.runtime.recoveries, 1);
    if (boundary) {
      assert.equal(f.repository.detail(run.id).status, 'DELIVERY_UNKNOWN');
      await f.scheduler.tick();
      assert.equal(f.runtime.opens, 1);
    } else {
      assert.equal(f.repository.execution(record.id).record.machineStatus, 'RETRY_WAIT');
      f.setNow(new Date(f.clock().getTime() + 1000));
      await f.scheduler.tick();
      assert.equal(f.repository.detail(run.id).status, 'SUCCESS');
      assert.equal(f.runtime.actions, 1);
    }
  }
});
test('unproven cleanup and unavailable recovery fail closed, preserve ownership and do not open replacement', async (t) => {
  const f = await setup(t);
  f.enable();
  f.runtime.failClose = true;
  await assert.rejects(f.scheduler.tick(), /UNPROVEN_CLEANUP/u);
  assert.equal(f.coordinator.acquire('other', f.account.id), undefined);
  assert.equal(f.repository.unfinished().length, 1);
  await f.scheduler.tick();
  assert.equal(f.runtime.opens, 1);
  assert.equal(f.runtime.inventory().length, 1);
  const { runtime: _terminalRuntime, ...terminalOptions } = f.options;
  void _terminalRuntime;
  const restartCoordinator = new BrowserOperationCoordinator();
  const terminalRestart = new SendTaskScheduler(f.repository, {
    ...terminalOptions,
    coordinator: restartCoordinator,
  });
  await assert.rejects(terminalRestart.recover(), /RECOVERY_UNAVAILABLE/u);
  assert.equal(restartCoordinator.acquire('other', f.account.id), undefined);
  assert.equal(f.repository.unfinished().length, 1);
  f.runtime.failClose = false;
  const recoveredCoordinator = new BrowserOperationCoordinator();
  const recovered = new SendTaskScheduler(f.repository, {
    ...f.options,
    coordinator: recoveredCoordinator,
  });
  await recovered.recover();
  assert.equal(f.repository.unfinished().length, 0);
  assert.equal(f.runtime.inventory().length, 0);
  const released = recoveredCoordinator.acquire('other', f.account.id);
  assert.ok(released);
  released.release();
  await recovered.stop();
  const g = await setup(t, new FixtureRuntime(), false);
  g.enable();
  const run = g.publish();
  g.repository.acquireRun(run.id, 'crashed');
  const r = g.repository.run(run.id).records[0]!;
  g.repository.claim(r.id);
  const { runtime: _runtime, ...withoutRuntime } = g.options;
  void _runtime;
  const unavailable = new SendTaskScheduler(g.repository, withoutRuntime);
  await assert.rejects(unavailable.recover(), /RECOVERY_UNAVAILABLE/u);
  assert.equal(g.coordinator.acquire('other', g.account.id), undefined);
  await unavailable.tick();
  assert.equal(g.repository.execution(r.id).record.machineStatus, 'RUNNING');
  assert.equal(g.runtime.opens, 0);
});
test('Task API remains authenticated/CSRF/recent-auth guarded; production flags cannot enable/claim; caller paths/messages rejected', async (t) => {
  const f = scheduledFixture(t);
  let authNow = new Date();
  new AdminUserRepository(f.client).update(f.admin.id, {
    passwordHash: await new PasswordHasher().hash(DEFAULT_TEST_PASSWORD),
  });
  const app = createApiApplication({
    databasePath: f.databasePath,
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
      MANUAL_RUN_ENABLED: 'false',
    },
    logger: false,
    clock: () => authNow,
  });
  t.after(() => app.close());
  await app.recoverOnboarding();
  const auth = await createAuthenticatedTestSession(app, f.admin.username);
  assert.equal((await app.server.inject({ method: 'GET', url: '/api/tasks' })).statusCode, 401);
  assert.equal(
    (
      await injectAuthenticated(app, auth, {
        method: 'POST',
        url: '/api/tasks',
        payload: { ...f.configuration, messageText: 'caller' },
      })
    ).statusCode,
    400,
  );
  const created = await injectAuthenticated(app, auth, {
    method: 'POST',
    url: '/api/tasks',
    payload: f.configuration,
  });
  assert.equal(created.statusCode, 201);
  const task = created.json().data;
  assert.equal(task.enabled, false);
  const closed = await injectAuthenticated(app, auth, {
    method: 'POST',
    url: `/api/tasks/${task.id}/enable`,
    payload: { expectedUpdatedAt: task.updatedAt, acknowledgeOverlaps: true },
  });
  assert.equal(closed.statusCode, 503);
  assert.equal(closed.json().error.code, 'RELEASE_GATE_CLOSED');
  assert.equal(
    (
      await app.server.inject({
        method: 'POST',
        url: `/api/tasks/${task.id}/disable`,
        headers: { cookie: auth.cookieHeader },
        payload: { expectedUpdatedAt: task.updatedAt },
      })
    ).statusCode,
    403,
  );
  await app.scheduling.tick();
  assert.equal(app.scheduling.repository.unfinished().length, 0);
  assert.equal(app.scheduling.start(), 'DISABLED');
  const patched = await injectAuthenticated(app, auth, {
    method: 'PATCH',
    url: `/api/tasks/${task.id}`,
    payload: { ...f.configuration, name: 'Changed', expectedUpdatedAt: task.updatedAt },
  });
  assert.equal(patched.statusCode, 200);
  authNow = new Date(Date.now() + 6 * 60_000);
  for (const operation of ['enable', 'archive'] as const) {
    const stale = await injectAuthenticated(app, auth, {
      method: 'POST',
      url: `/api/tasks/${task.id}/${operation}`,
      payload: {
        expectedUpdatedAt: patched.json().data.updatedAt,
        ...(operation === 'enable'
          ? { acknowledgeOverlaps: true }
          : { confirmationText: 'ARCHIVE' }),
      },
    });
    assert.equal(stale.statusCode, 403);
    assert.equal(stale.json().error.code, 'REAUTH_REQUIRED');
  }
  // Re-login is the current V4-2 recent-auth surface; do not invent a /reauth route.
  const fresh = await createAuthenticatedTestSession(app, f.admin.username);
  const archived = await injectAuthenticated(app, fresh, {
    method: 'POST',
    url: `/api/tasks/${task.id}/archive`,
    payload: { expectedUpdatedAt: patched.json().data.updatedAt, confirmationText: 'ARCHIVE' },
  });
  assert.equal(archived.statusCode, 200);
  assert.equal(archived.json().data.state, 'ARCHIVED');
});
