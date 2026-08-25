import { randomUUID } from 'node:crypto';

import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_INTERVAL_SECONDS,
  parseScheduleTime,
  resolveBusinessTimeZone,
  ScheduleTimeError,
  validateMaxAttempts,
  validateRetryIntervalSeconds,
  validateScheduleWindow,
  type ScheduleTime,
} from '@sparkkeeper/shared';
import { asc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { accounts, schedules, type NewScheduleRow, type ScheduleRow } from '../schema/index.js';

export type Schedule = ScheduleRow;

export interface CreateScheduleInput {
  readonly accountId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly timezone?: string;
  readonly maxAttempts?: number;
  readonly retryIntervalSeconds?: number;
  readonly enabled?: boolean;
  readonly now: Date;
}

export interface UpdateScheduleInput {
  readonly startTime?: string;
  readonly endTime?: string;
  readonly timezone?: string;
  readonly maxAttempts?: number;
  readonly retryIntervalSeconds?: number;
  readonly enabled?: boolean;
  readonly now: Date;
}

export type ScheduleRepositoryErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'INVALID_TIME'
  | 'INVALID_WINDOW'
  | 'INVALID_TIMEZONE'
  | 'INVALID_RETRY_CONFIG'
  | 'INVALID_TIMESTAMP'
  | 'EMPTY_UPDATE'
  | 'DATABASE_OPERATION_FAILED';

export class ScheduleRepositoryError extends Error {
  constructor(
    readonly operation:
      'create' | 'findById' | 'findByAccountId' | 'list' | 'listEnabled' | 'update',
    readonly code: ScheduleRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ScheduleRepositoryError';
  }
}

export class ScheduleRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateScheduleInput): Schedule {
    const operation = 'create' as const;
    try {
      const account = this.client.orm
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, input.accountId))
        .get();
      if (account === undefined) {
        throw new ScheduleRepositoryError(
          operation,
          'ACCOUNT_NOT_FOUND',
          'Schedule Account was not found.',
        );
      }

      const window = validateWindow(input.startTime, input.endTime, operation);
      const now = validateTimestamp(input.now, operation);
      const values: NewScheduleRow = {
        id: randomUUID(),
        accountId: input.accountId,
        ...window,
        timezone: validateTimezone(input.timezone, operation),
        maxAttempts: validateRetryAttempts(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, operation),
        retryIntervalSeconds: validateRetryInterval(
          input.retryIntervalSeconds ?? DEFAULT_RETRY_INTERVAL_SECONDS,
          operation,
        ),
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      return this.client.orm.insert(schedules).values(values).returning().get();
    } catch (error) {
      throw repositoryError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to create Schedule.',
        error,
      );
    }
  }

  findById(id: string): Schedule | undefined {
    try {
      return this.client.orm.select().from(schedules).where(eq(schedules.id, id)).get();
    } catch (error) {
      throw repositoryError(
        'findById',
        'DATABASE_OPERATION_FAILED',
        'Failed to find Schedule by id.',
        error,
      );
    }
  }

  findByAccountId(accountId: string): Schedule | undefined {
    try {
      return this.client.orm
        .select()
        .from(schedules)
        .where(eq(schedules.accountId, accountId))
        .get();
    } catch (error) {
      throw repositoryError(
        'findByAccountId',
        'DATABASE_OPERATION_FAILED',
        'Failed to find Schedule by Account.',
        error,
      );
    }
  }

  list(): Schedule[] {
    try {
      return this.client.orm
        .select()
        .from(schedules)
        .orderBy(asc(schedules.createdAt), asc(schedules.id))
        .all();
    } catch (error) {
      throw repositoryError(
        'list',
        'DATABASE_OPERATION_FAILED',
        'Failed to list Schedules.',
        error,
      );
    }
  }

  listEnabled(): Schedule[] {
    try {
      return this.client.orm
        .select()
        .from(schedules)
        .where(eq(schedules.enabled, true))
        .orderBy(asc(schedules.createdAt), asc(schedules.id))
        .all();
    } catch (error) {
      throw repositoryError(
        'listEnabled',
        'DATABASE_OPERATION_FAILED',
        'Failed to list enabled Schedules.',
        error,
      );
    }
  }

  update(id: string, input: UpdateScheduleInput): Schedule | undefined {
    const operation = 'update' as const;
    try {
      const existing = this.client.orm.select().from(schedules).where(eq(schedules.id, id)).get();
      if (existing === undefined) {
        return undefined;
      }

      const hasMutableField =
        input.startTime !== undefined ||
        input.endTime !== undefined ||
        input.timezone !== undefined ||
        input.maxAttempts !== undefined ||
        input.retryIntervalSeconds !== undefined ||
        input.enabled !== undefined;
      if (!hasMutableField) {
        throw new ScheduleRepositoryError(
          operation,
          'EMPTY_UPDATE',
          'Schedule update requires at least one mutable field.',
        );
      }

      const window = validateWindow(
        input.startTime ?? existing.startTime,
        input.endTime ?? existing.endTime,
        operation,
      );
      const values: Partial<NewScheduleRow> = {
        ...window,
        timezone:
          input.timezone === undefined
            ? existing.timezone
            : validateTimezone(input.timezone, operation),
        maxAttempts:
          input.maxAttempts === undefined
            ? existing.maxAttempts
            : validateRetryAttempts(input.maxAttempts, operation),
        retryIntervalSeconds:
          input.retryIntervalSeconds === undefined
            ? existing.retryIntervalSeconds
            : validateRetryInterval(input.retryIntervalSeconds, operation),
        updatedAt: validateTimestamp(input.now, operation),
      };
      if (input.enabled !== undefined) {
        values.enabled = input.enabled;
      }

      return this.client.orm
        .update(schedules)
        .set(values)
        .where(eq(schedules.id, id))
        .returning()
        .get();
    } catch (error) {
      throw repositoryError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to update Schedule.',
        error,
      );
    }
  }
}

