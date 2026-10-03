import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, isNotNull, or } from 'drizzle-orm';
import {
  taskWindow,
  normalizeDeliveryText,
  type TaskConfiguration,
  type ScheduledRunDetail,
  type TargetSendFailureCode,
} from '@sparkkeeper/shared';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  scheduledRunSnapshots,
  executionRuns,
  targetSendRecords,
  accountLoginSessions,
  contactSyncRuns,
  dailyRuns,
  accounts,
} from '../schema/index.js';
import { TaskConfigurationRepository, TaskError } from './TaskConfigurationRepository.js';
import { TestSendRepository, testSendIdentityDigest } from './TestSendRepository.js';
import { ACTIVE_LOGIN_SESSION_STATUSES } from './AccountLoginSessionRepository.js';

export interface ScheduledSnapshot {
  configuration: TaskConfiguration;
  version: string;
  targets: {
    contactId: string;
    fingerprint: string;
    kind: ReturnType<
      TestSendRepository['snapshot']
    >['target']['request']['preferredIdentity']['kind'];
    digest: string;
  }[];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export class ScheduledSendRepository {
  readonly tasks: TaskConfigurationRepository;
  private readonly reader: TestSendRepository;
  private token: string | undefined;
  constructor(
    private readonly client: DatabaseClient,
    private readonly clock = () => new Date(),
  ) {
    this.tasks = new TaskConfigurationRepository(client);
    this.reader = new TestSendRepository(client);
  }
  canonical(taskId: string, date: string) {
    const row = this.client.orm
      .select()
      .from(executionRuns)
      .where(eq(executionRuns.idempotencyKey, `scheduled:${taskId}:${date}`))
      .get();
    if (row) this.run(row.id);
    return row;
  }
  acquireRun(runId: string, token: string) {
    const owned = !!this.client.orm
      .update(scheduledRunSnapshots)
      .set({ ownerToken: token })
      .where(
        and(
          eq(scheduledRunSnapshots.runId, runId),
          eq(scheduledRunSnapshots.activeSlot, 1),
          isNull(scheduledRunSnapshots.ownerToken),
        ),
      )
      .returning()
      .get();
    if (owned) this.token = token;
    return owned;
  }
  releaseRun(runId: string, token: string) {
    this.tasks.transaction(() => {
      const e = this.run(runId);
      const row = this.client.orm
        .update(scheduledRunSnapshots)
        .set({
          ownerToken: null,
          ...(!['PENDING', 'RUNNING'].includes(e.run.status) ? { activeSlot: null } : {}),
        })
        .where(
          and(eq(scheduledRunSnapshots.runId, runId), eq(scheduledRunSnapshots.ownerToken, token)),
        )
        .returning()
        .get();
      if (!row) throw new TaskError('TASK_CONFLICT');
    });
  }
  recoveredRun(runId: string) {
    const e = this.run(runId);
    this.client.orm
      .update(scheduledRunSnapshots)
      .set({
        ownerToken: null,
        ...(!['PENDING', 'RUNNING'].includes(e.run.status) ? { activeSlot: null } : {}),
      })
      .where(eq(scheduledRunSnapshots.runId, runId))
      .run();
  }
  prepare(taskId: string): ScheduledSnapshot {
    const task = this.tasks.row(taskId),
      configuration = this.tasks.configuration(taskId);
    if (
      !task.enabled ||
      task.archivedAt ||
      configuration.contactIds.length < 1 ||
      configuration.contactIds.length > 100
    )
      throw new TaskError('TASK_CONFLICT');
    return {
      configuration,
      version: task.updatedAt.toISOString(),
      targets: configuration.contactIds.map((contactId) => {
        const current = this.reader.snapshot(task.accountId, contactId, task.templateId),
          identity = current.target.request.preferredIdentity;
        return {
          contactId,
          fingerprint: current.fingerprint,
          kind: identity.kind,
          digest: testSendIdentityDigest(identity.kind, identity.normalizedValue),
        };
      }),
    };
  }
  publish(taskId: string, prepared: ScheduledSnapshot, messages: string[], now = this.clock()) {
    return this.tasks.transaction(() => {
      const window = taskWindow(now, prepared.configuration.schedule),
        key = `scheduled:${taskId}:${window.businessDate}`;
      const old = this.client.orm
        .select()
        .from(executionRuns)
        .where(eq(executionRuns.idempotencyKey, key))
        .get();
      if (old) {
        this.run(old.id);
        return old;
      }
      if (
        !window.open ||
        !same(this.prepare(taskId), prepared) ||
        messages.length !== prepared.targets.length
      )
        throw new TaskError('TASK_CONFLICT');
      if (
        this.client.orm
          .select({ id: scheduledRunSnapshots.runId })
          .from(scheduledRunSnapshots)
          .where(eq(scheduledRunSnapshots.activeSlot, 1))
          .get() ||
        this.client.orm
          .select({ id: executionRuns.id })
          .from(executionRuns)
          .where(inArray(executionRuns.status, ['PENDING', 'RUNNING']))
          .get() ||
        this.client.orm
          .select({ id: accountLoginSessions.id })
          .from(accountLoginSessions)
          .where(inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]))
          .get() ||
        this.client.orm
          .select({ id: contactSyncRuns.id })
          .from(contactSyncRuns)
          .where(inArray(contactSyncRuns.status, ['PENDING', 'RUNNING']))
          .get() ||
        this.client.orm
          .select({ id: dailyRuns.id })
          .from(dailyRuns)
          .where(eq(dailyRuns.status, 'RUNNING'))
          .get()
      )
        throw new TaskError('PROFILE_BUSY');
      const runId = randomUUID(),
        cfg = prepared.configuration;
      const run = this.client.orm
        .insert(executionRuns)
        .values({
          id: runId,
          kind: 'SCHEDULED_TASK',
          accountId: cfg.accountId,
          taskId,
          templateId: cfg.templateId,
          businessDate: window.businessDate,
          idempotencyKey: key,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get()!;
      this.client.orm
        .insert(scheduledRunSnapshots)
        .values({
          runId,
          taskId,
          businessDate: window.businessDate,
          snapshot: JSON.stringify(prepared),
          activeSlot: 1,
        })
        .run();
      for (const [index, target] of prepared.targets.entries()) {
        const message = messages[index]!,
          current = this.reader.snapshot(cfg.accountId, target.contactId, cfg.templateId);
        if (
          !current.template.messages
            .map(normalizeDeliveryText)
            .includes(normalizeDeliveryText(message)) ||
          !message.trim()
        )
          throw new TaskError('VALIDATION_ERROR');
        this.client.orm
          .insert(targetSendRecords)
          .values({
            id: randomUUID(),
            runId,
            taskId,
            businessDate: window.businessDate,
            contactId: target.contactId,
            templateId: cfg.templateId,
            messageText: normalizeDeliveryText(message),
            targetIdentityKindSnapshot: target.kind,
            targetIdentityValueDigest: target.digest,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      this.tasks.audit('TASK_UPDATED', 'EXECUTION_RUN', runId, null, 'SCHEDULED_MATERIALIZED', now);
      return run;
    });
  }
  run(id: string) {
    const run = this.client.orm.select().from(executionRuns).where(eq(executionRuns.id, id)).get();
    const stored = this.client.orm
      .select()
      .from(scheduledRunSnapshots)
      .where(eq(scheduledRunSnapshots.runId, id))
      .get();
    if (
      !run ||
      !stored ||
      run.kind !== 'SCHEDULED_TASK' ||
      run.taskId !== stored.taskId ||
      run.businessDate !== stored.businessDate
    )
      throw new TaskError('TASK_CONFLICT');
    const snapshot = JSON.parse(stored.snapshot) as ScheduledSnapshot;
    const records = this.client.orm
      .select()
      .from(targetSendRecords)
      .where(eq(targetSendRecords.runId, id))
      .orderBy(asc(targetSendRecords.contactId))
      .all();
    if (
      snapshot.configuration.accountId !== run.accountId ||
      snapshot.configuration.templateId !== run.templateId ||
      !same(
        snapshot.configuration.contactIds,
        [...snapshot.targets.map((t) => t.contactId)].sort(),
      ) ||
      snapshot.targets.length !== records.length ||
      records.some(
        (r) =>
          r.taskId !== run.taskId ||
          r.businessDate !== run.businessDate ||
          r.templateId !== run.templateId ||
          !snapshot.targets.some(
            (t) =>
              t.contactId === r.contactId &&
              t.kind === r.targetIdentityKindSnapshot &&
              t.digest === r.targetIdentityValueDigest,
          ),
      )
    )
      throw new TaskError('TASK_CONFLICT');
    return { run, stored, snapshot, records };
  }
  execution(recordId: string) {
    const record = this.client.orm
      .select()
      .from(targetSendRecords)
      .where(eq(targetSendRecords.id, recordId))
      .get();
    if (!record) throw new TaskError('TASK_CONFLICT');
    const e = this.run(record.runId);
    return { ...e, record };
  }
  assertCurrent(recordId: string) {
    const e = this.execution(recordId),
      cfg = e.snapshot.configuration;
    if (!same(this.tasks.configuration(e.run.taskId!), cfg)) throw new TaskError('TASK_CONFLICT');
    const current = this.reader.snapshot(e.run.accountId, e.record.contactId, e.run.templateId),
      target = e.snapshot.targets.find((t) => t.contactId === e.record.contactId)!;
    if (current.fingerprint !== target.fingerprint) throw new TaskError('TASK_CONFLICT');
    return e;
  }
  private open(e: ReturnType<ScheduledSendRepository['execution']>, now: Date) {
    const window = taskWindow(now, e.snapshot.configuration.schedule),
      task = this.tasks.row(e.run.taskId!);
    return (
      task.enabled && !task.archivedAt && window.open && window.businessDate === e.run.businessDate
    );
  }
  claim(recordId: string, now = this.clock()): boolean {
    return this.tasks.transaction(() => {
      const e = this.execution(recordId),
        r = e.record;
      if (
        !this.token ||
        e.stored.ownerToken !== this.token ||
        e.stored.activeSlot !== 1 ||
        !['PENDING', 'RUNNING'].includes(e.run.status) ||
        !['READY', 'RETRY_WAIT'].includes(r.machineStatus) ||
        r.sendActionStartedAt ||
        r.attemptCount >= e.snapshot.configuration.schedule.maxAttempts ||
        (r.nextRetryAt && r.nextRetryAt > now) ||
        !this.open(e, now)
      )
        return false;
      if (
        this.client.orm
          .select({ id: targetSendRecords.id })
          .from(targetSendRecords)
          .where(
            and(
              eq(targetSendRecords.runId, e.run.id),
              eq(targetSendRecords.machineStatus, 'RUNNING'),
            ),
          )
          .get()
      )
        return false;
      this.assertCurrent(recordId);
      const row = this.client.orm
        .update(targetSendRecords)
        .set({
          machineStatus: 'RUNNING',
          attemptCount: r.attemptCount + 1,
          nextRetryAt: null,
          failureCode: null,
          startedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(targetSendRecords.id, recordId),
            eq(targetSendRecords.machineStatus, r.machineStatus),
            isNull(targetSendRecords.sendActionStartedAt),
          ),
        )
        .returning()
        .get();
      if (!row) return false;
      this.client.orm
        .update(executionRuns)
        .set({ status: 'RUNNING', startedAt: e.run.startedAt ?? now, updatedAt: now })
        .where(eq(executionRuns.id, e.run.id))
        .run();
      this.tasks.audit(
        'TASK_UPDATED',
        'TARGET_SEND_RECORD',
        recordId,
        null,
        'SCHEDULED_CLAIMED',
        now,
      );
      return true;
    });
  }
  boundary(recordId: string, now = this.clock()) {
    this.tasks.transaction(() => {
      const e = this.assertCurrent(recordId);
      if (
        !this.token ||
        e.stored.ownerToken !== this.token ||
        !this.open(e, now) ||
        e.stored.activeSlot !== 1 ||
        e.run.status !== 'RUNNING'
      )
        throw new TaskError('TASK_CONFLICT');
      const row = this.client.orm
        .update(targetSendRecords)
        .set({ sendActionStartedAt: now, updatedAt: now })
        .where(
          and(
            eq(targetSendRecords.id, recordId),
            eq(targetSendRecords.machineStatus, 'RUNNING'),
            isNull(targetSendRecords.sendActionStartedAt),
          ),
        )
        .returning()
        .get();
      if (!row) throw new TaskError('TASK_CONFLICT');
    });
  }
  finish(
    recordId: string,
    outcome: 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN',
    failure: TargetSendFailureCode = 'CONFIG_INVALID',
    now = this.clock(),
  ) {
    return this.tasks.transaction(() => {
      const e = this.execution(recordId),
        r = e.record;
      if (['SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN', 'SKIPPED'].includes(r.machineStatus))
        return this.detail(e.run.id);
      let status = outcome;
      if (r.sendActionStartedAt && status === 'FAILED') status = 'DELIVERY_UNKNOWN';
      if (!r.sendActionStartedAt && status === 'DELIVERY_UNKNOWN') status = 'FAILED';
      if (status === 'SUCCESS') {
        if (!r.sendActionStartedAt || r.machineStatus !== 'RUNNING')
          throw new TaskError('TASK_CONFLICT');
        try {
          this.assertCurrent(recordId);
        } catch {
          status = 'DELIVERY_UNKNOWN';
        }
      }
      const code =
        status === 'SUCCESS'
          ? null
          : status === 'DELIVERY_UNKNOWN'
            ? failure === 'AUTH_EXPIRED'
              ? 'AUTH_STATE_CHANGED_AFTER_ACTION'
              : failure === 'PROCESS_INTERRUPTED_AFTER_ACTION' ||
                  failure === 'DELIVERY_VERIFICATION_TIMEOUT'
                ? failure
                : 'DELIVERY_EVIDENCE_INSUFFICIENT'
            : failure;
      if (failure === 'AUTH_EXPIRED')
        this.client.orm
          .update(accounts)
          .set({ loginStatus: 'AUTH_EXPIRED', lastAuthCheckAt: now, updatedAt: now })
          .where(and(eq(accounts.id, e.run.accountId), eq(accounts.lifecycleStatus, 'ACTIVE')))
          .run();
      this.client.orm
        .update(targetSendRecords)
        .set({
          machineStatus: status,
          failureCode: code,
          nextRetryAt: null,
          sentAt: status === 'SUCCESS' ? now : null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(targetSendRecords.id, recordId))
        .run();
      this.tasks.audit(
        'TASK_UPDATED',
        'TARGET_SEND_RECORD',
        recordId,
        null,
        `SCHEDULED_${status}`,
        now,
      );
      if (
        status === 'DELIVERY_UNKNOWN' ||
        [
          'AUTH_EXPIRED',
          'AUTH_UNKNOWN',
          'CAPTCHA_OR_RISK_CONTROL',
          'BROWSER_FAILURE',
          'PROFILE_UNAVAILABLE',
        ].includes(code ?? '')
      )
        this.skipRemaining(e.run.id, now, 'BATCH_ABORTED');
      this.aggregate(e.run.id, now);
      return this.detail(e.run.id);
    });
  }
  private skipRemaining(runId: string, now: Date, code: TargetSendFailureCode) {
    this.client.orm
      .update(targetSendRecords)
      .set({
        machineStatus: 'SKIPPED',
        failureCode: code,
        nextRetryAt: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(targetSendRecords.runId, runId),
          inArray(targetSendRecords.machineStatus, ['READY', 'RETRY_WAIT']),
          isNull(targetSendRecords.sendActionStartedAt),
        ),
      )
      .run();
  }
  private aggregate(runId: string, now: Date) {
    const e = this.run(runId),
      rows = e.records;
    if (!['PENDING', 'RUNNING'].includes(e.run.status)) return;
    if (rows.some((r) => ['READY', 'RUNNING', 'RETRY_WAIT'].includes(r.machineStatus))) return;
    const status = rows.some(
      (r) =>
        r.failureCode === 'AUTH_EXPIRED' || r.failureCode === 'AUTH_STATE_CHANGED_AFTER_ACTION',
    )
      ? 'AUTH_EXPIRED'
      : rows.some((r) => r.machineStatus === 'DELIVERY_UNKNOWN')
        ? 'DELIVERY_UNKNOWN'
        : rows.every((r) => r.machineStatus === 'SUCCESS')
          ? 'SUCCESS'
          : rows.some((r) => r.machineStatus === 'SUCCESS')
            ? 'PARTIAL_FAILED'
            : 'FAILED';
    this.client.orm
      .update(executionRuns)
      .set({ status, finishedAt: now, updatedAt: now })
      .where(eq(executionRuns.id, runId))
      .run();
    // Machine terminal truth is not resource cleanup proof. Keep the DB global slot
    // until releaseRun/recoveredRun after the trusted factory has stopped every resource.
    this.tasks.audit('TASK_UPDATED', 'EXECUTION_RUN', runId, null, `SCHEDULED_${status}`, now);
  }
  expireOrDisabled(runId: string, now = this.clock()) {
    this.tasks.transaction(() => {
      const e = this.run(runId);
      if (!['PENDING', 'RUNNING'].includes(e.run.status)) return;
      const first = e.records[0]!;
      if (!this.open({ ...e, record: first }, now)) {
        this.skipRemaining(runId, now, 'RETRY_WINDOW_EXPIRED');
        this.aggregate(runId, now);
      }
    });
  }
  abort(runId: string, now = this.clock()) {
    this.tasks.transaction(() => {
      this.skipRemaining(runId, now, 'BATCH_ABORTED');
      this.aggregate(runId, now);
    });
  }
  /** Only after proven runtime cleanup; persisted null boundary is the no-action recovery proof. */
  reconcile(runId: string, now = this.clock()) {
    this.tasks.transaction(() => {
      const e = this.run(runId);
      if (!['PENDING', 'RUNNING'].includes(e.run.status)) return;
      for (const r of e.records)
        if (r.machineStatus === 'RUNNING') {
          if (r.sendActionStartedAt) {
            this.finish(r.id, 'DELIVERY_UNKNOWN', 'PROCESS_INTERRUPTED_AFTER_ACTION', now);
            continue;
          }
          const next = new Date(
            now.getTime() + e.snapshot.configuration.schedule.retryIntervalSeconds * 1000,
          );
          const window = taskWindow(next, e.snapshot.configuration.schedule);
          if (
            r.attemptCount < e.snapshot.configuration.schedule.maxAttempts &&
            this.open({ ...e, record: r }, now) &&
            window.open &&
            window.businessDate === e.run.businessDate
          ) {
            this.client.orm
              .update(targetSendRecords)
              .set({
                machineStatus: 'RETRY_WAIT',
                failureCode: 'PROCESS_INTERRUPTED_BEFORE_SEND',
                nextRetryAt: next,
                updatedAt: now,
              })
              .where(eq(targetSendRecords.id, r.id))
              .run();
            this.tasks.audit(
              'TASK_UPDATED',
              'TARGET_SEND_RECORD',
              r.id,
              null,
              'SCHEDULED_RECOVERY_RETRY',
              now,
            );
          } else this.finish(r.id, 'FAILED', 'PROCESS_INTERRUPTED_BEFORE_SEND', now);
        }
      this.expireOrDisabled(runId, now);
    });
  }
  unfinished() {
    return this.client.orm
      .select({ runId: executionRuns.id, accountId: executionRuns.accountId })
      .from(executionRuns)
      .innerJoin(scheduledRunSnapshots, eq(scheduledRunSnapshots.runId, executionRuns.id))
      .where(
        or(
          inArray(executionRuns.status, ['PENDING', 'RUNNING']),
          eq(scheduledRunSnapshots.activeSlot, 1),
          isNotNull(scheduledRunSnapshots.ownerToken),
        ),
      )
      .all();
  }
  detail(runId: string): ScheduledRunDetail {
    const e = this.run(runId);
    return {
      runId,
      kind: 'SCHEDULED_TASK',
      accountId: e.run.accountId,
      taskId: e.run.taskId!,
      businessDate: e.run.businessDate!,
      status: e.run.status,
      finishedAt: e.run.finishedAt?.toISOString() ?? null,
      records: e.records.map((r) => ({
        id: r.id,
        contactId: r.contactId,
        machineStatus: r.machineStatus,
        attemptCount: r.attemptCount,
        failureCode: r.failureCode,
        nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
        sendActionStartedAt: r.sendActionStartedAt?.toISOString() ?? null,
      })),
    };
  }
}
