import { randomUUID } from 'node:crypto';

import {
  BusinessDateError,
  parseBusinessDate,
  type BusinessDate,
  type DailyRunStatus,
} from '@sparkkeeper/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  DAILY_RUN_STATUSES,
  dailyRuns,
  type DailyRunRow,
  type NewDailyRunRow,
} from '../schema/index.js';

export const DEFAULT_DAILY_RUN_LIMIT = 50;
export const MAX_DAILY_RUN_LIMIT = 100;

export type DailyRun = DailyRunRow;

export interface CreateOrGetDailyRunInput {
  readonly accountId: string;
  readonly businessDate: BusinessDate;
  readonly now: Date;
}

export interface ListDailyRunsInput {
  readonly accountId?: string;
  readonly businessDate?: BusinessDate;
  readonly status?: DailyRunStatus;
  readonly limit?: number;
}

export type ClaimDailyRunResult =
  | { readonly type: 'CLAIMED'; readonly run: DailyRun }
  | { readonly type: 'NOT_CLAIMABLE'; readonly run: DailyRun }
  | { readonly type: 'NOT_FOUND' };

export type DailyRunRepositoryErrorCode =
  | 'INVALID_BUSINESS_DATE'
  | 'INVALID_TIMESTAMP'
  | 'DAILY_RUN_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'DATABASE_OPERATION_FAILED';

export class DailyRunRepositoryError extends Error {
  constructor(
    readonly operation:
      | 'createOrGet'
      | 'findById'
      | 'findByAccountAndBusinessDate'
      | 'listByAccountId'
      | 'list'
      | 'markRunning'
      | 'claimForExecution'
      | 'markSuccess'
      | 'markFailed'
      | 'markAuthExpired',
    readonly code: DailyRunRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DailyRunRepositoryError';
  }
}

export class DailyRunRepository {
  constructor(private readonly client: DatabaseClient) {}

  createOrGet(input: CreateOrGetDailyRunInput): DailyRun {
    const operation = 'createOrGet' as const;
    try {
      const businessDate = validateBusinessDate(input.businessDate, operation);
      const now = validateTimestamp(input.now, operation);
      const values: NewDailyRunRow = {
        id: randomUUID(),
        accountId: input.accountId,
        businessDate,
        status: 'READY',
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      this.client.orm
        .insert(dailyRuns)
        .values(values)
        .onConflictDoNothing({ target: [dailyRuns.accountId, dailyRuns.businessDate] })
        .run();

      const run = this.client.orm
        .select()
        .from(dailyRuns)
        .where(
          and(eq(dailyRuns.accountId, input.accountId), eq(dailyRuns.businessDate, businessDate)),
        )
        .get();
      if (run === undefined) {
        throw new DailyRunRepositoryError(
          operation,
          'DATABASE_OPERATION_FAILED',
          'Daily run createOrGet completed without a canonical row.',
        );
      }
      return run;
    } catch (error) {
      throw dailyRunError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to create or get daily run.',
        error,
      );
    }
  }

  findById(id: string): DailyRun | undefined {
    try {
      return this.client.orm.select().from(dailyRuns).where(eq(dailyRuns.id, id)).get();
    } catch (error) {
      throw dailyRunError(
        'findById',
        'DATABASE_OPERATION_FAILED',
        'Failed to find daily run by id.',
        error,
      );
    }
  }