function validateRetryAttempts(
  value: number,
  operation: ScheduleRepositoryError['operation'],
): number {
  try {
    return validateMaxAttempts(value);
  } catch (error) {
    throw new ScheduleRepositoryError(
      operation,
      'INVALID_RETRY_CONFIG',
      'Schedule maxAttempts is outside the supported bounded range.',
      error,
    );
  }
}

function validateRetryInterval(
  value: number,
  operation: ScheduleRepositoryError['operation'],
): number {
  try {
    return validateRetryIntervalSeconds(value);
  } catch (error) {
    throw new ScheduleRepositoryError(
      operation,
      'INVALID_RETRY_CONFIG',
      'Schedule retryIntervalSeconds is outside the supported bounded range.',
      error,
    );
  }
}

function validateWindow(
  startValue: string,
  endValue: string,
  operation: ScheduleRepositoryError['operation'],
): { readonly startTime: ScheduleTime; readonly endTime: ScheduleTime } {
  let startTime: ScheduleTime;
  let endTime: ScheduleTime;
  try {
    startTime = parseScheduleTime(startValue);
    endTime = parseScheduleTime(endValue);
  } catch (error) {
    throw new ScheduleRepositoryError(
      operation,
      'INVALID_TIME',
      'Schedule times must use strict valid HH:mm values.',
      error,
    );
  }
  try {
    validateScheduleWindow(startTime, endTime);
  } catch (error) {
    throw new ScheduleRepositoryError(
      operation,
      'INVALID_WINDOW',
      'Schedule start time must be before end time; overnight windows are unsupported.',
      error,
    );
  }
  return { startTime, endTime };
}

function validateTimezone(
  value: string | undefined,
  operation: ScheduleRepositoryError['operation'],
): string {
  try {
    return resolveBusinessTimeZone(value);
  } catch (error) {
    throw new ScheduleRepositoryError(
      operation,
      'INVALID_TIMEZONE',
      'Schedule timezone must be a valid IANA timezone.',
      error,
    );
  }
}

function validateTimestamp(value: Date, operation: ScheduleRepositoryError['operation']): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ScheduleRepositoryError(
      operation,
      'INVALID_TIMESTAMP',
      'Schedule operation requires a valid timestamp.',
    );
  }
  return value;
}

function repositoryError(
  operation: ScheduleRepositoryError['operation'],
  code: ScheduleRepositoryErrorCode,
  message: string,
  error: unknown,
): ScheduleRepositoryError {
  if (error instanceof ScheduleRepositoryError) {
    return error;
  }
  if (error instanceof ScheduleTimeError) {
    return new ScheduleRepositoryError(operation, 'INVALID_TIME', error.message, error);
  }
  return new ScheduleRepositoryError(operation, code, message, error);
}
