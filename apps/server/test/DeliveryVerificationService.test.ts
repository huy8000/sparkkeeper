import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import {
  AccountRepository,
  ContactRepository,
  TargetResolverSnapshotRepository,
} from '@sparkkeeper/database';
import { createTemporaryDatabase } from '../../../packages/database/test/testDatabase.js';
import { FixtureDirectory } from '../../../packages/automation/test/resolverFixture.js';
import { FakeDeliveryPort } from '../../../packages/automation/test/deliveryFixture.js';
import {
  TargetResolutionService,
  bindExistingTargetResolverRuntime,
  type ExistingTargetResolverRuntime,
} from '../src/automation/TargetResolutionService.js';
import { DeliveryVerificationService } from '../src/automation/DeliveryVerificationService.js';
import { AccountProfileStore } from '../src/onboarding/AccountProfileStore.js';
import { BrowserOperationCoordinator } from '../src/onboarding/BrowserOperationCoordinator.js';

async function fixture(t: TestContext) {
  const temp = createTemporaryDatabase(t);
  const account = new AccountRepository(temp.client).create({
    name: 'Synthetic account',
    loginStatus: 'READY',
    profileState: 'READY',
    douyinSecUid: 'synthetic-self',
  });
  const contacts = new ContactRepository(temp.client);
  const contact = contacts.createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Synthetic target',
    initialIdentity: { kind: 'SEC_UID', value: 'Fixture-001', source: 'DOM' },
  });
  const profiles = new AccountProfileStore(temp.directory),
    session = randomUUID();
  profiles.prepareStaging(session, account.id);
  profiles.finalizeStaging(session, account.id);
  const coordinator = new BrowserOperationCoordinator(),
    lease = coordinator.acquire(randomUUID(), account.id)!;
  t.after(() => lease.release());
  const directory = new FixtureDirectory();
  const runtime = bindExistingTargetResolverRuntime({
    accountId: account.id,
    profiles,
    coordinator,
    lease,
    directory,
    supervision: {
      accountId: account.id,
      operationId: lease.operationId,
      generation: {},
      assertRecoveredOwnership: async () => {},
    },
  });
  const targets = new TargetResolutionService(new TargetResolverSnapshotRepository(temp.client));
  const prepared = targets.prepare(account.id, contact.contact.id);
  if (prepared.status !== 'PREPARED') throw new Error('fixture not prepared');
  const resolved = await targets.resolveCurrentChat(prepared.request, runtime);
  if (resolved.status !== 'VERIFIED') throw new Error('fixture not verified');
  const port = new FakeDeliveryPort(directory.state.page, directory.state.context);
  const service = new DeliveryVerificationService(targets);
  return {
    ...temp,
    account,
    contact,
    contacts,
    coordinator,
    lease,
    directory,
    runtime,
    targets,
    port,
    service,
    witness: resolved.witness,
  };
}
const limits = { verificationTimeoutMs: 200, pollIntervalMs: 5 };
test('delivery wrapper retains registered runtime/DB binding without writing Contact or releasing leases', async (t) => {
  const f = await fixture(t);
  let boundaries = 0;
  const before = f.contacts.findById(f.contact.contact.id);
  const result = await f.service.verify({
    witness: f.witness,
    runtime: f.runtime,
    observation: f.port,
    message: 'Synthetic text',
    boundary: {
      record: async () => {
        boundaries++;
      },
    },
    limits,
  });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(boundaries, 1);
  assert.equal(f.port.clicks, 1);
  assert.deepEqual(f.contacts.findById(f.contact.contact.id), before);
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
});
test('metadata/lease/DB failure or wrong registered runtime before boundary forbids callback/click', async (t) => {
  for (const mode of ['metadata', 'lease', 'database', 'runtime']) {
    const f = await fixture(t);
    let boundaries = 0;
    if (mode === 'metadata')
      f.contacts.update(f.contact.contact.id, { displayName: 'Changed metadata' });
    if (mode === 'lease') f.lease.release();
    if (mode === 'database') f.client.close();
    const result = await f.service.verify({
      witness: f.witness,
      runtime: mode === 'runtime' ? ({} as ExistingTargetResolverRuntime) : f.runtime,
      observation: f.port,
      message: 'Synthetic text',
      boundary: {
        record: async () => {
          boundaries++;
        },
      },
      limits,
    });
    assert.equal(result.status, 'FAILED');
    assert.equal(boundaries, 0);
    assert.equal(f.port.clicks, 0);
  }
});
test('metadata drift during boundary is UNKNOWN with zero click and no lease release', async (t) => {
  const f = await fixture(t);
  const result = await f.service.verify({
    witness: f.witness,
    runtime: f.runtime,
    observation: f.port,
    message: 'Synthetic text',
    boundary: {
      record: async () => {
        f.contacts.update(f.contact.contact.id, { displayName: 'Boundary-time metadata mutation' });
      },
    },
    limits,
  });
  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(result.boundary, 'RECORDED');
  assert.equal(f.port.clicks, 0);
  assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
});
test('DB mutation during last asynchronous evidence/cleanup cannot escape final snapshot validation', async (t) => {
  for (const phase of ['evidence', 'cleanup']) {
    const f = await fixture(t);
    const mutate = () =>
      f.contacts.update(f.contact.contact.id, { displayName: 'Final metadata mutation' });
    if (phase === 'evidence') {
      const observe = f.port.observe.bind(f.port);
      let reads = 0;
      f.port.observe = async (budget) => {
        const evidence = await observe(budget);
        if (++reads === 2) mutate();
        return evidence;
      };
    } else
      f.port.dispose = async () => {
        f.port.disposed++;
        mutate();
      };
    const result = await f.service.verify({
      witness: f.witness,
      runtime: f.runtime,
      observation: f.port,
      message: 'Synthetic text',
      boundary: { record: async () => {} },
      limits,
    });
    assert.equal(result.status, 'DELIVERY_UNKNOWN');
    assert.equal(f.port.clicks, 1);
    assert.equal(f.coordinator.isLeaseCurrent(f.lease), true);
  }
});
