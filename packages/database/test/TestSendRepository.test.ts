import assert from 'node:assert/strict';
import test from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import {
  createDatabase,
  TestSendRepository,
  AccountOnboardingRepository,
  ContactDiscoveryRepository,
} from '../src/index.js';
import { testSendFixture } from './testSendFixture.js';
test('snapshot persistence failure is infrastructure failure, not target ineligibility', (t) => {
  const f = testSendFixture(t);
  const db = new BetterSqlite3(f.databasePath);
  t.after(() => db.close());
  db.exec('ALTER TABLE contact_identities RENAME TO fixture_unavailable_identities');
  assert.throws(
    () =>
      f.repository.preview(
        f.account.id,
        f.target.contact.id,
        f.template.id,
        f.admin.id,
        'persistence-failure',
      ),
    /PERSISTENCE_FAILURE/u,
  );
  assert.equal(f.repository.unfinished().length, 0);
});
test('preview freezes one stable target/template; atomic consume/replay preserves exact immutable message and audit', (t) => {
  const f = testSendFixture(t),
    admitted = f.consume();
  const e = f.repository.execution(admitted.runId);
  assert.equal(e.record.messageText, '  Synthetic message\nexact  ');
  assert.equal(e.record.attemptCount, 0);
  assert.equal(e.intent.activeSlot, 1);
  assert.equal(f.consume().runId, admitted.runId);
  assert.throws(() => f.consume('another-key'), /INTENT_CONSUMED/u);
  assert.throws(
    () =>
      f.repository.consume(
        f.account.id,
        f.admin.id,
        f.preview.intentId,
        '0'.repeat(64),
        'execute',
        'bad',
      ),
    /VALIDATION_ERROR|INTENT_CHANGED/u,
  );
  const db = new BetterSqlite3(f.databasePath);
  t.after(() => db.close());
  for (const statement of [
    "message_text = 'changed'",
    "target_identity_value_digest = 'other'",
    "machine_status='RETRY_WAIT',next_retry_at=123,failure_code='CONFIG_INVALID'",
    'attempt_count=2',
  ])
    assert.throws(() =>
      db.prepare(`UPDATE target_send_records SET ${statement} WHERE id=?`).run(e.record.id),
    );
  assert.throws(() =>
    db
      .prepare('UPDATE test_send_intents SET fingerprint=? WHERE id=?')
      .run('0'.repeat(64), e.intent.id),
  );
  assert.equal(
    (
      db.prepare('SELECT count(*) n FROM audit_events WHERE entity_id=?').get(admitted.runId) as {
        n: number;
      }
    ).n,
    1,
  );
  assert.equal(
    JSON.stringify(f.repository.detail(admitted.runId)).includes('Synthetic message'),
    false,
  );
});
test('TTL, same-ms template/contact drift, cross-account and conflicting preview key fail closed', (t) => {
  const f = testSendFixture(t);
  assert.throws(
    () =>
      f.repository.confirmationTemplate(
        f.account.id,
        f.admin.id,
        f.preview.intentId,
        f.preview.payloadDigest,
        new Date(f.preview.expiresAt),
      ),
    /INTENT_EXPIRED/u,
  );
  f.templates.update(f.template.id, { messages: ['changed'] });
  assert.throws(() => f.consume(), /INTENT_CHANGED/u);
  assert.throws(
    () => f.repository.preview(f.account.id, f.target.contact.id, 'other', f.admin.id, 'preview'),
    /IDEMPOTENCY_CONFLICT/u,
  );
  assert.throws(
    () =>
      f.repository.confirmationTemplate(
        'other',
        f.admin.id,
        f.preview.intentId,
        f.preview.payloadDigest,
      ),
    /INTENT_NOT_FOUND/u,
  );
  assert.equal(f.repository.unfinished().length, 0);
});
test('two DB connections serialize admission/claim/boundary; uncertain action cannot retry or downgrade', (t) => {
  const f = testSendFixture(t),
    admitted = f.consume();
  const other = createDatabase({ databasePath: f.databasePath });
  t.after(() => other.close());
  other.migrate();
  const repo = new TestSendRepository(other);
  assert.equal(repo.claim(admitted.runId), true);
  assert.equal(f.repository.claim(admitted.runId), false);
  f.repository.boundary(admitted.runId);
  assert.throws(() => repo.boundary(admitted.runId), /STATE_CONFLICT/u);
  assert.equal(repo.finish(admitted.runId, 'FAILED').status, 'DELIVERY_UNKNOWN');
  assert.equal(repo.claim(admitted.runId), false);
  assert.equal(f.consume().status, 'DELIVERY_UNKNOWN');
  const e = f.repository.execution(admitted.runId);
  assert.equal(e.record.attemptCount, 1);
  assert.equal(e.intent.activeSlot, null);
  assert.equal(repo.finish(admitted.runId, 'SUCCESS').status, 'DELIVERY_UNKNOWN');
});
test('global DB admission rejects second intent and rollback does not consume it', (t) => {
  const f = testSendFixture(t);
  f.consume();
  const other = createDatabase({ databasePath: f.databasePath });
  t.after(() => other.close());
  assert.equal(
    new AccountOnboardingRepository(other).start({
      purpose: 'RELOGIN',
      accountId: f.account.id,
      createdByAdminUserId: f.admin.id,
      idempotencyKey: 'conflicting-relogin',
    }).outcome,
    'ACTIVE_CONFLICT',
  );
  assert.throws(
    () => new ContactDiscoveryRepository(other).start(f.account.id, f.admin.id, 'conflicting-sync'),
    /PROFILE_BUSY/u,
  );
  const p = f.repository.preview(
    f.account.id,
    f.target.contact.id,
    f.template.id,
    f.admin.id,
    'second',
  );
  assert.throws(
    () =>
      f.repository.consume(
        f.account.id,
        f.admin.id,
        p.intentId,
        p.payloadDigest,
        'second',
        f.template.messages[0]!,
      ),
    /PROFILE_BUSY/u,
  );
  assert.equal(
    f.repository.confirmationTemplate(f.account.id, f.admin.id, p.intentId, p.payloadDigest).id,
    f.template.id,
  );
  const before = testSendFixture(t);
  assert.equal(
    new AccountOnboardingRepository(before.client).start({
      purpose: 'RELOGIN',
      accountId: before.account.id,
      createdByAdminUserId: before.admin.id,
      idempotencyKey: 'existing-relogin',
    }).outcome,
    'CREATED',
  );
  assert.throws(() => before.consume(), /PROFILE_BUSY/u);
});
test('reopen keeps snapshot and boundary; recovery terminal truth is idempotent and never regenerated', (t) => {
  for (const boundary of [false, true]) {
    const f = testSendFixture(t),
      admitted = f.consume();
    f.repository.claim(admitted.runId);
    if (boundary) f.repository.boundary(admitted.runId);
    f.client.close();
    const reopened = createDatabase({ databasePath: f.databasePath });
    t.after(() => reopened.close());
    reopened.migrate();
    const repo = new TestSendRepository(reopened);
    assert.equal(repo.unfinished().length, 1);
    assert.equal(
      repo.finish(admitted.runId, 'FAILED', 'PROCESS_INTERRUPTED_AFTER_ACTION').status,
      boundary ? 'DELIVERY_UNKNOWN' : 'FAILED',
    );
    assert.equal(repo.unfinished().length, 0);
    assert.equal(repo.claim(admitted.runId), false);
    assert.equal(repo.execution(admitted.runId).record.messageText, '  Synthetic message\nexact  ');
  }
});