  findByAccountAndBusinessDate(
    accountId: string,
    businessDate: BusinessDate,
  ): DailyRun | undefined {
    const operation = 'findByAccountAndBusinessDate' as const;
    try {
      const validatedDate = validateBusinessDate(businessDate, operation);
      return this.client.orm
        .select()
        .from(dailyRuns)
        .where(and(eq(dailyRuns.accountId, accountId), eq(dailyRuns.businessDate, validatedDate)))
        .get();
    } catch (error) {
      throw dailyRunError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to find daily run by account and business date.',
        error,
      );
    }
  }

  listByAccountId(accountId: string): DailyRun[] {
    try {
      return this.client.orm
        .select()
        .from(dailyRuns)
        .where(eq(dailyRuns.accountId, accountId))
        .orderBy(asc(dailyRuns.businessDate), asc(dailyRuns.createdAt), asc(dailyRuns.id))
        .all();
    } catch (error) {
      throw dailyRunError(
        'listByAccountId',
        'DATABASE_OPERATION_FAILED',
        'Failed to list daily runs for account.',
        error,
      );
    }
  }

  list(input: ListDailyRunsInput = {}): DailyRun[] {
    const operation = 'list' as const;
    try {
      const businessDate =
        input.businessDate === undefined
          ? undefined
          : validateBusinessDate(input.businessDate, operation);
      if (input.status !== undefined && !DAILY_RUN_STATUSES.includes(input.status)) {
        throw new DailyRunRepositoryError(
          operation,
          'DATABASE_OPERATION_FAILED',
          'Daily run status filter is unsupported.',
        );
      }
      const limit = validateLimit(input.limit ?? DEFAULT_DAILY_RUN_LIMIT, operation);
      return this.client.orm
        .select()
        .from(dailyRuns)
        .where(
          and(
            input.accountId === undefined ? undefined : eq(dailyRuns.accountId, input.accountId),
            businessDate === undefined ? undefined : eq(dailyRuns.businessDate, businessDate),
            input.status === undefined ? undefined : eq(dailyRuns.status, input.status),
          ),
        )
        .orderBy(desc(dailyRuns.businessDate), desc(dailyRuns.createdAt), desc(dailyRuns.id))
        .limit(limit)
        .all();
    } catch (error) {
      throw dailyRunError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to list daily runs.',
        error,
      );
    }
  }

  markRunning(id: string, now: Date): DailyRun {
    return this.transition(id, 'RUNNING', ['READY'], now, 'markRunning');
  }

  claimForExecution(id: string, timestamp: Date): ClaimDailyRunResult {
    const operation = 'claimForExecution' as const;
    try {
      const now = validateTimestamp(timestamp, operation);
      const claimed = this.client.orm
        .update(dailyRuns)
        .set({ status: 'RUNNING', startedAt: now, updatedAt: now })
        .where(and(eq(dailyRuns.id, id), eq(dailyRuns.status, 'READY')))
        .returning()
        .get();
      if (claimed !== undefined) {
        return { type: 'CLAIMED', run: claimed };
      }
      const existing = this.client.orm.select().from(dailyRuns).where(eq(dailyRuns.id, id)).get();
      return existing === undefined
        ? { type: 'NOT_FOUND' }
        : { type: 'NOT_CLAIMABLE', run: existing };
    } catch (error) {
      throw dailyRunError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to claim daily run.',
        error,
      );
    }
  }

  markSuccess(id: string, now: Date): DailyRun {
    return this.transition(id, 'SUCCESS', ['RUNNING'], now, 'markSuccess');
  }

  markFailed(id: string, now: Date): DailyRun {
    return this.transition(id, 'FAILED', ['RUNNING'], now, 'markFailed');
  }

  markAuthExpired(id: string, now: Date): DailyRun {
    return this.transition(id, 'AUTH_EXPIRED', ['READY', 'RUNNING'], now, 'markAuthExpired');
  }

  private transition(
    id: string,
    target: DailyRunStatus,
    allowedSources: readonly DailyRunStatus[],
    timestamp: Date,
    operation: DailyRunRepositoryError['operation'],
  ): DailyRun {
    try {
      const now = validateTimestamp(timestamp, operation);
      const values: Partial<NewDailyRunRow> = {
        status: target,
        updatedAt: now,
        ...(target === 'RUNNING' ? { startedAt: now } : { finishedAt: now }),
      };
      const updated = this.client.orm
        .update(dailyRuns)
        .set(values)
        .where(and(eq(dailyRuns.id, id), inArray(dailyRuns.status, allowedSources)))
        .returning()
        .get();
      if (updated !== undefined) {
        return updated;
      }

      const existing = this.client.orm.select().from(dailyRuns).where(eq(dailyRuns.id, id)).get();
      if (existing === undefined) {
        throw new DailyRunRepositoryError(
          operation,
          'DAILY_RUN_NOT_FOUND',
          'Daily run was not found.',
        );
      }
      if (existing.status === target) {
        return existing;
      }
      throw new DailyRunRepositoryError(
        operation,
        'INVALID_STATE_TRANSITION',
        `Daily run cannot transition from ${existing.status} to ${target}.`,
      );
    } catch (error) {
      throw dailyRunError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to update daily run state.',
        error,
      );
    }
  }
}

function validateBusinessDate(
  value: BusinessDate,
  operation: DailyRunRepositoryError['operation'],
): BusinessDate {
  try {
    return parseBusinessDate(value);
  } catch (error) {
    throw new DailyRunRepositoryError(
      operation,
      'INVALID_BUSINESS_DATE',
      'Daily run business date is invalid.',
      error,
    );
  }
}

function validateTimestamp(value: Date, operation: DailyRunRepositoryError['operation']): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new DailyRunRepositoryError(
      operation,
      'INVALID_TIMESTAMP',
      'Daily run operation requires a valid timestamp.',
    );
  }
  return value;
}

function validateLimit(limit: number, operation: DailyRunRepositoryError['operation']): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DAILY_RUN_LIMIT) {
    throw new DailyRunRepositoryError(
      operation,
      'DATABASE_OPERATION_FAILED',
      `Daily run limit must be an integer between 1 and ${MAX_DAILY_RUN_LIMIT}.`,
    );
  }
  return limit;
}

function dailyRunError(
  operation: DailyRunRepositoryError['operation'],
  code: DailyRunRepositoryErrorCode,
  fallbackMessage: string,
  error: unknown,
): DailyRunRepositoryError {
  if (error instanceof DailyRunRepositoryError) {
    return error;
  }
  if (error instanceof BusinessDateError) {
    return new DailyRunRepositoryError(operation, 'INVALID_BUSINESS_DATE', error.message, error);
  }
  return new DailyRunRepositoryError(operation, code, fallbackMessage, error);
}
