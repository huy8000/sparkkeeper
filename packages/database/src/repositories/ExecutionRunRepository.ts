import { randomUUID } from 'node:crypto';

import {
  isExecutionRunKind,
  normalizeOptionalIdentifier,
  parseBusinessDate,
  validateIdempotencyKey,
  type BusinessDate,
  type ExecutionRunKind,
  type ExecutionRunStatus,
} from '@sparkkeeper/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import { executionRuns, type ExecutionRunRow, type NewExecutionRunRow } from '../schema/index.js';

export type ExecutionRun = ExecutionRunRow;

export const TERMINAL_EXECUTION_RUN_STATUSES: readonly ExecutionRunStatus[] = [
  'SUCCESS',
  'PARTIAL_FAILED',
  'FAILED',
  'DELIVERY_UNKNOWN',
  'AUTH_EXPIRED',
  'CANCELLED',
] as const;

export interface CreateExecutionRunInput {
  readonly kind: ExecutionRunKind;
  readonly accountId: string;
  readonly taskId?: string | null;
  readonly templateId: string;
  readonly requestedByAdminUserId?: string | null;
  readonly businessDate?: BusinessDate | string | null;
  readonly idempotencyKey: string;
  readonly confirmedAt?: Date | null;
  readonly now?: Date;
}

export class ExecutionRunRepositoryError extends RepositoryError {
  readonly executionOperation:
    | 'create'
    | 'findById'
    | 'findByIdempotencyKey'
    | 'findByTaskAndBusinessDate'
    | 'transition'
    | 'listByAccountId';

