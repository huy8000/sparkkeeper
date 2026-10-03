import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  validateSendTaskName,
  validateSendTaskScheduleWindow,
  validateSendTaskTimeZone,
  validateSendTaskMaxAttempts,
  validateSendTaskRetryIntervalSeconds,
  type TaskConfiguration,
  type TaskDetail,
  type AuditAction,
} from '@sparkkeeper/shared';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  sendTasks,
  sendTaskTargets,
  accounts,
  contacts,
  messageTemplates,
  executionRuns,
  scheduledRunSnapshots,
  auditEvents,
} from '../schema/index.js';
import { TestSendRepository, TestSendError } from './TestSendRepository.js';

export class TaskError extends Error {
  constructor(
    readonly code:
      | 'TASK_NOT_FOUND'
      | 'TASK_CONFLICT'
      | 'VALIDATION_ERROR'
      | 'TARGET_NOT_ELIGIBLE'
      | 'RELEASE_GATE_CLOSED'
      | 'PROFILE_BUSY',
  ) {
    super(code);
  }
}
export class TaskConfigurationRepository {
  constructor(readonly client: DatabaseClient) {}
  transaction<T>(fn: () => Extract<T, PromiseLike<unknown>> extends never ? T : never): T {
    return this.client.withBusyTimeout(0, () =>
      this.client.orm.transaction(
        () => {
          const value = fn();
          if (value && typeof value === 'object' && 'then' in value)
            throw new Error('ASYNC_TRANSACTION_FORBIDDEN');
          return value;
        },
        { behavior: 'immediate' },
      ),
    );
  }
  row(id: string) {
    const task = this.client.orm.select().from(sendTasks).where(eq(sendTasks.id, id)).get();
    if (!task) throw new TaskError('TASK_NOT_FOUND');
    return task;
  }
  configuration(id: string): TaskConfiguration {
    const task = this.row(id);
    return {
      name: task.name,
      accountId: task.accountId,
      templateId: task.templateId,
      schedule: {
        type: task.scheduleType,
        startTime: task.startTime,
        endTime: task.endTime,
        timezone: task.timezone,
        maxAttempts: task.maxAttempts,
        retryIntervalSeconds: task.retryIntervalSeconds,
      },
      contactIds: this.client.orm
        .select({ id: sendTaskTargets.contactId })
        .from(sendTaskTargets)
        .where(eq(sendTaskTargets.taskId, id))
        .orderBy(asc(sendTaskTargets.contactId))
        .all()
        .map((r) => r.id),
    };
  }
  private validate(input: TaskConfiguration): TaskConfiguration {
    try {
      if (
        input.schedule.type !== 'DAILY_WINDOW' ||
        input.contactIds.length < 1 ||
        input.contactIds.length > 100 ||
        new Set(input.contactIds).size !== input.contactIds.length
      )
        throw new Error('INVALID');
      const window = validateSendTaskScheduleWindow(
        input.schedule.startTime,
        input.schedule.endTime,
      );
      input = {
        ...input,
        name: validateSendTaskName(input.name),
        contactIds: [...input.contactIds].sort(),
        schedule: {
          type: 'DAILY_WINDOW',
          ...window,
          timezone: validateSendTaskTimeZone(input.schedule.timezone),
          maxAttempts: validateSendTaskMaxAttempts(input.schedule.maxAttempts),
          retryIntervalSeconds: validateSendTaskRetryIntervalSeconds(
            input.schedule.retryIntervalSeconds,
          ),
        },
      };
    } catch {
      throw new TaskError('VALIDATION_ERROR');
    }
    const account = this.client.orm
      .select()
      .from(accounts)
      .where(eq(accounts.id, input.accountId))
      .get();
    const template = this.client.orm
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.id, input.templateId))
      .get();
    const rows = this.client.orm
      .select()
      .from(contacts)
      .where(inArray(contacts.id, input.contactIds))
      .all();
    if (
      !account ||
      account.lifecycleStatus !== 'ACTIVE' ||
      !template ||
      rows.length !== input.contactIds.length ||
      rows.some((c) => c.accountId !== input.accountId || !['PERSON', 'GROUP'].includes(c.type))
    )
      throw new TaskError('TARGET_NOT_ELIGIBLE');
    return input;
  }
  eligibility(id: string) {
    const cfg = this.configuration(id);
    if (cfg.contactIds.length < 1 || cfg.contactIds.length > 100)
      throw new TestSendError('TARGET_NOT_ELIGIBLE');
    const reader = new TestSendRepository(this.client);
    return cfg.contactIds.map((contactId) =>
      reader.snapshot(cfg.accountId, contactId, cfg.templateId),
    );
  }
  active(id: string) {
    return (
      !!this.client.orm
        .select({ id: scheduledRunSnapshots.runId })
        .from(scheduledRunSnapshots)
        .where(and(eq(scheduledRunSnapshots.taskId, id), eq(scheduledRunSnapshots.activeSlot, 1)))
        .get() ||
      !!this.client.orm
        .select({ id: executionRuns.id })
        .from(executionRuns)
        .where(
          and(eq(executionRuns.taskId, id), inArray(executionRuns.status, ['PENDING', 'RUNNING'])),
        )
        .get()
    );
  }
  detail(id: string, released = false): TaskDetail {
    const row = this.row(id),
      cfg = this.configuration(id);
    let eligible = released;
    if (eligible) {
      try {
        this.eligibility(id);
      } catch (e) {
        if (!(e instanceof TestSendError)) throw e;
        eligible = false;
      }
    }
    const overlaps = cfg.contactIds.length
      ? this.client.orm
          .selectDistinct({ id: sendTasks.id })
          .from(sendTasks)
          .innerJoin(sendTaskTargets, eq(sendTaskTargets.taskId, sendTasks.id))
          .where(
            and(
              eq(sendTasks.enabled, true),
              eq(sendTasks.accountId, cfg.accountId),
              ne(sendTasks.id, id),
              inArray(sendTaskTargets.contactId, cfg.contactIds),
            ),
          )
          .orderBy(asc(sendTasks.id))
          .all()
          .map((r) => r.id)
      : [];
    const latest = this.client.orm
      .select({
        id: executionRuns.id,
        status: executionRuns.status,
        businessDate: executionRuns.businessDate,
      })
      .from(executionRuns)
      .innerJoin(scheduledRunSnapshots, eq(scheduledRunSnapshots.runId, executionRuns.id))
      .where(eq(executionRuns.taskId, id))
      .orderBy(desc(executionRuns.createdAt), desc(executionRuns.id))
      .get();
    return {
      ...cfg,
      id,
      enabled: row.enabled,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      state: row.archivedAt
        ? 'ARCHIVED'
        : !row.enabled
          ? 'DISABLED'
          : eligible
            ? 'ENABLED'
            : 'BLOCKED',
      overlaps,
      latestRun: latest ? { ...latest, businessDate: latest.businessDate! } : null,
    };
  }
  list(
    options: { accountId?: string; enabled?: boolean; offset?: number; limit?: number } = {},
    released = false,
  ) {
    return this.client.orm
      .select({ id: sendTasks.id })
      .from(sendTasks)
      .where(
        and(
          ...[
            ...(options.accountId ? [eq(sendTasks.accountId, options.accountId)] : []),
            ...(options.enabled === undefined ? [] : [eq(sendTasks.enabled, options.enabled)]),
          ],
        ),
      )
      .orderBy(asc(sendTasks.createdAt), asc(sendTasks.id))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0)
      .all()
      .map((r) => this.detail(r.id, released));
  }
  audit(
    action: AuditAction,
    entity: 'SEND_TASK' | 'EXECUTION_RUN' | 'TARGET_SEND_RECORD',
    id: string,
    actor: string | null,
    reason: string,
    now: Date,
  ) {
    this.client.orm
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        action,
        entityType: entity,
        entityId: id,
        actorAdminUserId: actor,
        outcome: 'SUCCESS',
        reasonCode: reason,
        createdAt: now,
      })
      .run();
  }
  create(input: TaskConfiguration, actor: string, now = new Date()) {
    return this.transaction(() => {
      const cfg = this.validate(input),
        id = randomUUID();
      this.client.orm
        .insert(sendTasks)
        .values({
          id,
          name: cfg.name,
          accountId: cfg.accountId,
          templateId: cfg.templateId,
          ...this.scheduleValues(cfg),
          enabled: false,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      this.targets(id, cfg.contactIds, now);
      this.audit('TASK_CREATED', 'SEND_TASK', id, actor, 'DISABLED', now);
      return this.detail(id);
    });
  }
  private scheduleValues(cfg: TaskConfiguration) {
    const { type, ...rest } = cfg.schedule;
    return { ...rest, scheduleType: type };
  }
  private targets(id: string, ids: string[], now: Date) {
    this.client.orm.delete(sendTaskTargets).where(eq(sendTaskTargets.taskId, id)).run();
    this.client.orm
      .insert(sendTaskTargets)
      .values(ids.map((contactId) => ({ taskId: id, contactId, createdAt: now })))
      .run();
  }
  mutate(
    id: string,
    expected: string,
    actor: string,
    operation: 'patch' | 'enable' | 'disable' | 'archive',
    input?: TaskConfiguration,
    released = false,
    now = new Date(),
  ) {
    return this.transaction(() => {
      const row = this.row(id);
      if (
        row.updatedAt.toISOString() !== expected ||
        row.archivedAt ||
        (operation !== 'disable' && this.active(id)) ||
        ((operation === 'patch' || operation === 'archive') && row.enabled)
      )
        throw new TaskError('TASK_CONFLICT');
      const stamp = new Date(Math.max(now.getTime(), row.updatedAt.getTime() + 1));
      if (operation === 'patch') {
        const cfg = this.validate(input!);
        this.client.orm
          .update(sendTasks)
          .set({
            name: cfg.name,
            accountId: cfg.accountId,
            templateId: cfg.templateId,
            ...this.scheduleValues(cfg),
            updatedAt: stamp,
          })
          .where(eq(sendTasks.id, id))
          .run();
        this.targets(id, cfg.contactIds, stamp);
      } else {
        if (operation === 'enable') {
          if (!released) throw new TaskError('RELEASE_GATE_CLOSED');
          this.eligibility(id);
        }
        this.client.orm
          .update(sendTasks)
          .set({
            enabled: operation === 'enable',
            ...(operation === 'archive' ? { archivedAt: stamp } : {}),
            updatedAt: stamp,
          })
          .where(eq(sendTasks.id, id))
          .run();
      }
      this.audit(
        operation === 'patch'
          ? 'TASK_UPDATED'
          : operation === 'enable'
            ? 'TASK_ENABLED'
            : operation === 'disable'
              ? 'TASK_DISABLED'
              : 'TASK_ARCHIVED',
        'SEND_TASK',
        id,
        actor,
        operation.toUpperCase(),
        stamp,
      );
      return this.detail(id, released);
    });
  }
}
