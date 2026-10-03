import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import {
  AccountOnboardingRepository,
  ContactDiscoveryRepository,
  ContactRepository,
  ScheduledSendRepository,
  TestSendRepository,
  createDatabase,
  type ScheduledSnapshot,
} from '../src/index.js';
import { taskWindow } from '@sparkkeeper/shared';
import { scheduledFixture } from './scheduledFixture.js';
test('task config is disabled, CAS/versioned, account-scoped, audited; overlap and archive do not delete history', (t) => {
  const f = scheduledFixture(t);
  assert.equal(f.task.enabled, false);
  assert.throws(
    () => f.repository.tasks.mutate(f.task.id, f.task.updatedAt, f.admin.id, 'enable'),
    /RELEASE_GATE_CLOSED/u,
  );
  const enabled = f.enable();
  assert.ok(Date.parse(enabled.updatedAt) > Date.parse(f.task.updatedAt));
  assert.throws(
    () =>
      f.repository.tasks.mutate(f.task.id, enabled.updatedAt, f.admin.id, 'patch', f.configuration),
    /TASK_CONFLICT/u,
  );
  const other = f.repository.tasks.create(f.configuration, f.admin.id);
  assert.deepEqual(other.overlaps, [f.task.id]);
  assert.throws(
    () =>
      f.repository.tasks.create(
        { ...f.configuration, contactIds: [f.target.contact.id, f.target.contact.id] },
        f.admin.id,
      ),
    /VALIDATION_ERROR/u,
  );
  const disabled = f.repository.tasks.mutate(f.task.id, enabled.updatedAt, f.admin.id, 'disable');
  assert.throws(
    () => f.repository.tasks.mutate(f.task.id, enabled.updatedAt, f.admin.id, 'archive'),
    /TASK_CONFLICT/u,
  );
  assert.equal(
    f.repository.tasks.mutate(f.task.id, disabled.updatedAt, f.admin.id, 'archive').state,
    'ARCHIVED',
  );
});
test('publication freezes all messages; durable ownership/record CAS, action CAS and terminal UNKNOWN cannot replay', (t) => {
  const f = scheduledFixture(t);
  f.enable();
  const run = f.publish(),
    r = f.repository.run(run.id).records[0]!;
  const other = createDatabase({ databasePath: f.databasePath });
  t.after(() => other.close());
  const second = new ScheduledSendRepository(other, f.clock);
  assert.equal(f.publish().id, run.id);
  assert.equal(f.repository.acquireRun(run.id, 'first'), true);
  assert.equal(second.acquireRun(run.id, 'second'), false);
  assert.equal(second.claim(r.id), false);
  assert.equal(f.repository.claim(r.id), true);
  assert.equal(f.repository.claim(r.id), false);
  assert.equal(
    new AccountOnboardingRepository(other).start({
      purpose: 'RELOGIN',
      accountId: f.account.id,
      createdByAdminUserId: f.admin.id,
      idempotencyKey: 'conflict',
    }).outcome,
    'ACTIVE_CONFLICT',
  );
  assert.throws(
    () => new ContactDiscoveryRepository(other).start(f.account.id, f.admin.id, 'conflict'),
    /PROFILE_BUSY/u,
  );
  const db = new BetterSqlite3(f.databasePath);
  t.after(() => db.close());
  assert.throws(
    () =>
      db.prepare('UPDATE target_send_records SET message_text=? WHERE id=?').run('changed', r.id),
    /IMMUTABLE_SCHEDULED_RECORD/u,
  );
  f.repository.boundary(r.id);
  assert.throws(() => f.repository.boundary(r.id), /TASK_CONFLICT/u);
  assert.equal(f.repository.finish(r.id, 'FAILED').status, 'DELIVERY_UNKNOWN');
  assert.equal(f.repository.claim(r.id), false);
  assert.equal(f.repository.finish(r.id, 'SUCCESS').status, 'DELIVERY_UNKNOWN');
  assert.equal(f.repository.execution(r.id).record.messageText, '  Synthetic message\nexact  ');
  assert.ok(!JSON.stringify(f.repository.detail(run.id)).includes('Synthetic message'));
});
test('terminal machine truth retains DB ownership across connections until cleanup proof; all runtime admissions stay closed', (t) => {
  const f = scheduledFixture(t);
  f.enable();
  const run = f.publish(),
    record = f.repository.run(run.id).records[0]!;
  f.repository.acquireRun(run.id, 'owner');
  f.repository.claim(record.id);
  f.repository.boundary(record.id);
  f.repository.finish(record.id, 'SUCCESS');
  const db = createDatabase({ databasePath: f.databasePath });
  t.after(() => db.close());
  const second = new ScheduledSendRepository(db, f.clock);
  assert.deepEqual(second.unfinished(), [{ runId: run.id, accountId: f.account.id }]);
  const another = second.tasks.create(f.configuration, f.admin.id, f.clock());
  second.tasks.mutate(
    another.id,
    another.updatedAt,
    f.admin.id,
    'enable',
    undefined,
    true,
    f.clock(),
  );
  assert.throws(
    () => second.publish(another.id, second.prepare(another.id), [f.template.messages[0]!]),
    /PROFILE_BUSY/u,
  );
  assert.equal(
    new AccountOnboardingRepository(db).start({
      purpose: 'RELOGIN',
      accountId: f.account.id,
      createdByAdminUserId: f.admin.id,
      idempotencyKey: 'terminal-cleanup',
    }).outcome,
    'ACTIVE_CONFLICT',
  );
  assert.throws(
    () => new ContactDiscoveryRepository(db).start(f.account.id, f.admin.id, 'terminal-cleanup'),
    /PROFILE_BUSY/u,
  );
  const testSend = new TestSendRepository(db),
    intent = testSend.preview(
      f.account.id,
      f.target.contact.id,
      f.template.id,
      f.admin.id,
      'terminal-preview',
      f.clock(),
    );
  assert.throws(
    () =>
      testSend.consume(
        f.account.id,
        f.admin.id,
        intent.intentId,
        intent.payloadDigest,
        'terminal-send',
        f.template.messages[0]!,
        f.clock(),
      ),
    /PROFILE_BUSY/u,
  );
  f.repository.releaseRun(run.id, 'owner'); // Manager calls this only after resource cleanup proof.
  assert.deepEqual(second.unfinished(), []);
  assert.equal(second.detail(run.id).status, 'SUCCESS');
  assert.ok(second.publish(another.id, second.prepare(another.id), [f.template.messages[0]!]));
});
test('post-boundary crash recovery skips untouched targets and preserves terminal machine truth on reopen', (t) => {
  const f = scheduledFixture(t);
  const target = new ContactRepository(f.client).createWithPreferredIdentity({
    accountId: f.account.id,
    type: 'PERSON',
    displayName: 'Another synthetic',
    initialIdentity: { kind: 'SEC_UID', value: 'fixture-second', source: 'DOM' },
  });
  f.repository.tasks.mutate(f.task.id, f.task.updatedAt, f.admin.id, 'patch', {
    ...f.configuration,
    contactIds: [f.target.contact.id, target.contact.id],
  });
  f.enable();
  const run = f.publish();
  f.repository.acquireRun(run.id, 'owned');
  const first = f.repository.run(run.id).records[0]!;
  assert.equal(f.repository.claim(first.id), true);
  assert.equal(f.repository.claim(f.repository.run(run.id).records[1]!.id), false);
  f.repository.boundary(first.id);
  f.client.close();
  const reopened = createDatabase({ databasePath: f.databasePath });
  t.after(() => reopened.close());
  reopened.migrate();
  const repo = new ScheduledSendRepository(reopened, f.clock);
  repo.reconcile(run.id);
  repo.reconcile(run.id);
  assert.equal(repo.detail(run.id).status, 'DELIVERY_UNKNOWN');
  assert.deepEqual(
    repo.detail(run.id).records.map((r) => r.machineStatus),
    ['DELIVERY_UNKNOWN', 'SKIPPED'],
  );
  assert.equal(repo.claim(first.id), false);
});
test('proven null-boundary recovery retry uses original snapshot, due time, original window/date and attempt bound', (t) => {
  const f = scheduledFixture(t);
  f.enable();
  const run = f.publish(),
    r = f.repository.run(run.id).records[0]!;
  f.repository.acquireRun(run.id, 'owned');
  f.repository.claim(r.id);
  f.repository.reconcile(run.id);
  assert.equal(f.repository.execution(r.id).record.machineStatus, 'RETRY_WAIT');
  assert.equal(f.repository.claim(r.id), false);
  f.setNow(new Date(f.clock().getTime() + 1000));
  assert.equal(f.repository.claim(r.id), true);
  assert.equal(f.repository.execution(r.id).record.messageText, r.messageText);
  f.repository.reconcile(run.id);
  f.setNow(new Date(f.clock().getTime() + 1000));
  assert.equal(f.repository.claim(r.id), true);
  f.repository.reconcile(run.id);
  assert.equal(f.repository.detail(run.id).status, 'FAILED');
  assert.equal(f.repository.claim(r.id), false);
});
test('window boundaries and repeated DST wall hours share one businessDate; drift rejects publication atomically', (t) => {
  const f = scheduledFixture(t);
  f.enable();
  const p: ScheduledSnapshot = f.repository.prepare(f.task.id);
  f.templates.update(f.template.id, { messages: ['changed'] });
  assert.throws(
    () => f.repository.publish(f.task.id, p, [f.template.messages[0]!]),
    /TASK_CONFLICT/u,
  );
  assert.equal(f.repository.unfinished().length, 0);
  const s = {
    ...f.configuration.schedule,
    timezone: 'America/New_York',
    startTime: '01:00',
    endTime: '02:00',
  };
  assert.deepEqual(
    taskWindow(new Date('2026-11-01T05:30:00Z'), s),
    taskWindow(new Date('2026-11-01T06:30:00Z'), s),
  );
  assert.equal(taskWindow(new Date('2026-10-03T12:00:00Z'), f.configuration.schedule).open, false);
  assert.equal(taskWindow(new Date('2026-10-03T09:00:00Z'), f.configuration.schedule).open, true);
});
