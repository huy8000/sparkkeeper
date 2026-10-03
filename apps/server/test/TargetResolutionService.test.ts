import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import test, { type TestContext } from 'node:test';
import {
  AccountRepository,
  ContactRepository,
  ContactIdentityRepository,
  TargetResolverSnapshotRepository,
} from '@sparkkeeper/database';
import { createTemporaryDatabase } from '../../../packages/database/test/testDatabase.js';
import { FixtureDirectory } from '../../../packages/automation/test/resolverFixture.js';
import {
  TargetResolutionService,
  bindExistingTargetResolverRuntime,
  type ExistingTargetResolverRuntime,
  type RecoveredResolverProcessOwner,
} from '../src/automation/TargetResolutionService.js';
import { AccountProfileStore } from '../src/onboarding/AccountProfileStore.js';
import { BrowserOperationCoordinator } from '../src/onboarding/BrowserOperationCoordinator.js';

function fixture(t: TestContext) {
  const temp = createTemporaryDatabase(t);
  const account = new AccountRepository(temp.client).create({
    name: 'Synthetic owner',
    loginStatus: 'READY',
    profileState: 'READY',
    douyinSecUid: 'synthetic-self',
  });
  const contacts = new ContactRepository(temp.client),
    identities = new ContactIdentityRepository(temp.client);
  const contact = contacts.createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Synthetic target',
    initialIdentity: { kind: 'SEC_UID', value: 'Fixture-001', source: 'DOM' },
    now: new Date(1000),
  });
  const profiles = new AccountProfileStore(temp.directory),
    session = randomUUID();
  profiles.prepareStaging(session, account.id);
  profiles.finalizeStaging(session, account.id);
  const coordinator = new BrowserOperationCoordinator(),
    lease = coordinator.acquire(randomUUID(), account.id)!;
  t.after(() => lease.release());
  const directory = new FixtureDirectory();
  let recoveryChecks = 0;
  const supervision: RecoveredResolverProcessOwner = {
    accountId: account.id,
    operationId: lease.operationId,
    generation: {},
    async assertRecoveredOwnership() {
      recoveryChecks++;
    },
  };
  const snapshots = new TargetResolverSnapshotRepository(temp.client),
    service = new TargetResolutionService(snapshots);
  const options = { accountId: account.id, coordinator, lease, profiles, supervision, directory };
  const runtime = bindExistingTargetResolverRuntime(options);
  const prepare = () => {
    const result = service.prepare(account.id, contact.contact.id);
    if (result.status !== 'PREPARED') throw new Error('synthetic fixture not ready');
    return result.request;
  };
  return {
    ...temp,
    account,
    contact,
    contacts,
    identities,
    coordinator,
    lease,
    directory,
    supervision,
    snapshots,
    service,
    options,
    runtime,
    prepare,
    recoveryChecks: () => recoveryChecks,
  };
}
test('internal service verifies readonly snapshot and opaque witness without releasing profile/global ownership', async (t) => {
  const f = fixture(t),
    prepared = f.prepare();
  assert.equal(JSON.stringify(prepared), undefined);
  assert.equal(inspect(prepared), '[PreparedResolverRequest]');
  const before = f.snapshots.load(f.account.id, f.contact.contact.id);
  const result = await f.service.resolveCurrentChat(prepared, f.runtime);
  assert.equal(result.status, 'VERIFIED');
  assert.equal(f.directory.opens, 1);
  assert.ok(f.recoveryChecks() > 1);
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
  assert.deepEqual(f.snapshots.load(f.account.id, f.contact.contact.id), before);
  assert.equal(JSON.stringify(result), '{"status":"VERIFIED"}');
  if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
  assert.equal(await f.service.revalidateCurrentChat(result.witness, f.runtime), null);
  assert.equal((await f.service.resolveCurrentChat(prepared, f.runtime)).status, 'FAILED'); // Consumed request.
});
test('pre-open preferred switch blocks navigation; Contact.updatedAt remains unchanged', async (t) => {
  const f = fixture(t),
    prepared = f.prepare();
  const alternative = f.identities.create({
    accountId: f.account.id,
    contactId: f.contact.contact.id,
    kind: 'UNIQUE_ID',
    value: 'Synthetic-new-preferred',
    source: 'DOM',
    now: new Date(1000),
  });
  f.directory.afterRead = () =>
    f.identities.setPreferred(f.contact.contact.id, alternative.id, new Date(1000));
  const result = await f.service.resolveCurrentChat(prepared, f.runtime);
  assert.deepEqual(result, { status: 'IDENTITY_CHANGED', reason: 'METADATA_VERSION_CHANGED' });
  assert.equal(f.contacts.findById(f.contact.contact.id)?.updatedAt.getTime(), 1000);
  assert.equal(f.directory.opens, 0);
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
});
test('metadata change after open and during final async revalidation cannot publish VERIFIED', async (t) => {
  for (const phase of ['open', 'final'] as const) {
    const f = fixture(t),
      prepared = f.prepare();
    const mutate = () =>
      f.contacts.update(f.contact.contact.id, { displayName: 'Changed synthetic metadata' });
    if (phase === 'open') f.directory.beforeOpen = mutate;
    else {
      const current = f.directory.currentConversation.bind(f.directory);
      let reads = 0;
      f.directory.currentConversation = async (budget) => {
        const value = await current(budget);
        if (++reads === 2) mutate();
        return value;
      };
    }
    const result = await f.service.resolveCurrentChat(prepared, f.runtime);
    assert.deepEqual(result, { status: 'IDENTITY_CHANGED', reason: 'METADATA_VERSION_CHANGED' });
    assert.equal(f.directory.opens, 1);
    assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
  }
});
test('DB failure before open is FAILED and preserves ownership', async (t) => {
  const f = fixture(t),
    prepared = f.prepare();
  f.directory.afterRead = () => f.client.close();
  assert.deepEqual(await f.service.resolveCurrentChat(prepared, f.runtime), {
    status: 'FAILED',
    reason: 'PERSISTENCE_FAILURE',
  });
  assert.equal(f.directory.opens, 0);
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
});
test('forged runtime/lease token and wrong Account profile cannot become browser authority', async (t) => {
  const f = fixture(t);
  assert.equal(
    (await f.service.resolveCurrentChat(f.prepare(), {} as ExistingTargetResolverRuntime)).status,
    'FAILED',
  );
  const forged = bindExistingTargetResolverRuntime({
    ...f.options,
    lease: { ...f.lease, token: 'synthetic-forged-token' },
  });
  assert.equal((await f.service.resolveCurrentChat(f.prepare(), forged)).status, 'FAILED');
  const mismatched = bindExistingTargetResolverRuntime({ ...f.options, accountId: randomUUID() });
  assert.equal((await f.service.resolveCurrentChat(f.prepare(), mismatched)).status, 'FAILED');
  assert.equal(f.directory.reads, 0);
  assert.equal(f.directory.opens, 0);
  assert.equal(f.recoveryChecks(), 0);
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
});
test('await recovery before any Page operation; incomplete recovery never releases ownership', async (t) => {
  const f = fixture(t);
  let finish: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const runtime = bindExistingTargetResolverRuntime({
    ...f.options,
    supervision: { ...f.supervision, assertRecoveredOwnership: () => barrier },
  });
  const pending = f.service.resolveCurrentChat(f.prepare(), runtime);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.directory.reads, 0);
  assert.equal(f.directory.opens, 0);
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
  finish!();
  assert.equal((await pending).status, 'VERIFIED');
  const hung = bindExistingTargetResolverRuntime({
    ...f.options,
    supervision: { ...f.supervision, assertRecoveredOwnership: () => new Promise(() => {}) },
  });
  const result = await f.service.resolveCurrentChat(f.prepare(), hung, Date.now() + 30);
  assert.notEqual(result.status, 'VERIFIED');
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
});
test('persisted profile marker is required even with a current coordinator lease', async (t) => {
  const f = fixture(t),
    other = createTemporaryDatabase(t);
  const runtime = bindExistingTargetResolverRuntime({
    ...f.options,
    profiles: new AccountProfileStore(other.directory),
  });
  assert.equal((await f.service.resolveCurrentChat(f.prepare(), runtime)).status, 'FAILED');
  assert.equal(f.directory.reads, 0);
  assert.equal(f.directory.opens, 0);
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
});
test('verified witness revalidation sees preferred change and lease loss, never revives token', async (t) => {
  for (const mutation of ['metadata', 'lease'] as const) {
    const f = fixture(t),
      result = await f.service.resolveCurrentChat(f.prepare(), f.runtime);
    if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
    if (mutation === 'metadata')
      f.contacts.update(f.contact.contact.id, { displayName: 'New synthetic name' });
    else f.lease.release();
    assert.notEqual(await f.service.revalidateCurrentChat(result.witness, f.runtime), null);
    assert.notEqual(await f.service.revalidateCurrentChat(result.witness, f.runtime), null);
  }
});
