import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AccountRepository,
  ContactDiscoveryRepository,
  ContactRepository,
  type DiscoveryPublication,
} from '@sparkkeeper/database';
import { createApiApplication } from '../src/http/ApiApplication.js';
import { AccountProfileStore } from '../src/onboarding/AccountProfileStore.js';
import { ContactFiles } from '../src/contacts/ContactFiles.js';
import {
  ContactDiscoveryWorkerSupervisor,
  type DiscoverySupervisor,
} from '../src/contacts/ContactDiscoveryWorkerSupervisor.js';
import {
  validateDiscoveryEvent,
  type DiscoveryWorkerStart,
} from '../src/contacts/ContactDiscoveryWorkerProtocol.js';
import { createAuthenticatedTestSession, injectAuthenticated } from './authFixture.js';

class FixtureSupervisor implements DiscoverySupervisor {
  runtimeAvailable = true;
  started: DiscoveryWorkerStart | undefined;
  stopped = false;
  pending: ((p: DiscoveryPublication) => void) | undefined;
  holdStop: Promise<void> = Promise.resolve();
  inventory() {
    return [];
  }
  async recover() {}
  async start(input: DiscoveryWorkerStart) {
    this.started = input;
    return new Promise<DiscoveryPublication>((r) => {
      this.pending = r;
    });
  }
  finish(p: DiscoveryPublication) {
    this.pending?.(p);
  }
  async stop() {
    await this.holdStop;
    this.stopped = true;
  }
  async stopAll() {
    this.pending?.({
      status: 'FAILED',
      failureCode: 'PROCESS_INTERRUPTED',
      observations: [],
      issueCount: 0,
      authChecked: false,
    });
  }
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise<void>((r) => setImmediate(r));
  }
  assert.fail('Fixture did not settle');
}
test('Contact API S/M guards, cleanup-before-publication, stable DTOs, cursor and legacy POST404', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-contact-api-')));
  const supervisor = new FixtureSupervisor();
  const app = createApiApplication({
    databasePath: path.join(root, 'fixture.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
      MANUAL_RUN_ENABLED: 'false',
    },
    discoverySupervisor: supervisor,
    logger: false,
  });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  await app.recoverOnboarding();
  const admin = await createAuthenticatedTestSession(app);
  const account = new AccountRepository(app.database).create({
    name: 'fixture',
    profileState: 'READY',
    loginStatus: 'READY',
    douyinSecUid: 'synthetic-self',
  });
  const profiles = new AccountProfileStore(root);
  const staging = randomUUID();
  profiles.prepareStaging(staging, account.id);
  profiles.finalizeStaging(staging, account.id);
  for (const url of [
    `/api/accounts/${account.id}/contacts`,
    `/api/contact-syncs/${randomUUID()}`,
    `/api/contacts/${randomUUID()}`,
    `/api/avatar-assets/${randomUUID()}`,
  ])
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
  const url = `/api/accounts/${account.id}/contact-syncs`;
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url,
        payload: {},
        headers: { 'x-sparkkeeper-csrf': '' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url,
        payload: {},
        headers: { origin: 'http://attacker.invalid' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url,
        payload: { profilePath: '/unsafe' },
        headers: { 'idempotency-key': 'fixture' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await injectAuthenticated(app, admin, { method: 'POST', url, payload: {} })).statusCode,
    400,
  );
  let release!: () => void;
  supervisor.holdStop = new Promise<void>((r) => {
    release = r;
  });
  const start = await injectAuthenticated(app, admin, {
    method: 'POST',
    url,
    payload: {},
    headers: { 'idempotency-key': 'fixture' },
  });
  assert.equal(start.statusCode, 202, start.body);
  const id = JSON.parse(start.body).data.syncRunId;
  await until(() => supervisor.started !== undefined);
  const repo = new ContactDiscoveryRepository(app.database);
  supervisor.finish({
    status: 'PARTIAL',
    failureCode: 'DISCOVERY_STALLED',
    issueCount: 0,
    authChecked: true,
    observations: ['synthetic-a', 'synthetic-b'].map((SEC_UID) => ({
      type: 'PERSON',
      displayName: 'Same name',
      remarkName: null,
      identities: { SEC_UID },
      avatarRemoteUrl: null,
      streakDays: null,
      observedAt: Date.now(),
      adapterVersion: 'offline-v1',
    })),
  });
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(repo.find(id)?.status, 'RUNNING');
  assert.equal(repo.list(account.id, { limit: 50 }).length, 0);
  assert.equal(app.discovery.owns(id), true);
  release();
  await until(() => repo.find(id)?.status === 'PARTIAL');
  assert.equal(supervisor.stopped, true);
  assert.equal(app.discovery.owns(id), false);
  const replay = await injectAuthenticated(app, admin, {
    method: 'POST',
    url,
    payload: {},
    headers: { 'idempotency-key': 'fixture' },
  });
  assert.equal(JSON.parse(replay.body).data.syncRunId, id);
  const page = await injectAuthenticated(app, admin, {
    method: 'GET',
    url: `/api/accounts/${account.id}/contacts?limit=1`,
  });
  assert.equal(page.statusCode, 200);
  assert.doesNotMatch(
    page.body,
    /synthetic-a|synthetic-b|browser-profiles|avatarRemoteUrl|normalizedValue|idempotencyKeyDigest/,
  );
  const data = JSON.parse(page.body).data;
  assert.ok(data.nextCursor);
  const second = JSON.parse(
    (
      await injectAuthenticated(app, admin, {
        method: 'GET',
        url: `/api/accounts/${account.id}/contacts?limit=1&cursor=${data.nextCursor}`,
      })
    ).body,
  ).data;
  assert.notEqual(data.items[0].id, second.items[0].id);
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'GET',
        url: `/api/accounts/${account.id}/contacts?type=GROUP&cursor=${data.nextCursor}`,
      })
    ).statusCode,
    400,
  );
  const detail = await injectAuthenticated(app, admin, {
    method: 'GET',
    url: `/api/contacts/${data.items[0].id}`,
  });
  assert.doesNotMatch(detail.body, /synthetic-a|synthetic-b|normalizedValue|avatarRemoteUrl/);
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url: '/api/accounts',
        payload: { name: 'old' },
      })
    ).statusCode,
    404,
  );
  const hidden = new AccountRepository(app.database).create({
    name: 'hidden',
    profileState: 'PROVISIONING',
  });
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'GET',
        url: `/api/accounts/${hidden.id}/contacts`,
      })
    ).statusCode,
    404,
  );
  const unsafe = new AccountRepository(app.database).create({ name: 'not-ready' });
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'POST',
        url: `/api/accounts/${unsafe.id}/contact-syncs`,
        payload: {},
        headers: { 'idempotency-key': 'other' },
      })
    ).statusCode,
    422,
  );
});
test('Avatar authenticated immutable cache, failure degradation and anchored symlink/no-replace', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-contact-avatar-')));
  const app = createApiApplication({
    databasePath: path.join(root, 'fixture.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    },
    discoverySupervisor: new FixtureSupervisor(),
    logger: false,
  });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const admin = await createAuthenticatedTestSession(app);
  const a = new AccountRepository(app.database).create({ name: 'fixture' });
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const asset = app.avatars.store(a.id, bytes, 'image/png')!;
  assert.ok(asset);
  assert.equal(app.avatars.store(a.id, bytes, 'image/png')?.id, asset.id);
  assert.equal(app.avatars.store(a.id, Buffer.from('not-image'), 'image/png'), undefined);
  const contact = new ContactRepository(app.database).create({
    accountId: a.id,
    type: 'UNKNOWN',
    displayName: 'fixture',
  });
  new ContactRepository(app.database).update(contact.id, { avatarAssetId: asset.id });
  const read = await injectAuthenticated(app, admin, {
    method: 'GET',
    url: `/api/avatar-assets/${asset.id}`,
  });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.rawPayload, bytes);
  assert.equal(read.headers['cache-control'], 'private, no-store');
  assert.equal(
    (
      await app.server.inject({
        url: `/api/avatar-assets/${asset.id}`,
        headers: { host: app.config.canonicalAuthority },
      })
    ).statusCode,
    401,
  );
  const managed = new ContactFiles(path.join(root, 'managed'));
  assert.equal(managed.put('fixture', Buffer.from('one')), true);
  assert.equal(managed.put('fixture', Buffer.from('two')), false);
  assert.equal(managed.get('fixture')?.toString(), 'one');
  const outside = path.join(root, 'outside');
  mkdirSync(outside);
  const link = path.join(root, 'link');
  symlinkSync(outside, link, 'dir');
  assert.throws(() => new ContactFiles(path.join(link, 'escaped')));
});
test('disabled avatar initialization does not block API startup, recovery or Contact discovery', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-disabled-avatar-')));
  const avatarRoot = path.join(root, 'avatars');
  writeFileSync(avatarRoot, 'synthetic unavailable cache');
  const supervisor = new FixtureSupervisor();
  const app = createApiApplication({
    databasePath: path.join(root, 'fixture.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
      SCHEDULER_ENABLED: 'false',
      MANUAL_RUN_ENABLED: 'false',
    },
    discoverySupervisor: supervisor,
    logger: false,
  });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  assert.equal(app.avatars.disabled, true);
  await app.recoverOnboarding();
  const admin = await createAuthenticatedTestSession(app);
  const account = new AccountRepository(app.database).create({
    name: 'fixture',
    profileState: 'READY',
    loginStatus: 'READY',
    douyinSecUid: 'synthetic-self',
  });
  const profiles = new AccountProfileStore(root);
  const staging = randomUUID();
  profiles.prepareStaging(staging, account.id);
  profiles.finalizeStaging(staging, account.id);
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.equal(app.avatars.store(account.id, bytes, 'image/png'), undefined);
  assert.equal(app.avatars.read(randomUUID()), undefined);
  app.avatars.cleanup();
  assert.equal(readFileSync(avatarRoot, 'utf8'), 'synthetic unavailable cache');
  const response = await injectAuthenticated(app, admin, {
    method: 'POST',
    url: `/api/accounts/${account.id}/contact-syncs`,
    payload: {},
    headers: { 'idempotency-key': 'disabled-cache' },
  });
  assert.equal(response.statusCode, 202);
  const id = JSON.parse(response.body).data.syncRunId;
  await until(() => supervisor.started !== undefined);
  supervisor.finish({
    status: 'PARTIAL',
    failureCode: 'DISCOVERY_STALLED',
    issueCount: 0,
    authChecked: true,
    observations: [
      {
        type: 'PERSON',
        displayName: 'fixture',
        remarkName: null,
        identities: { SEC_UID: 'synthetic-contact' },
        avatarRemoteUrl: null,
        streakDays: null,
        observedAt: Date.now(),
        adapterVersion: 'offline-v1',
      },
    ],
  });
  await until(() => app.discovery.repository.find(id)?.status === 'PARTIAL');
  const list = await injectAuthenticated(app, admin, {
    method: 'GET',
    url: `/api/accounts/${account.id}/contacts`,
  });
  assert.equal(list.statusCode, 200);
  assert.equal(JSON.parse(list.body).data.items.length, 1);
  assert.equal(JSON.parse(list.body).data.items[0].avatarAssetId, null);
  assert.equal(
    (
      await injectAuthenticated(app, admin, {
        method: 'GET',
        url: `/api/avatar-assets/${randomUUID()}`,
      })
    ).statusCode,
    404,
  );
});
test('Recovery awaits cleanup and retains admission/identity on invalid persisted ownership; malformed IPC fails closed', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-contact-recovery-')));
  const supervisor = new FixtureSupervisor();
  const app = createApiApplication({
    databasePath: path.join(root, 'fixture.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    },
    discoverySupervisor: supervisor,
    logger: false,
  });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const admin = await createAuthenticatedTestSession(app);
  const a = new AccountRepository(app.database).create({
    name: 'fixture',
    profileState: 'READY',
    loginStatus: 'READY',
  });
  const repo = new ContactDiscoveryRepository(app.database);
  const run = repo.start(a.id, admin.adminId, 'interrupted').run;
  let resolve!: () => void;
  const wait = new Promise<void>((r) => {
    resolve = r;
  });
  supervisor.recover = async () => wait;
  const recovery = app.recoverOnboarding();
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(repo.find(run.id)?.status, 'PENDING');
  assert.equal(app.discovery.owns(run.id), true);
  resolve();
  await recovery;
  assert.equal(repo.find(run.id)?.failureCode, 'PROCESS_INTERRUPTED');
  assert.equal(app.discovery.owns(run.id), false);
  const bad = new ContactDiscoveryWorkerSupervisor(path.join(root, 'bad'));
  assert.equal(
    validateDiscoveryEvent({ type: 'BROWSER_LAUNCH_ABORTED', runId: run.id }, run.id).type,
    'BROWSER_LAUNCH_ABORTED',
  );
  bad.ownership.files.put(`${run.id}.browser`, Buffer.from('invalid'));
  await assert.rejects(bad.recover(run.id));
  assert.equal(bad.ownership.files.get(`${run.id}.browser`)?.toString(), 'invalid');
  assert.throws(() =>
    validateDiscoveryEvent(
      {
        type: 'RESULT',
        runId: run.id,
        status: 'COMPLETE',
        failureCode: 'AUTH_EXPIRED',
        issueCount: 0,
        authChecked: true,
      },
      run.id,
    ),
  );
});
test('invalid recovery preserves the global lease and prevents replacement admission', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-contact-blocked-')));
  const supervisor = new FixtureSupervisor();
  const app = createApiApplication({
    databasePath: path.join(root, 'fixture.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    },
    discoverySupervisor: supervisor,
    logger: false,
  });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const admin = await createAuthenticatedTestSession(app);
  const account = new AccountRepository(app.database).create({
    name: 'fixture',
    loginStatus: 'READY',
    profileState: 'READY',
  });
  const repo = new ContactDiscoveryRepository(app.database);
  const run = repo.start(account.id, admin.adminId, 'restart').run;
  supervisor.recover = async () => {
    throw new Error('Invalid ownership');
  };
  await assert.rejects(app.recoverOnboarding());
  assert.equal(app.discovery.owns(run.id), true);
  assert.equal(repo.find(run.id)?.status, 'PENDING');
  const response = await injectAuthenticated(app, admin, {
    method: 'POST',
    url: `/api/accounts/${account.id}/contact-syncs`,
    payload: {},
    headers: { 'idempotency-key': 'replacement' },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(supervisor.started, undefined);
  assert.equal(repo.findActive().length, 1);
});