  constructor(
    operation: ExecutionRunRepositoryError['executionOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'ExecutionRun', operation, cause });
    this.name = 'ExecutionRunRepositoryError';
    this.executionOperation = operation;
  }
}

export class ExecutionRunRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateExecutionRunInput): ExecutionRun {
    if (!isExecutionRunKind(input.kind)) {
      throw new ExecutionRunRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid execution run kind.',
      );
    }

    const accountId = input.accountId.trim();
    const templateId = input.templateId.trim();
    if (accountId.length === 0) {
      throw new ExecutionRunRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    if (templateId.length === 0) {
      throw new ExecutionRunRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'templateId must not be empty.',
      );
    }

    let idempotencyKey: string;
    try {
      idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    } catch (error) {
      throw new ExecutionRunRepositoryError(
        'create',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid idempotency key.',
        error,
      );
    }

    const taskId = normalizeOptionalIdentifier(input.taskId);
    const requestedByAdminUserId = normalizeOptionalIdentifier(input.requestedByAdminUserId);
    let businessDateStr: string | null = null;
    if (input.businessDate !== undefined && input.businessDate !== null) {
      businessDateStr = parseBusinessDate(input.businessDate);
    }

    if (input.kind === 'SCHEDULED_TASK') {
      if (taskId === null) {
        throw new ExecutionRunRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'SCHEDULED_TASK execution run requires taskId.',
        );
      }
      if (businessDateStr === null) {
        throw new ExecutionRunRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'SCHEDULED_TASK execution run requires businessDate.',
        );
      }
      if (requestedByAdminUserId !== null) {
        throw new ExecutionRunRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'SCHEDULED_TASK must not specify requestedByAdminUserId.',
        );
      }
      if (input.confirmedAt !== undefined && input.confirmedAt !== null) {
        throw new ExecutionRunRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'SCHEDULED_TASK must not specify confirmedAt.',
        );
      }
    } else if (input.kind === 'TEST_SEND') {
      if (taskId !== null) {
        throw new ExecutionRunRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'TEST_SEND execution run must not specify taskId.',
        );
      }
      if (requestedByAdminUserId === null) {
        throw new ExecutionRunRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'TEST_SEND execution run requires requestedByAdminUserId.',
        );
      }
      if (!input.confirmedAt) {
        throw new ExecutionRunRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'TEST_SEND execution run requires confirmedAt timestamp.',
        );
      }
    }

    const now = input.now ?? new Date();
    const values: NewExecutionRunRow = {
      id: randomUUID(),
      kind: input.kind,
      accountId,
      taskId,
      templateId,
      requestedByAdminUserId,
      businessDate: businessDateStr,
      idempotencyKey,
      status: 'PENDING',
      confirmedAt: input.confirmedAt ?? null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      return this.client.orm.insert(executionRuns).values(values).returning().get();
    } catch (error) {
      if (error instanceof ExecutionRunRepositoryError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new ExecutionRunRepositoryError(
          'create',
          'IDEMPOTENCY_CONFLICT',
          `Duplicate execution run conflict on idempotency key '${idempotencyKey}' or task schedule tuple.`,
          error,
        );
      }
      throw new ExecutionRunRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create execution run.',
        error,
      );
    }
  }

  findById(id: string): ExecutionRun | undefined {
    try {
      return this.client.orm.select().from(executionRuns).where(eq(executionRuns.id, id)).get();
    } catch (error) {
      throw new ExecutionRunRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find execution run by id.',
        error,
      );
    }
  }

  findByIdempotencyKey(idempotencyKey: string): ExecutionRun | undefined {
    const trimmed = idempotencyKey.trim();
    if (trimmed.length === 0) {
      throw new ExecutionRunRepositoryError(
        'findByIdempotencyKey',
        'VALIDATION_ERROR',
        'idempotencyKey must not be empty.',
      );
    }

    try {
      return this.client.orm
        .select()
        .from(executionRuns)
        .where(eq(executionRuns.idempotencyKey, trimmed))
        .get();
    } catch (error) {
      throw new ExecutionRunRepositoryError(
        'findByIdempotencyKey',
        'INTEGRITY_ERROR',
        'Failed to find execution run by idempotency key.',
        error,
      );
    }
  }

  findByTaskAndBusinessDate(
    taskId: string,
    businessDate: BusinessDate | string,
  ): ExecutionRun | undefined {
    const trimmedTask = taskId.trim();
    if (trimmedTask.length === 0) {
      throw new ExecutionRunRepositoryError(
        'findByTaskAndBusinessDate',
        'VALIDATION_ERROR',
        'taskId must not be empty.',
      );
    }

    const dateStr = parseBusinessDate(businessDate);

    try {
      return this.client.orm
        .select()
        .from(executionRuns)
        .where(and(eq(executionRuns.taskId, trimmedTask), eq(executionRuns.businessDate, dateStr)))
        .get();
    } catch (error) {
      throw new ExecutionRunRepositoryError(
        'findByTaskAndBusinessDate',
        'INTEGRITY_ERROR',
        'Failed to find execution run.',
        error,
      );
    }
  }

  markRunning(id: string, options?: { startedAt?: Date; now?: Date }): ExecutionRun {
    const now = options?.now ?? new Date();
    const startedAt = options?.startedAt ?? now;

    try {
      const result = this.client.orm
        .update(executionRuns)
        .set({
          status: 'RUNNING',
          startedAt,
          updatedAt: now,
        })
        .where(and(eq(executionRuns.id, id), eq(executionRuns.status, 'PENDING')))
        .returning()
        .get();

      if (result) return result;

      const existing = this.findById(id);
      if (!existing) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'NOT_FOUND',
          `Execution run '${id}' not found.`,
        );
      }
      if (TERMINAL_EXECUTION_RUN_STATUSES.includes(existing.status)) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'TERMINAL_STATE',
          `Cannot transition run from terminal status '${existing.status}'.`,
        );
      }
      throw new ExecutionRunRepositoryError(
        'transition',
        'INVALID_TRANSITION',
        `Cannot transition execution run from '${existing.status}' to 'RUNNING'.`,
      );
    } catch (error) {
      if (error instanceof ExecutionRunRepositoryError) throw error;
      throw new ExecutionRunRepositoryError(
        'transition',
        'INTEGRITY_ERROR',
        'Failed to mark execution run running.',
        error,
      );
    }
  }

  markCompleted(
    id: string,
    targetStatus: ExecutionRunStatus,
    options?: { finishedAt?: Date; now?: Date },
  ): ExecutionRun {
    if (!TERMINAL_EXECUTION_RUN_STATUSES.includes(targetStatus)) {
      throw new ExecutionRunRepositoryError(
        'transition',
        'VALIDATION_ERROR',
        `Status '${targetStatus}' is not a terminal completion status.`,
      );
    }

    const now = options?.now ?? new Date();
    const finishedAt = options?.finishedAt ?? now;

    try {
      const result = this.client.orm
        .update(executionRuns)
        .set({
          status: targetStatus,
          finishedAt,
          updatedAt: now,
        })
        .where(and(eq(executionRuns.id, id), eq(executionRuns.status, 'RUNNING')))
        .returning()
        .get();

      if (result) return result;

      const existing = this.findById(id);
      if (!existing) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'NOT_FOUND',
          `Execution run '${id}' not found.`,
        );
      }
      if (TERMINAL_EXECUTION_RUN_STATUSES.includes(existing.status)) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'TERMINAL_STATE',
          `Execution run is already in terminal state '${existing.status}' and cannot be modified.`,
        );
      }
      throw new ExecutionRunRepositoryError(
        'transition',
        'INVALID_TRANSITION',
        `Cannot complete execution run from '${existing.status}' to '${targetStatus}'.`,
      );
    } catch (error) {
      if (error instanceof ExecutionRunRepositoryError) throw error;
      throw new ExecutionRunRepositoryError(
        'transition',
        'INTEGRITY_ERROR',
        'Failed to complete execution run.',
        error,
      );
    }
  }

  markCancelled(id: string, options?: { finishedAt?: Date; now?: Date }): ExecutionRun {
    const now = options?.now ?? new Date();
    const finishedAt = options?.finishedAt ?? now;

    try {
      const result = this.client.orm
        .update(executionRuns)
        .set({
          status: 'CANCELLED',
          finishedAt,
          updatedAt: now,
        })
        .where(and(eq(executionRuns.id, id), inArray(executionRuns.status, ['PENDING', 'RUNNING'])))
        .returning()
        .get();

      if (result) return result;

      const existing = this.findById(id);
      if (!existing) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'NOT_FOUND',
          `Execution run '${id}' not found.`,
        );
      }
      if (TERMINAL_EXECUTION_RUN_STATUSES.includes(existing.status)) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'TERMINAL_STATE',
          `Execution run is already in terminal state '${existing.status}' and cannot be cancelled.`,
        );
      }
      throw new ExecutionRunRepositoryError(
        'transition',
        'INVALID_TRANSITION',
        `Cannot cancel execution run from '${existing.status}'.`,
      );
    } catch (error) {
      if (error instanceof ExecutionRunRepositoryError) throw error;
      throw new ExecutionRunRepositoryError(
        'transition',
        'INTEGRITY_ERROR',
        'Failed to cancel execution run.',
        error,
      );
    }
  }

  markFailed(id: string, options?: { finishedAt?: Date; now?: Date }): ExecutionRun {
    const now = options?.now ?? new Date();
    const finishedAt = options?.finishedAt ?? now;

    try {
      const result = this.client.orm
        .update(executionRuns)
        .set({
          status: 'FAILED',
          finishedAt,
          updatedAt: now,
        })
        .where(and(eq(executionRuns.id, id), inArray(executionRuns.status, ['PENDING', 'RUNNING'])))
        .returning()
        .get();

      if (result) return result;

      const existing = this.findById(id);
      if (!existing) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'NOT_FOUND',
          `Execution run '${id}' not found.`,
        );
      }
      if (TERMINAL_EXECUTION_RUN_STATUSES.includes(existing.status)) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'TERMINAL_STATE',
          `Execution run is already in terminal state '${existing.status}' and cannot be failed.`,
        );
      }
      throw new ExecutionRunRepositoryError(
        'transition',
        'INVALID_TRANSITION',
        `Cannot fail execution run from '${existing.status}'.`,
      );
    } catch (error) {
      if (error instanceof ExecutionRunRepositoryError) throw error;
      throw new ExecutionRunRepositoryError(
        'transition',
        'INTEGRITY_ERROR',
        'Failed to fail execution run.',
        error,
      );
    }
  }

  markAuthExpired(id: string, options?: { finishedAt?: Date; now?: Date }): ExecutionRun {
    const now = options?.now ?? new Date();
    const finishedAt = options?.finishedAt ?? now;

    try {
      const result = this.client.orm
        .update(executionRuns)
        .set({
          status: 'AUTH_EXPIRED',
          finishedAt,
          updatedAt: now,
        })
        .where(and(eq(executionRuns.id, id), inArray(executionRuns.status, ['PENDING', 'RUNNING'])))
        .returning()
        .get();

      if (result) return result;

      const existing = this.findById(id);
      if (!existing) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'NOT_FOUND',
          `Execution run '${id}' not found.`,
        );
      }
      if (TERMINAL_EXECUTION_RUN_STATUSES.includes(existing.status)) {
        throw new ExecutionRunRepositoryError(
          'transition',
          'TERMINAL_STATE',
          `Execution run is already in terminal state '${existing.status}' and cannot be marked auth expired.`,
        );
      }
      throw new ExecutionRunRepositoryError(
        'transition',
        'INVALID_TRANSITION',
        `Cannot mark auth expired for execution run from '${existing.status}'.`,
      );
    } catch (error) {
      if (error instanceof ExecutionRunRepositoryError) throw error;
      throw new ExecutionRunRepositoryError(
        'transition',
        'INTEGRITY_ERROR',
        'Failed to mark execution run auth expired.',
        error,
      );
    }
  }

  listByAccountId(
    accountId: string,
    options?: { limit?: number; offset?: number },
  ): ExecutionRun[] {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new ExecutionRunRepositoryError(
        'listByAccountId',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(executionRuns)
        .where(eq(executionRuns.accountId, trimmed))
        .orderBy(desc(executionRuns.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new ExecutionRunRepositoryError(
        'listByAccountId',
        'INTEGRITY_ERROR',
        'Failed to list execution runs.',
        error,
      );
    }
  }
}
