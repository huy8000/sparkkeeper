import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import {
  AccountRepository,
  ContactRepository,
  ContactIdentityRepository,
  TargetResolverSnapshotRepository,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

function fixture(t: Parameters<typeof createTemporaryDatabase>[0]) {
  const temp = createTemporaryDatabase(t);
  const accounts = new AccountRepository(temp.client),
    contacts = new ContactRepository(temp.client),
    identities = new ContactIdentityRepository(temp.client);
  const account = accounts.create({
    name: 'Synthetic owner',
    loginStatus: 'READY',
    profileState: 'READY',
    douyinSecUid: 'fixture-self',
  });
  const contact = contacts.createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Same synthetic name',
    initialIdentity: { kind: 'SEC_UID', value: 'fixture-target', source: 'DOM' },
    now: new Date(1000),
  });
  return {
    ...temp,
    accounts,
    contacts,
    identities,
    account,
    contact,
    snapshots: new TargetResolverSnapshotRepository(temp.client),
  };
}
test('snapshot is account-scoped, coherent, frozen and read-only', (t) => {
  const f = fixture(t),
    sqlite = new BetterSqlite3(f.databasePath);
  t.after(() => sqlite.close());
  const before = sqlite.prepare('select * from contact_identities').all();
  const ready = f.snapshots.load(f.account.id, f.contact.contact.id);
  assert.equal(ready.status, 'READY');
  if (ready.status !== 'READY') throw new Error('fixture not ready');
  assert.equal(ready.request.preferredIdentity.normalizedValue, 'fixture-target');
  assert.deepEqual(ready.accountBinding, {
    accountId: f.account.id,
    kind: 'SEC_UID',
    normalizedValue: 'fixture-self',
  });
  assert.ok(Object.isFrozen(ready.request.preferredIdentity));
  assert.deepEqual(sqlite.prepare('select * from contact_identities').all(), before);
  const other = f.accounts.create({ name: 'Other synthetic owner', douyinSecUid: 'fixture-other' });
  assert.equal(f.snapshots.load(other.id, f.contact.contact.id).status, 'UNAVAILABLE');
});
test('same-ms preferred switch changes snapshot without Contact.updatedAt change', (t) => {
  const f = fixture(t);
  const before = f.snapshots.load(f.account.id, f.contact.contact.id);
  const identity = f.identities.create({
    accountId: f.account.id,
    contactId: f.contact.contact.id,
    kind: 'UNIQUE_ID',
    value: 'Fixture-002',
    source: 'DOM',
    now: new Date(1000),
  });
  f.identities.setPreferred(f.contact.contact.id, identity.id, new Date(1000));
  const after = f.snapshots.load(f.account.id, f.contact.contact.id);
  assert.equal(f.contacts.findById(f.contact.contact.id)?.updatedAt.getTime(), 1000);
  assert.equal(before.status, 'READY');
  assert.equal(after.status, 'READY');
  if (before.status !== 'READY' || after.status !== 'READY') throw new Error('fixture not ready');
  assert.notEqual(after.request.expectedMetadataVersion, before.request.expectedMetadataVersion);
  assert.equal(after.request.preferredIdentity.kind, 'UNIQUE_ID');
});
test('Account readiness and persisted Contact risks block before resolution', (t) => {
  const f = fixture(t),
    id = f.contact.contact.id;
  const sqlite = new BetterSqlite3(f.databasePath);
  t.after(() => sqlite.close());
  f.accounts.update(f.account.id, { profileState: 'PROVISIONING' });
  assert.equal(f.snapshots.load(f.account.id, id).status, 'UNAVAILABLE');
  // Public Account.update correctly hides PROVISIONING; simulate internal completion here.
  sqlite
    .prepare(
      "update accounts set profile_state = 'READY', login_status = 'AUTH_EXPIRED' where id = ?",
    )
    .run(f.account.id);
  assert.equal(f.snapshots.load(f.account.id, id).status, 'AUTH_EXPIRED');
  f.accounts.update(f.account.id, { loginStatus: 'READY' });
  f.contacts.update(id, { identityStatus: 'CHANGED' });
  assert.equal(f.snapshots.load(f.account.id, id).status, 'IDENTITY_CHANGED');
  f.contacts.update(id, { identityStatus: 'AMBIGUOUS' });
  assert.equal(f.snapshots.load(f.account.id, id).status, 'AMBIGUOUS');
  f.contacts.update(id, { identityStatus: 'READY', availabilityStatus: 'UNAVAILABLE' });
  assert.equal(f.snapshots.load(f.account.id, id).status, 'UNAVAILABLE');
});
test('zero/superseded preferred does not choose another observed stable identity', (t) => {
  const f = fixture(t);
  f.identities.create({
    accountId: f.account.id,
    contactId: f.contact.contact.id,
    kind: 'UNIQUE_ID',
    value: 'alternative-fixture',
    source: 'DOM',
  });
  f.identities.supersede(f.contact.identity.id);
  const result = f.snapshots.load(f.account.id, f.contact.contact.id);
  assert.deepEqual(result, { status: 'UNAVAILABLE', reason: 'TARGET_IDENTITY_UNAVAILABLE' });
});
test('dirty cross-account/multiple preferred data is an integrity failure', (t) => {
  const f = fixture(t),
    sqlite = new BetterSqlite3(f.databasePath);
  t.after(() => sqlite.close());
  const other = f.accounts.create({ name: 'Other synthetic owner', douyinSecUid: 'fixture-other' });
  sqlite
    .prepare('update contact_identities set account_id = ? where id = ?')
    .run(other.id, f.contact.identity.id);
  assert.deepEqual(f.snapshots.load(f.account.id, f.contact.contact.id), {
    status: 'FAILED',
    reason: 'PERSISTENCE_FAILURE',
  });
  sqlite
    .prepare('update contact_identities set account_id = ? where id = ?')
    .run(f.account.id, f.contact.identity.id);
  const second = f.identities.create({
    accountId: f.account.id,
    contactId: f.contact.contact.id,
    kind: 'UNIQUE_ID',
    value: 'second-fixture',
    source: 'DOM',
  });
  sqlite.exec('drop index contact_identities_preferred_active_idx'); // Only this disposable corrupt-data fixture.
  sqlite.prepare('update contact_identities set is_preferred = 1 where id = ?').run(second.id);
  assert.deepEqual(f.snapshots.load(f.account.id, f.contact.contact.id), {
    status: 'FAILED',
    reason: 'PERSISTENCE_FAILURE',
  });
});
test('name preference remains unsupported; group uses conversation ID', (t) => {
  const f = fixture(t),
    sqlite = new BetterSqlite3(f.databasePath);
  t.after(() => sqlite.close());
  sqlite
    .prepare("update contact_identities set kind = 'DISPLAY_NAME' where id = ?")
    .run(f.contact.identity.id);
  assert.equal(f.snapshots.load(f.account.id, f.contact.contact.id).status, 'UNAVAILABLE');
  const group = f.contacts.createWithPreferredIdentity({
    accountId: f.account.id,
    type: 'GROUP',
    displayName: 'Synthetic group',
    initialIdentity: { kind: 'CONVERSATION_ID', value: 'fixture-group-chat', source: 'DOM' },
  });
  const snapshot = f.snapshots.load(f.account.id, group.contact.id);
  assert.equal(snapshot.status, 'READY');
  if (snapshot.status === 'READY')
    assert.equal(snapshot.request.preferredIdentity.kind, 'CONVERSATION_ID');
});
test('driver failure cannot be classified as NOT_FOUND or auth expiry', (t) => {
  const f = fixture(t);
  f.client.close();
  assert.deepEqual(f.snapshots.load(f.account.id, f.contact.contact.id), {
    status: 'FAILED',
    reason: 'PERSISTENCE_FAILURE',
  });
});
