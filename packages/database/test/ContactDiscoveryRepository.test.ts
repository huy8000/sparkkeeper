import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  AccountRepository,
  AdminUserRepository,
  AccountOnboardingRepository,
  ContactDiscoveryRepository,
  ContactDiscoveryError,
  ContactRepository,
  createDatabase,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';
import type { ContactObservation } from '@sparkkeeper/shared';

const row = (uid: string, extra: Partial<ContactObservation> = {}): ContactObservation => ({
  type: 'PERSON',
  displayName: 'Same name',
  remarkName: null,
  identities: { SEC_UID: uid },
  avatarRemoteUrl: null,
  streakDays: null,
  observedAt: 1000,
  adapterVersion: 'fixture-v1',
  ...extra,
});
function fixture(t: Parameters<typeof createTemporaryDatabase>[0]) {
  const { client, ...temp } = createTemporaryDatabase(t);
  const account = new AccountRepository(client).create({
    name: 'fixture',
    loginStatus: 'READY',
    profileState: 'READY',
    douyinSecUid: 'self',
  });
  const admin = new AdminUserRepository(client).create({
    username: 'fixture',
    passwordHash: 'fixture-hash',
  });
  const repo = new ContactDiscoveryRepository(client);
  return { client, account, admin, repo, ...temp };
}
test('discovery stable dedup, same names, account isolation, preferred does not upgrade', (t) => {
  const f = fixture(t);
  const apply = (key: string, observations: ContactObservation[]) =>
    f.repo.publish(f.repo.start(f.account.id, f.admin.id, key).run.id, {
      status: 'COMPLETE',
      failureCode: null,
      observations,
      issueCount: 0,
      authChecked: true,
    });
  assert.equal(apply('one', [row('a'), row('a'), row('b')])?.createdCount, 2);
  const a = f.repo
    .list(f.account.id, { limit: 50 })
    .find((c) => f.repo.identities(c.id).some((i) => i.value === 'a'))!;
  apply('two', [row('a', { identities: { SEC_UID: 'a', UNIQUE_ID: 'added' } }), row('b')]);
  assert.equal(f.repo.identities(a.id).find((i) => i.isPreferred)?.kind, 'SEC_UID');
  apply('three', [row('unused', { identities: { UNIQUE_ID: 'added' } })]);
  assert.equal(f.repo.contact(a.id)?.identityStatus, 'CHANGED');
  apply('four', [row('a')]);
  assert.equal(f.repo.contact(a.id)?.identityStatus, 'CHANGED');
  const b = new AccountRepository(f.client).create({
    name: 'other',
    loginStatus: 'READY',
    profileState: 'READY',
  });
  const run = f.repo.start(b.id, f.admin.id, 'other').run;
  assert.equal(
    f.repo.publish(run.id, {
      status: 'COMPLETE',
      failureCode: null,
      observations: [row('a')],
      issueCount: 0,
      authChecked: true,
    })?.createdCount,
    1,
  );
});
test('complete-only stale, first missing 24h, partial rediscovery, immutable replay', (t) => {
  const f = fixture(t);
  const apply = (
    key: string,
    status: 'COMPLETE' | 'PARTIAL' | 'FAILED',
    observations: ContactObservation[],
    at: number,
  ) => {
    const run = f.repo.start(f.account.id, f.admin.id, key, new Date(at)).run;
    return f.repo.publish(
      run.id,
      {
        status,
        failureCode:
          status === 'COMPLETE'
            ? null
            : status === 'PARTIAL'
              ? 'DISCOVERY_STALLED'
              : 'BROWSER_FAILURE',
        observations,
        issueCount: 0,
        authChecked: true,
      },
      new Date(at),
    );
  };
  apply('seed', 'COMPLETE', [row('a')], 1000);
  const contact = f.repo.list(f.account.id, { limit: 50 })[0]!;
  apply('miss1', 'COMPLETE', [], 2000);
  apply('partial', 'PARTIAL', [], 3000);
  apply('failed', 'FAILED', [], 4000);
  assert.equal(f.repo.contact(contact.id)?.missedFullSyncCount, 1);
  apply('miss2', 'COMPLETE', [], 5000);
  const third = apply('miss3', 'COMPLETE', [], 86402000)!;
  assert.equal(f.repo.contact(contact.id)?.availabilityStatus, 'UNAVAILABLE');
  f.repo.publish(
    third.id,
    { status: 'COMPLETE', failureCode: null, observations: [], issueCount: 0, authChecked: true },
    new Date(86403000),
  );
  assert.equal(f.repo.contact(contact.id)?.missedFullSyncCount, 3);
  apply('found', 'PARTIAL', [row('a')], 86404000);
  assert.equal(f.repo.contact(contact.id)?.availabilityStatus, 'AVAILABLE');
  assert.equal(f.repo.contact(contact.id)?.firstMissingAt, null);
});
test('bridge/type/superseded conflicts downgrade complete and never stale unrelated Contacts', (t) => {
  const f = fixture(t);
  const first = f.repo.start(f.account.id, f.admin.id, 'seed').run;
  f.repo.publish(first.id, {
    status: 'COMPLETE',
    failureCode: null,
    observations: [row('a', { identities: { SEC_UID: 'a', UNIQUE_ID: 'ua' } }), row('b'), row('c')],
    issueCount: 0,
    authChecked: true,
  });
  const run = f.repo.start(f.account.id, f.admin.id, 'bridge').run;
  const result = f.repo.publish(run.id, {
    status: 'COMPLETE',
    failureCode: null,
    observations: [row('b', { identities: { SEC_UID: 'b', UNIQUE_ID: 'ua' } })],
    issueCount: 0,
    authChecked: true,
  })!;
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.issueCount, 1);
  assert.ok(f.repo.list(f.account.id, { limit: 50 }).every((c) => c.missedFullSyncCount === 0));
  assert.equal(
    f.repo.list(f.account.id, { limit: 50 }).filter((c) => c.identityStatus === 'AMBIGUOUS').length,
    2,
  );
});
test('durable global admission, key replay/conflict and reciprocal onboarding exclusion', (t) => {
  const f = fixture(t);
  const login = new AccountOnboardingRepository(f.client);
  const start = f.repo.start(f.account.id, f.admin.id, 'same');
  assert.equal(f.repo.start(f.account.id, f.admin.id, 'same').run.id, start.run.id);
  assert.throws(
    () => f.repo.start('different', f.admin.id, 'same'),
    (e: unknown) => e instanceof ContactDiscoveryError && e.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.throws(() => f.repo.start(f.account.id, f.admin.id, 'next'), /PROFILE_BUSY/);
  assert.equal(
    login.start({
      purpose: 'ADD_ACCOUNT',
      createdByAdminUserId: f.admin.id,
      idempotencyKey: 'login',
    }).outcome,
    'ACTIVE_CONFLICT',
  );
  f.repo.interrupt(start.run.id);
  login.start({
    purpose: 'ADD_ACCOUNT',
    createdByAdminUserId: f.admin.id,
    idempotencyKey: 'login',
  });
  assert.throws(() => f.repo.start(f.account.id, f.admin.id, 'next'), /PROFILE_BUSY/);
});
test('type conflict and superseded collision are quarantined; auth expiry cannot publish rows', (t) => {
  const f = fixture(t);
  const publish = (key: string, observation: ContactObservation) =>
    f.repo.publish(f.repo.start(f.account.id, f.admin.id, key).run.id, {
      status: 'COMPLETE',
      failureCode: null,
      issueCount: 0,
      authChecked: true,
      observations: [observation],
    });
  publish('seed', row('a'));
  const contact = f.repo.list(f.account.id, { limit: 50 })[0]!;
  assert.equal(publish('type', row('a', { type: 'UNKNOWN' }))?.status, 'PARTIAL');
  assert.equal(f.repo.contact(contact.id)?.type, 'PERSON');
  f.client.sqlite
    .prepare(
      "UPDATE contact_identities SET state='SUPERSEDED',is_preferred=0,superseded_at=2000 WHERE contact_id=? AND kind='SEC_UID'",
    )
    .run(contact.id);
  assert.equal(publish('superseded', row('a'))?.createdCount, 0);
  assert.equal(f.repo.list(f.account.id, { limit: 50 }).length, 1);
  assert.equal(f.repo.contact(contact.id)?.identityStatus, 'AMBIGUOUS');
  const run = f.repo.start(f.account.id, f.admin.id, 'expired').run;
  f.repo.publish(run.id, {
    status: 'AUTH_EXPIRED',
    failureCode: 'AUTH_EXPIRED',
    issueCount: 0,
    authChecked: true,
    observations: [row('other')],
  });
  assert.equal(f.repo.list(f.account.id, { limit: 50 }).length, 1);
  assert.equal(f.repo.contact(contact.id)?.missedFullSyncCount, 0);
  assert.equal(f.repo.account(f.account.id)?.loginStatus, 'AUTH_EXPIRED');
});
test('complete empty scan handles historical directories above the 500-observation budget', (t) => {
  const f = fixture(t);
  const contacts = new ContactRepository(f.client);
  f.client.orm.transaction(() => {
    for (let i = 0; i < 501; i++)
      contacts.create({ accountId: f.account.id, type: 'UNKNOWN', displayName: `fixture-${i}` });
  });
  const run = f.repo.start(f.account.id, f.admin.id, 'empty').run;
  const result = f.repo.publish(run.id, {
    status: 'COMPLETE',
    failureCode: null,
    observations: [],
    issueCount: 0,
    authChecked: true,
  });
  assert.equal(result?.staleCount, 501);
  assert.equal(result?.status, 'COMPLETE');
});
test('atomic publication failure, interrupt and reopen preserve history/FKs', (t) => {
  const f = fixture(t);
  const r = f.repo.start(f.account.id, f.admin.id, 'atomic').run;
  f.client.sqlite.exec(
    "CREATE TRIGGER fixture_fail BEFORE INSERT ON contact_identities BEGIN SELECT RAISE(ABORT,'fixture'); END",
  );
  assert.throws(() =>
    f.repo.publish(r.id, {
      status: 'COMPLETE',
      failureCode: null,
      observations: [row('a')],
      issueCount: 0,
      authChecked: true,
    }),
  );
  assert.equal(f.repo.list(f.account.id, { limit: 50 }).length, 0);
  assert.equal(f.repo.find(r.id)?.status, 'PENDING');
  f.client.sqlite.exec('DROP TRIGGER fixture_fail');
  f.repo.interrupt(r.id);
  const old = new ContactRepository(f.client).create({
    accountId: f.account.id,
    type: 'UNKNOWN',
    displayName: 'fixture',
    missedFullSyncCount: 2,
  });
  assert.ok(old.firstMissingAt);
  f.client.migrate();
  const reopened = createDatabase({ databasePath: f.databasePath });
  t.after(() => reopened.close());
  reopened.migrate();
  assert.deepEqual(reopened.sqlite.pragma('foreign_key_check'), []);
  assert.equal(new ContactDiscoveryRepository(reopened).find(r.id)?.status, 'FAILED');
});
test('simultaneous independent DB connections serialize sync/sync and sync/relogin admission', async (t) => {
  const f = fixture(t);
  const other = new AccountRepository(f.client).create({
    name: 'other',
    loginStatus: 'READY',
    profileState: 'READY',
  });
  for (const competitor of ['sync', 'relogin']) {
    const barrier = new SharedArrayBuffer(4);
    const workers = ['sync', competitor].map(
      (mode, index) =>
        new Worker(
          `
      const {parentPort,workerData:d}=require('node:worker_threads');
      (async()=>{const m=await import(d.module);const db=m.createDatabase({databasePath:d.path});
        try{parentPort.postMessage('ready');Atomics.wait(new Int32Array(d.barrier),0,0);
          let ok=false;
          if(d.mode==='sync'){new m.ContactDiscoveryRepository(db).start(d.account,d.admin,d.key);ok=true;}
          else ok=new m.AccountOnboardingRepository(db).start({purpose:'RELOGIN',accountId:d.account,createdByAdminUserId:d.admin,idempotencyKey:d.key}).outcome==='CREATED';
          parentPort.postMessage(ok?'created':'blocked');
        }catch(e){parentPort.postMessage(e.code==='PROFILE_BUSY'?'blocked':'unexpected:'+e.message);}
        finally{db.close();}})();`,
          {
            eval: true,
            workerData: {
              module: new URL('../dist/index.js', import.meta.url).href,
              path: f.databasePath,
              account: index ? other.id : f.account.id,
              admin: f.admin.id,
              key: `${competitor}-${index}`,
              mode,
              barrier,
            },
          },
        ),
    );
    t.after(async () => {
      await Promise.all(workers.map((w) => w.terminate()));
    });
    const channels = workers.map((w) => {
      let ready!: () => void, done!: (value: string) => void;
      const readiness = new Promise<void>((r) => {
        ready = r;
      });
      const result = new Promise<string>((r, reject) => {
        done = r;
        w.once('error', reject);
      });
      w.on('message', (value: string) => (value === 'ready' ? ready() : done(value)));
      return { readiness, result };
    });
    await Promise.all(channels.map((c) => c.readiness));
    Atomics.store(new Int32Array(barrier), 0, 1);
    Atomics.notify(new Int32Array(barrier), 0, 2);
    assert.deepEqual((await Promise.all(channels.map((c) => c.result))).sort(), [
      'blocked',
      'created',
    ]);
    for (const run of f.repo.findActive()) f.repo.interrupt(run.id);
    const login = new AccountOnboardingRepository(f.client);
    const active = login.findActiveGlobal();
    if (active) login.cancel(active.id, f.admin.id, active.updatedAt);
  }
});
