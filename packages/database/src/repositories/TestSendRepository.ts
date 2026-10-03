import { createHash, randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  isDeliveryMessage,
  normalizeDeliveryText,
  type TestSendPreview,
  type TestSendDetail,
  type TargetSendFailureCode,
} from '@sparkkeeper/shared';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  testSendIntents,
  executionRuns,
  targetSendRecords,
  accounts,
  contacts,
  auditEvents,
  accountLoginSessions,
  contactSyncRuns,
  adminUsers,
  dailyRuns,
  scheduledRunSnapshots,
} from '../schema/index.js';
import { ACTIVE_LOGIN_SESSION_STATUSES } from './AccountLoginSessionRepository.js';
import { TargetResolverSnapshotRepository } from './TargetResolverSnapshotRepository.js';
import { MessageTemplateRepository } from './MessageTemplateRepository.js';

export class TestSendError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_ERROR'
      | 'TARGET_NOT_ELIGIBLE'
      | 'INTENT_NOT_FOUND'
      | 'INTENT_EXPIRED'
      | 'INTENT_CHANGED'
      | 'INTENT_CONSUMED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'PROFILE_BUSY'
      | 'STATE_CONFLICT'
      | 'INTENT_LIMIT',
  ) {
    super(code);
  }
}
type Tx = Parameters<Parameters<DatabaseClient['orm']['transaction']>[0]>[0];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const testSendIdentityDigest = (kind: string, value: string) => hash([kind, value]);
function keyDigest(scope: string, admin: string, key: string) {
  if (!/^[\x20-\x7e]{1,128}$/u.test(key) || key.trim() !== key)
    throw new TestSendError('VALIDATION_ERROR');
  return hash([scope, admin, key]);
}
export class TestSendRepository {
  constructor(private readonly client: DatabaseClient) {}
  private transaction<T>(
    fn: (tx: Tx) => Extract<T, PromiseLike<unknown>> extends never ? T : never,
  ): T {
    let result: T;
    this.client.withBusyTimeout(0, () => {
      result = this.client.orm.transaction(
        (tx) => {
          const value = fn(tx);
          if (value && typeof value === 'object' && 'then' in value)
            throw new Error('ASYNC_TRANSACTION_FORBIDDEN');
          return value;
        },
        { behavior: 'immediate' },
      );
    });
    return result!;
  }
  /** Private coherent metadata/content snapshot shared by scheduled publication; never an API DTO. */
  snapshot(accountId: string, contactId: string, templateId: string) {
    const target = new TargetResolverSnapshotRepository(this.client).load(accountId, contactId);
    if (target.status !== 'READY' && target.reason === 'PERSISTENCE_FAILURE')
      throw new Error('PERSISTENCE_FAILURE');
    const template = new MessageTemplateRepository(this.client).findById(templateId);
    if (
      target.status !== 'READY' ||
      !template?.enabled ||
      !template.messages.every(isDeliveryMessage)
    )
      throw new TestSendError('TARGET_NOT_ELIGIBLE');
    const fingerprint = hash([
      target.request.expectedMetadataVersion,
      template.id,
      template.name,
      template.providerType,
      template.messages,
      template.enabled,
      template.updatedAt.getTime(),
    ]);
    return { target, template, fingerprint };
  }
  preview(
    accountId: string,
    contactId: string,
    templateId: string,
    adminId: string,
    key: string,
    now = new Date(),
  ): TestSendPreview {
    const digest = keyDigest('test-preview', adminId, key);
    return this.transaction((tx) => {
      const old = tx
        .select()
        .from(testSendIntents)
        .where(eq(testSendIntents.previewKeyDigest, digest))
        .get();
      if (old) {
        if (
          old.accountId !== accountId ||
          old.contactId !== contactId ||
          old.templateId !== templateId
        )
          throw new TestSendError('IDEMPOTENCY_CONFLICT');
        return JSON.parse(old.summary) as TestSendPreview;
      }
      const admin = tx.select().from(adminUsers).where(eq(adminUsers.id, adminId)).get();
      if (admin?.status !== 'ACTIVE') throw new TestSendError('TARGET_NOT_ELIGIBLE');
      const active = tx
        .select({ count: sql<number>`count(*)` })
        .from(testSendIntents)
        .where(
          and(
            eq(testSendIntents.adminId, adminId),
            gt(testSendIntents.expiresAt, now),
            isNull(testSendIntents.consumedRunId),
          ),
        )
        .get()!;
      if (active.count >= 20) throw new TestSendError('INTENT_LIMIT');
      const snapshot = this.snapshot(accountId, contactId, templateId);
      const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get()!;
      const contact = tx.select().from(contacts).where(eq(contacts.id, contactId)).get()!;
      if (contact.type !== 'PERSON' && contact.type !== 'GROUP')
        throw new TestSendError('TARGET_NOT_ELIGIBLE');
      const id = randomUUID(),
        expiresAt = new Date(now.getTime() + 600_000);
      const payloadDigest = hash([id, adminId, snapshot.fingerprint, expiresAt.getTime()]);
      const summary: TestSendPreview = {
        intentId: id,
        expiresAt: expiresAt.toISOString(),
        payloadDigest,
        account: { id: accountId, name: account.name },
        templateSummary: {
          id: templateId,
          name: snapshot.template.name,
          providerType: snapshot.template.providerType,
        },
        orderedTargets: [{ id: contactId, displayName: contact.displayName, type: contact.type }],
        warnings: ['SINGLE_TARGET_ONLY', 'NO_AUTOMATIC_RETRY', 'LIVE_SEND_GATE_CLOSED'],
      };
      tx.insert(testSendIntents)
        .values({
          id,
          accountId,
          adminId,
          contactId,
          templateId,
          previewKeyDigest: digest,
          fingerprint: snapshot.fingerprint,
          payloadDigest,
          summary: JSON.stringify(summary),
          createdAt: now,
          expiresAt,
        })
        .run();
      return summary;
    });
  }
  private intent(accountId: string, adminId: string, intentId: string, payloadDigest: string) {
    const intent = this.client.orm
      .select()
      .from(testSendIntents)
      .where(eq(testSendIntents.id, intentId))
      .get();
    if (!intent || intent.accountId !== accountId || intent.adminId !== adminId)
      throw new TestSendError('INTENT_NOT_FOUND');
    if (intent.payloadDigest !== payloadDigest) throw new TestSendError('INTENT_CHANGED');
    return intent;
  }
  replay(accountId: string, adminId: string, intentId: string, payloadDigest: string, key: string) {
    const digest = `test:v4:${keyDigest('test-execute', adminId, key)}`;
    const run = this.client.orm
      .select()
      .from(executionRuns)
      .where(eq(executionRuns.idempotencyKey, digest))
      .get();
    if (!run) return undefined;
    const intent = this.intent(accountId, adminId, intentId, payloadDigest);
    if (intent.consumedRunId !== run.id || run.accountId !== accountId || run.kind !== 'TEST_SEND')
      throw new TestSendError('IDEMPOTENCY_CONFLICT');
    return { runId: run.id, status: run.status };
  }
  confirmationTemplate(
    accountId: string,
    adminId: string,
    intentId: string,
    payloadDigest: string,
    now = new Date(),
  ) {
    const intent = this.intent(accountId, adminId, intentId, payloadDigest);
    this.assertIntent(intent, now);
    const snapshot = this.snapshot(accountId, intent.contactId, intent.templateId);
    if (snapshot.fingerprint !== intent.fingerprint) throw new TestSendError('INTENT_CHANGED');
    return snapshot.template;
  }
  private assertIntent(intent: typeof testSendIntents.$inferSelect, now: Date) {
    if (intent.consumedRunId !== null) throw new TestSendError('INTENT_CONSUMED');
    if (now.getTime() >= intent.expiresAt.getTime()) throw new TestSendError('INTENT_EXPIRED');
  }
  consume(
    accountId: string,
    adminId: string,
    intentId: string,
    payloadDigest: string,
    key: string,
    message: string,
    now = new Date(),
  ) {
    if (!isDeliveryMessage(message) || !message.trim()) throw new TestSendError('VALIDATION_ERROR');
    return this.transaction((tx) => {
      const replay = this.replay(accountId, adminId, intentId, payloadDigest, key);
      if (replay) return { ...replay, replay: true };
      const intent = this.intent(accountId, adminId, intentId, payloadDigest);
      this.assertIntent(intent, now);
      const admin = tx.select().from(adminUsers).where(eq(adminUsers.id, adminId)).get();
      if (admin?.status !== 'ACTIVE') throw new TestSendError('TARGET_NOT_ELIGIBLE');
      const current = this.snapshot(accountId, intent.contactId, intent.templateId);
      if (current.fingerprint !== intent.fingerprint) throw new TestSendError('INTENT_CHANGED');
      if (
        !current.template.messages
          .map(normalizeDeliveryText)
          .includes(normalizeDeliveryText(message))
      )
        throw new TestSendError('VALIDATION_ERROR');
      if (
        tx
          .select({ id: scheduledRunSnapshots.runId })
          .from(scheduledRunSnapshots)
          .where(eq(scheduledRunSnapshots.activeSlot, 1))
          .get() ||
        tx
          .select({ id: executionRuns.id })
          .from(executionRuns)
          .where(inArray(executionRuns.status, ['PENDING', 'RUNNING']))
          .get() ||
        tx
          .select({ id: dailyRuns.id })
          .from(dailyRuns)
          .where(eq(dailyRuns.status, 'RUNNING'))
          .get() ||
        tx
          .select({ id: accountLoginSessions.id })
          .from(accountLoginSessions)
          .where(inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]))
          .get() ||
        tx
          .select({ id: contactSyncRuns.id })
          .from(contactSyncRuns)
          .where(inArray(contactSyncRuns.status, ['PENDING', 'RUNNING']))
          .get()
      )
        throw new TestSendError('PROFILE_BUSY');
      const runId = randomUUID();
      tx.insert(executionRuns)
        .values({
          id: runId,
          kind: 'TEST_SEND',
          accountId,
          templateId: intent.templateId,
          requestedByAdminUserId: adminId,
          idempotencyKey: `test:v4:${keyDigest('test-execute', adminId, key)}`,
          status: 'PENDING',
          confirmedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const consumed = tx
        .update(testSendIntents)
        .set({ consumedRunId: runId, activeSlot: 1 })
        .where(and(eq(testSendIntents.id, intent.id), isNull(testSendIntents.consumedRunId)))
        .returning()
        .get();
      if (!consumed) throw new TestSendError('STATE_CONFLICT');
      tx.insert(targetSendRecords)
        .values({
          id: randomUUID(),
          runId,
          contactId: intent.contactId,
          templateId: intent.templateId,
          messageText: normalizeDeliveryText(message),
          targetIdentityKindSnapshot: current.target.request.preferredIdentity.kind,
          targetIdentityValueDigest: testSendIdentityDigest(
            current.target.request.preferredIdentity.kind,
            current.target.request.preferredIdentity.normalizedValue,
          ),
          createdAt: now,
          updatedAt: now,
        })
        .run();
      this.audit(tx, runId, adminId, 'CONFIRMED', now);
      return { runId, status: 'PENDING' as const, replay: false };
    });
  }
  execution(runId: string) {
    const intent = this.client.orm
      .select()
      .from(testSendIntents)
      .where(eq(testSendIntents.consumedRunId, runId))
      .get();
    const run = this.client.orm
      .select()
      .from(executionRuns)
      .where(eq(executionRuns.id, runId))
      .get();
    const rows = this.client.orm
      .select()
      .from(targetSendRecords)
      .where(eq(targetSendRecords.runId, runId))
      .limit(2)
      .all();
    if (
      !intent ||
      !run ||
      run.kind !== 'TEST_SEND' ||
      run.taskId !== null ||
      rows.length !== 1 ||
      rows[0]!.taskId !== null ||
      rows[0]!.contactId !== intent.contactId
    )
      throw new TestSendError('STATE_CONFLICT');
    return { intent, run, record: rows[0]! };
  }
  assertCurrent(runId: string) {
    const e = this.execution(runId);
    const current = this.snapshot(e.run.accountId, e.record.contactId, e.run.templateId);
    const identity = current.target.request.preferredIdentity;
    if (
      e.intent.fingerprint !== current.fingerprint ||
      e.record.targetIdentityKindSnapshot !== identity.kind ||
      e.record.targetIdentityValueDigest !==
        testSendIdentityDigest(identity.kind, identity.normalizedValue)
    )
      throw new TestSendError('INTENT_CHANGED');
    return e;
  }
  claim(runId: string, now = new Date()): boolean {
    return this.transaction((tx) => {
      const e = this.assertCurrent(runId);
      if (
        e.run.status !== 'PENDING' ||
        e.record.machineStatus !== 'READY' ||
        e.record.attemptCount !== 0 ||
        e.record.sendActionStartedAt !== null
      )
        return false;
      tx.update(executionRuns)
        .set({ status: 'RUNNING', startedAt: now, updatedAt: now })
        .where(eq(executionRuns.id, runId))
        .run();
      tx.update(targetSendRecords)
        .set({ machineStatus: 'RUNNING', attemptCount: 1, startedAt: now, updatedAt: now })
        .where(eq(targetSendRecords.id, e.record.id))
        .run();
      return true;
    });
  }
  boundary(runId: string, now = new Date()): void {
    this.transaction((tx) => {
      const e = this.assertCurrent(runId);
      if (e.run.status !== 'RUNNING' || e.intent.activeSlot !== 1)
        throw new TestSendError('STATE_CONFLICT');
      const row = tx
        .update(targetSendRecords)
        .set({ sendActionStartedAt: now, updatedAt: now })
        .where(
          and(
            eq(targetSendRecords.id, e.record.id),
            eq(targetSendRecords.machineStatus, 'RUNNING'),
            eq(targetSendRecords.attemptCount, 1),
            isNull(targetSendRecords.sendActionStartedAt),
          ),
        )
        .returning()
        .get();
      if (!row) throw new TestSendError('STATE_CONFLICT');
    });
  }
  finish(
    runId: string,
    outcome: 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN',
    failure: TargetSendFailureCode = 'CONFIG_INVALID',
    now = new Date(),
  ) {
    return this.transaction((tx) => {
      const e = this.execution(runId);
      if (!['PENDING', 'RUNNING'].includes(e.run.status)) return this.detail(runId)!;
      let status = outcome;
      if (e.record.sendActionStartedAt !== null && status === 'FAILED') status = 'DELIVERY_UNKNOWN';
      if (status === 'DELIVERY_UNKNOWN' && e.record.sendActionStartedAt === null) status = 'FAILED';
      if (status === 'SUCCESS') {
        if (e.record.machineStatus !== 'RUNNING' || e.record.sendActionStartedAt === null)
          throw new TestSendError('STATE_CONFLICT');
        try {
          this.assertCurrent(runId);
        } catch {
          status = 'DELIVERY_UNKNOWN';
        }
      }
      const code =
        status === 'SUCCESS'
          ? null
          : status === 'DELIVERY_UNKNOWN'
            ? ['DELIVERY_VERIFICATION_TIMEOUT', 'PROCESS_INTERRUPTED_AFTER_ACTION'].includes(
                failure,
              )
              ? failure
              : 'DELIVERY_EVIDENCE_INSUFFICIENT'
            : failure === 'PROCESS_INTERRUPTED_AFTER_ACTION'
              ? 'PROCESS_INTERRUPTED_BEFORE_SEND'
              : failure;
      tx.update(targetSendRecords)
        .set({
          machineStatus: status,
          failureCode: code,
          sentAt: status === 'SUCCESS' ? now : null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(targetSendRecords.id, e.record.id))
        .run();
      tx.update(executionRuns)
        .set({
          status: code === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : status,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(executionRuns.id, runId))
        .run();
      tx.update(testSendIntents)
        .set({ activeSlot: null })
        .where(eq(testSendIntents.id, e.intent.id))
        .run();
      this.audit(tx, runId, e.intent.adminId, `FINISHED_${status}`, now);
      return this.detail(runId)!;
    });
  }
  unfinished() {
    return this.client.orm
      .select({ runId: executionRuns.id, accountId: executionRuns.accountId })
      .from(executionRuns)
      .innerJoin(testSendIntents, eq(testSendIntents.consumedRunId, executionRuns.id))
      .where(inArray(executionRuns.status, ['PENDING', 'RUNNING']))
      .all();
  }
  detail(runId: string): TestSendDetail | undefined {
    const intent = this.client.orm
      .select()
      .from(testSendIntents)
      .where(eq(testSendIntents.consumedRunId, runId))
      .get();
    if (!intent) return undefined;
    const { run, record } = this.execution(runId);
    return {
      runId,
      kind: 'TEST_SEND',
      status: run.status,
      accountId: run.accountId,
      confirmedAt: run.confirmedAt!.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      record: {
        id: record.id,
        contactId: record.contactId,
        machineStatus: record.machineStatus,
        failureCode: record.failureCode,
        attemptCount: record.attemptCount,
        sendActionStartedAt: record.sendActionStartedAt?.toISOString() ?? null,
        sentAt: record.sentAt?.toISOString() ?? null,
      },
    };
  }
  private audit(tx: Tx, runId: string, admin: string, reasonCode: string, now: Date) {
    tx.insert(auditEvents)
      .values({
        id: randomUUID(),
        actorAdminUserId: admin,
        action: 'TEST_SEND_CONFIRMED',
        entityType: 'EXECUTION_RUN',
        entityId: runId,
        outcome: 'SUCCESS',
        reasonCode,
        createdAt: now,
      })
      .run();
  }
}
