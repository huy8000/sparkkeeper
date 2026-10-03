import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { before, after, type TestContext } from 'node:test';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import {
  DouyinDeliveryPage,
  DouyinTargetResolverPage,
  type DeliveryObservationPort,
} from '@sparkkeeper/automation';
import {
  TestSendRepository,
  TargetResolverSnapshotRepository,
  AdminUserRepository,
  ContactRepository,
} from '@sparkkeeper/database';
import { testSendFixture } from '../../../packages/database/test/testSendFixture.js';
import { TestSendManager, type TestSendRuntimeFactory } from '../src/test-send/TestSendManager.js';
import {
  TargetResolutionService,
  bindExistingTargetResolverRuntime,
} from '../src/automation/TargetResolutionService.js';
import { AccountProfileStore } from '../src/onboarding/AccountProfileStore.js';
import { BrowserOperationCoordinator } from '../src/onboarding/BrowserOperationCoordinator.js';
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
function html(action: string, group = false) {
  return `<!doctype html><html><body>
    <div data-sk-resolver-auth="READY"></div><div data-sk-resolver-self data-sec-uid="synthetic-self">Self</div>
    <div data-sk-resolver-directory="static-v1" data-sk-resolver-complete="true"><button type="button" data-sk-resolver-conversation data-contact-type="${group ? 'GROUP' : 'PERSON'}" data-conversation-id="synthetic-chat-1" data-sec-uid="Fixture-001" onclick="document.querySelector('header').setAttribute('data-conversation-id','synthetic-chat-1')">Target</button></div>
    <header data-sk-resolver-current data-contact-type="${group ? 'GROUP' : 'PERSON'}" data-conversation-id="old" data-sec-uid="Fixture-001">Header</header>
    <div data-sk-delivery-list="static-v1" data-sk-delivery-at-tail="true" data-conversation-id="synthetic-chat-1"></div>
    <textarea data-sk-delivery-composer data-conversation-id="synthetic-chat-1"></textarea><button type="button" data-sk-delivery-control data-conversation-id="synthetic-chat-1">Synthetic action</button>
    <script>window.fixtureActions=0;window.fixtureInputs=0;window.fixtureDeliveryObservers=0;window.fixtureInputHadObserver=false;
    const NativeObserver=MutationObserver;window.MutationObserver=class extends NativeObserver { observe(target,options){if(target.hasAttribute?.('data-sk-delivery-list')){this.delivery=true;window.fixtureDeliveryObservers++;}return super.observe(target,options);}disconnect(){if(this.delivery){window.fixtureDeliveryObservers--;this.delivery=false;}return super.disconnect();}};
    document.querySelector('textarea').oninput=()=>{window.fixtureInputs++;window.fixtureInputHadObserver=window.fixtureDeliveryObservers===1;};
    document.querySelector('[data-sk-delivery-control]').onclick=()=>{window.fixtureActions++;${action};document.querySelector('textarea').value='';};</script></body></html>`;
}
const append = `const row=document.createElement('div');row.setAttribute('data-sk-delivery-bubble','');row.setAttribute('data-message-id','new');row.setAttribute('data-message-sequence','1');row.setAttribute('data-direction','OUTGOING');row.setAttribute('data-message-kind','TEXT');const span=document.createElement('span');span.setAttribute('data-sk-delivery-text','');span.textContent=document.querySelector('textarea').value;row.append(span);document.querySelector('[data-sk-delivery-list]').append(row);`;
class ControlledFactory implements TestSendRuntimeFactory {
  kind = 'CONTROLLED_LOCAL' as const;
  starts = 0;
  recoveries = 0;
  actions = 0;
  inputs = 0;
  observedBeforeInput = false;
  ambiguous = false;
  afterBoundary: (() => void) | undefined;
  held = Promise.resolve();
  closed = 0;
  private context: BrowserContext | undefined;
  private directory: DouyinTargetResolverPage | undefined;
  private ownedRunId: string | undefined;
  constructor(
    private readonly action = append,
    private readonly group = false,
  ) {}
  inventory() {
    return this.ownedRunId ? [this.ownedRunId] : [];
  }
  async open(o: Parameters<TestSendRuntimeFactory['open']>[0]) {
    this.starts++;
    this.ownedRunId = o.runId;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    this.context = context;
    await context.route('**/*', (r) =>
      r.fulfill({ body: html(this.action, this.group), contentType: 'text/html' }),
    );
    const page = await context.newPage();
    await page.goto('http://127.0.0.1/chat');
    if (this.ambiguous)
      await page.evaluate(() => {
        const button = document
          .querySelector('[data-sk-resolver-conversation]')!
          .cloneNode(true) as HTMLElement;
        button.setAttribute('data-conversation-id', 'synthetic-chat-2');
        document.querySelector('[data-sk-resolver-directory]')!.append(button);
      });
    const directory = DouyinTargetResolverPage.forControlledLocalPage(page);
    this.directory = directory;
    const supervision = {
      accountId: o.accountId,
      operationId: o.lease.operationId,
      generation: {},
      assertRecoveredOwnership: async () => {
        if (!page || page.isClosed()) throw new Error('CLOSED');
      },
    };
    const runtime = bindExistingTargetResolverRuntime({ ...o, directory, supervision });
    const observation: DeliveryObservationPort =
      DouyinDeliveryPage.forControlledLocalTestSend(page);
    if (this.afterBoundary) {
      const original = observation.invokeOnce.bind(observation);
      observation.invokeOnce = async (budget) => {
        this.afterBoundary!();
        await original(budget);
      };
    }
    return { runtime, observation, assertOwned: supervision.assertRecoveredOwnership };
  }
  async close() {
    await this.held;
    if (this.context) {
      const pages = this.context.pages();
      if (pages[0] && !pages[0].isClosed()) {
        const counters = await pages[0].evaluate(() => ({
          actions: (window as unknown as { fixtureActions: number }).fixtureActions,
          inputs: (window as unknown as { fixtureInputs: number }).fixtureInputs,
          observed: (window as unknown as { fixtureInputHadObserver: boolean })
            .fixtureInputHadObserver,
          remaining: (window as unknown as { fixtureDeliveryObservers: number })
            .fixtureDeliveryObservers,
        }));
        this.actions += counters.actions;
        this.inputs += counters.inputs;
        this.observedBeforeInput = counters.observed;
        assert.equal(counters.remaining, 0);
      }
      await this.directory?.dispose();
      await this.context.close();
      this.context = undefined;
    }
    this.closed++;
    this.ownedRunId = undefined;
  }
  async recover() {
    this.recoveries++;
    await this.held;
    await this.close();
  }
}
async function managerFixture(t: TestContext, factory = new ControlledFactory()) {
  const f = testSendFixture(t),
    coordinator = new BrowserOperationCoordinator(),
    profiles = new AccountProfileStore(f.directory),
    staging = randomUUID();
  profiles.prepareStaging(staging, f.account.id);
  profiles.finalizeStaging(staging, f.account.id);
  const manager = new TestSendManager(f.repository, {
    coordinator,
    profiles,
    targets: new TargetResolutionService(new TargetResolverSnapshotRepository(f.client)),
    isolated: () => true,
    runtime: factory,
    limits: { verificationTimeoutMs: 200, pollIntervalMs: 5 },
  });
  t.after(async () => {
    await manager.stop();
    await factory.close();
  });
  await manager.recover();
  return { ...f, manager, factory, coordinator, profiles };
}
test('real loopback Resolver -> observer -> persisted input/boundary -> one action -> new outgoing proof; canonical replay never sends again', async (t) => {
  const f = await managerFixture(t);
  let durableBeforeAction = 0;
  f.factory.afterBoundary = () => {
    const current = f.repository.unfinished();
    assert.equal(current.length, 1);
    const persisted = f.repository.execution(current[0]!.runId);
    assert.ok(persisted.record.sendActionStartedAt);
    assert.equal(persisted.record.messageText, '  Synthetic message\nexact  ');
    durableBeforeAction++;
  };
  const [accepted, concurrent] = await Promise.all([
    f.manager.confirm(
      f.account.id,
      f.admin.id,
      f.preview.intentId,
      f.preview.payloadDigest,
      'execute',
    ),
    f.manager.confirm(
      f.account.id,
      f.admin.id,
      f.preview.intentId,
      f.preview.payloadDigest,
      'execute',
    ),
  ]);
  assert.equal(accepted.runId, concurrent.runId);
  await f.manager.idle();
  const detail = f.repository.detail(accepted.runId)!;
  assert.equal(detail.status, 'SUCCESS');
  assert.equal(detail.record.attemptCount, 1);
  assert.ok(detail.record.sendActionStartedAt);
  assert.equal(f.factory.actions, 1);
  assert.equal(f.factory.inputs, 1);
  assert.equal(f.factory.starts, 1);
  assert.equal(durableBeforeAction, 1);
  assert.equal(f.factory.observedBeforeInput, true);
  assert.equal(f.coordinator.current(), undefined);
  assert.equal(
    (
      await f.manager.confirm(
        f.account.id,
        f.admin.id,
        f.preview.intentId,
        f.preview.payloadDigest,
        'execute',
      )
    ).status,
    'SUCCESS',
  );
  await f.manager.idle();
  assert.equal(f.factory.actions, 1);
});
test('timeout and post-boundary identity drift are terminal UNKNOWN; no retry/no false SUCCESS', async (t) => {
  for (const drift of [false, true]) {
    const factory = new ControlledFactory(
      drift
        ? append + `document.querySelector('header').setAttribute('data-sec-uid','changed');`
        : '',
    );
    const f = await managerFixture(t, factory);
    const r = await f.manager.confirm(
      f.account.id,
      f.admin.id,
      f.preview.intentId,
      f.preview.payloadDigest,
      'execute',
    );
    await f.manager.idle();
    assert.equal(f.repository.detail(r.runId)!.status, 'DELIVERY_UNKNOWN');
    assert.equal(factory.actions, 1);
    await f.manager.confirm(
      f.account.id,
      f.admin.id,
      f.preview.intentId,
      f.preview.payloadDigest,
      'execute',
    );
    assert.equal(factory.starts, 1);
  }
});
test('ambiguous stable identity is FAILED before preparation/boundary/action', async (t) => {
  const f = await managerFixture(t);
  f.factory.ambiguous = true;
  const r = await f.manager.confirm(
    f.account.id,
    f.admin.id,
    f.preview.intentId,
    f.preview.payloadDigest,
    'execute',
  );
  await f.manager.idle();
  assert.equal(f.repository.detail(r.runId)!.record.failureCode, 'TARGET_AMBIGUOUS');
  assert.equal(f.repository.detail(r.runId)!.record.sendActionStartedAt, null);
  assert.equal(f.factory.actions, 0);
  assert.equal(f.factory.inputs, 0);
});
test('GROUP single target uses stable conversation identity, never member/name evidence', async (t) => {
  const factory = new ControlledFactory(append, true),
    f = await managerFixture(t, factory);
  const group = new ContactRepository(f.client).createWithPreferredIdentity({
    accountId: f.account.id,
    type: 'GROUP',
    displayName: 'Synthetic group',
    initialIdentity: { kind: 'CONVERSATION_ID', value: 'synthetic-chat-1', source: 'DOM' },
  });
  const p = f.manager.preview(f.account.id, group.contact.id, f.template.id, f.admin.id, 'group');
  const r = await f.manager.confirm(f.account.id, f.admin.id, p.intentId, p.payloadDigest, 'group');
  await f.manager.idle();
  assert.equal(f.repository.detail(r.runId)!.status, 'SUCCESS');
  assert.equal(factory.actions, 1);
  assert.equal(
    f.repository.execution(r.runId).record.targetIdentityKindSnapshot,
    'CONVERSATION_ID',
  );
});
test('RANDOM snapshot is chosen once on confirmation and is preserved across canonical replay', async (t) => {
  const f = await managerFixture(t);
  f.templates.update(f.template.id, {
    providerType: 'RANDOM',
    messages: ['Synthetic option A', 'Synthetic option B'],
  });
  const p = f.manager.preview(
    f.account.id,
    f.target.contact.id,
    f.template.id,
    f.admin.id,
    'random',
  );
  const r = await f.manager.confirm(
    f.account.id,
    f.admin.id,
    p.intentId,
    p.payloadDigest,
    'random',
  );
  await f.manager.idle();
  const message = f.repository.execution(r.runId).record.messageText;
  assert.ok(['Synthetic option A', 'Synthetic option B'].includes(message));
  await f.manager.confirm(f.account.id, f.admin.id, p.intentId, p.payloadDigest, 'random');
  assert.equal(f.repository.execution(r.runId).record.messageText, message);
  assert.equal(f.factory.actions, 1);
});
test('metadata mutation immediately after boundary is UNKNOWN, even if exact outgoing bubble appears', async (t) => {
  const f = await managerFixture(t);
  f.factory.afterBoundary = () =>
    f.contacts.update(f.target.contact.id, { displayName: 'Changed' });
  const r = await f.manager.confirm(
    f.account.id,
    f.admin.id,
    f.preview.intentId,
    f.preview.payloadDigest,
    'execute',
  );
  await f.manager.idle();
  assert.equal(f.repository.detail(r.runId)!.status, 'DELIVERY_UNKNOWN');
  assert.equal(f.factory.actions, 1);
});
test('cleanup barrier retains global/profile ownership and blocks second admission', async (t) => {
  let release!: () => void;
  const f = await managerFixture(t);
  f.factory.held = new Promise<void>((r) => {
    release = r;
  });
  const r = await f.manager.confirm(
    f.account.id,
    f.admin.id,
    f.preview.intentId,
    f.preview.payloadDigest,
    'execute',
  );
  for (let i = 0; i < 100 && f.repository.detail(r.runId)!.status !== 'SUCCESS'; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(f.coordinator.current());
  const p = f.manager.preview(
    f.account.id,
    f.target.contact.id,
    f.template.id,
    f.admin.id,
    'second',
  );
  await assert.rejects(
    f.manager.confirm(f.account.id, f.admin.id, p.intentId, p.payloadDigest, 'second'),
    /PROFILE_BUSY/u,
  );
  release();
  await f.manager.idle();
  assert.equal(f.coordinator.current(), undefined);
});
test('recovery is awaited, holds lease until cleanup and never starts replacement or re-sends', async (t) => {
  for (const boundary of [false, true]) {
    const f = testSendFixture(t),
      r = f.consume();
    f.repository.claim(r.runId);
    if (boundary) f.repository.boundary(r.runId);
    const coordinator = new BrowserOperationCoordinator(),
      factory = new ControlledFactory();
    let release!: () => void;
    factory.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manager = new TestSendManager(f.repository, {
      coordinator,
      profiles: new AccountProfileStore(f.directory),
      targets: new TargetResolutionService(new TargetResolverSnapshotRepository(f.client)),
      isolated: () => true,
      runtime: factory,
    });
    const recovery = manager.recover();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(coordinator.current());
    assert.equal(f.repository.detail(r.runId)!.status, 'RUNNING');
    release();
    await recovery;
    assert.equal(f.repository.detail(r.runId)!.status, boundary ? 'DELIVERY_UNKNOWN' : 'FAILED');
    assert.equal(factory.starts, 0);
    assert.equal(coordinator.current(), undefined);
    await manager.recover();
    assert.equal(factory.recoveries, 1);
  }
});
test('unproven recovery preserves lease and blocks admission; production cannot consume/start a live intent', async (t) => {
  const f = testSendFixture(t),
    r = f.consume();
  f.repository.claim(r.runId);
  f.repository.boundary(r.runId);
  const coordinator = new BrowserOperationCoordinator();
  const manager = new TestSendManager(f.repository, {
    coordinator,
    profiles: new AccountProfileStore(f.directory),
    targets: new TargetResolutionService(new TargetResolverSnapshotRepository(f.client)),
    isolated: () => true,
  });
  await assert.rejects(manager.recover(), /RUNTIME_UNAVAILABLE/u);
  assert.ok(coordinator.current());
  assert.equal(f.repository.detail(r.runId)!.status, 'RUNNING');
});
test('terminal runtime inventory is recovered before admission; cleanup failure retains lease', async (t) => {
  const f = testSendFixture(t),
    r = f.consume();
  f.repository.claim(r.runId);
  f.repository.boundary(r.runId);
  f.repository.finish(r.runId, 'SUCCESS');
  const coordinator = new BrowserOperationCoordinator(),
    factory = new ControlledFactory();
  factory.inventory = () => [r.runId];
  const manager = new TestSendManager(f.repository, {
    coordinator,
    profiles: new AccountProfileStore(f.directory),
    targets: new TargetResolutionService(new TargetResolverSnapshotRepository(f.client)),
    isolated: () => true,
    runtime: factory,
  });
  await manager.recover();
  assert.equal(factory.recoveries, 1);
  assert.equal(coordinator.current(), undefined);
  assert.equal(f.repository.detail(r.runId)!.status, 'SUCCESS');
  const next = await managerFixture(t);
  const original = next.factory.close.bind(next.factory);
  next.factory.close = async () => {
    throw new Error('UNPROVEN_CLEANUP');
  };
  try {
    await next.manager.confirm(
      next.account.id,
      next.admin.id,
      next.preview.intentId,
      next.preview.payloadDigest,
      'execute',
    );
    await assert.rejects(next.manager.idle(), /UNPROVEN_CLEANUP/u);
    assert.ok(next.coordinator.current());
    const p = next.manager.preview(
      next.account.id,
      next.target.contact.id,
      next.template.id,
      next.admin.id,
      'next',
    );
    await assert.rejects(
      next.manager.confirm(next.account.id, next.admin.id, p.intentId, p.payloadDigest, 'next'),
      /RUNTIME_UNAVAILABLE/u,
    );
  } finally {
    next.factory.close = original;
    await original();
  }
});
test('authenticated API joins confirmation and canonical detail to the controlled real resolver/verifier chain', async (t) => {
  const f = testSendFixture(t),
    factory = new ControlledFactory();
  new AdminUserRepository(f.client).update(f.admin.id, {
    passwordHash: await new PasswordHasher().hash(DEFAULT_TEST_PASSWORD),
  });
  const profiles = new AccountProfileStore(f.directory),
    staging = randomUUID();
  profiles.prepareStaging(staging, f.account.id);
  profiles.finalizeStaging(staging, f.account.id);
  const app = createApiApplication({
    databasePath: f.databasePath,
    logger: false,
    testSendRuntime: factory,
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
      MANUAL_RUN_ENABLED: 'false',
    },
  });
  t.after(() => app.close());
  await app.recoverOnboarding();
  const admin = await createAuthenticatedTestSession(app, f.admin.username);
  const p = await injectAuthenticated(app, admin, {
    method: 'POST',
    url: `/api/accounts/${f.account.id}/test-send-intents`,
    headers: { 'idempotency-key': 'api-preview' },
    payload: { templateId: f.template.id, contactIds: [f.target.contact.id] },
  });
  assert.equal(p.statusCode, 201);
  const request = {
    method: 'POST' as const,
    url: `/api/accounts/${f.account.id}/test-sends`,
    headers: { 'idempotency-key': 'api-execute' },
    payload: {
      intentId: p.json().data.intentId,
      payloadDigest: p.json().data.payloadDigest,
      confirm: true,
    },
  };
  const [first, replay] = await Promise.all([
    injectAuthenticated(app, admin, request),
    injectAuthenticated(app, admin, request),
  ]);
  assert.equal(first.statusCode, 202);
  assert.equal(replay.statusCode, 202);
  assert.equal(first.json().data.runId, replay.json().data.runId);
  await app.testSend.idle();
  const url = `/api/test-sends/${first.json().data.runId}`;
  assert.equal(
    (
      await app.server.inject({
        method: 'GET',
        url,
        headers: { host: app.config.canonicalAuthority },
      })
    ).statusCode,
    401,
  );
  const detail = await injectAuthenticated(app, admin, { method: 'GET', url });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().data.status, 'SUCCESS');
  assert.equal(factory.actions, 1);
  assert.equal(factory.observedBeforeInput, true);
  assert.equal(detail.body.includes('Fixture-001'), false);
  assert.equal(detail.body.includes('Synthetic message'), false);
});
test('HTTP auth/CSRF/recent-auth/schema + closed production gate: preview only, zero consumption/browser', async (t) => {
  const f = testSendFixture(t);
  new AdminUserRepository(f.client).update(f.admin.id, {
    passwordHash: await new PasswordHasher().hash(DEFAULT_TEST_PASSWORD),
  });
  const app = createApiApplication({
    databasePath: f.databasePath,
    logger: false,
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
      MANUAL_RUN_ENABLED: 'false',
    },
  });
  t.after(() => app.close());
  await app.recoverOnboarding();
  const admin = await createAuthenticatedTestSession(app, f.admin.username);
  const url = `/api/accounts/${f.account.id}/test-send-intents`;
  assert.equal(
    (
      await app.server.inject({
        method: 'POST',
        url,
        payload: {},
        headers: { host: app.config.canonicalAuthority },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url,
        headers: { 'x-sparkkeeper-csrf': 'bad' },
        payload: { templateId: f.template.id, contactIds: [f.target.contact.id] },
      })
    ).statusCode,
    403,
  );
  const p = await injectAuthenticated(app, admin, {
    method: 'POST',
    url,
    headers: { 'idempotency-key': 'api-preview' },
    payload: { templateId: f.template.id, contactIds: [f.target.contact.id] },
  });
  assert.equal(p.statusCode, 201);
  assert.equal(p.body.includes('Fixture-001'), false);
  const execute = `/api/accounts/${f.account.id}/test-sends`,
    body = {
      intentId: p.json().data.intentId,
      payloadDigest: p.json().data.payloadDigest,
      confirm: true,
    };
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url: execute,
        headers: { 'idempotency-key': 'api-execute' },
        payload: body,
      })
    ).json().error.code,
    'RELEASE_GATE_CLOSED',
  );
  assert.equal(new TestSendRepository(app.database).unfinished().length, 0);
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url,
        headers: { 'idempotency-key': 'batch' },
        payload: {
          templateId: f.template.id,
          contactIds: [f.target.contact.id, f.target.contact.id],
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url: execute,
        headers: { 'idempotency-key': 'text' },
        payload: { ...body, message: 'caller text', profilePath: '/tmp/not-owned' },
      })
    ).statusCode,
    400,
  );
  app.database.orm
    .update((await import('@sparkkeeper/database')).adminSessions)
    .set({
      createdAt: new Date(Date.now() - 700_000),
      reauthenticatedAt: new Date(Date.now() - 600_000),
    })
    .run();
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url: execute,
        headers: { 'idempotency-key': 'stale' },
        payload: body,
      })
    ).json().error.code,
    'REAUTH_REQUIRED',
  );
});
