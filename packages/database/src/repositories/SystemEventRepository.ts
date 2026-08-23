import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  isRuntimeEventType,
  isSystemEventLevel,
  type RuntimeEventType,
  type SystemEventLevel,
} from '@sparkkeeper/shared';
import { and, desc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { systemEvents, type NewSystemEventRow, type SystemEventRow } from '../schema/index.js';

export const DEFAULT_SYSTEM_EVENT_LIMIT = 100;
export const MAX_SYSTEM_EVENT_LIMIT = 500;

export type SystemEvent = SystemEventRow;

export interface CreateSystemEventInput {
  readonly eventType: RuntimeEventType;
  readonly level: SystemEventLevel;
  readonly runId?: string | null;
  readonly accountId?: string | null;
  readonly friendId?: string | null;
  readonly attempt?: number | null;
  readonly errorCode?: string | null;
  readonly message: string;
  readonly screenshotPath?: string | null;
  readonly tracePath?: string | null;
  readonly now?: Date;
}

export class SystemEventRepositoryError extends Error {
  constructor(
    readonly operation: 'create' | 'findById' | 'listRecent' | 'listByRunId',
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SystemEventRepositoryError';
  }
}

export class SystemEventRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateSystemEventInput): SystemEvent {
    const operation = 'create' as const;
    try {
      if (!isRuntimeEventType(input.eventType)) {
        throw new SystemEventRepositoryError(operation, 'System event type is unsupported.');
      }
      if (!isSystemEventLevel(input.level)) {
        throw new SystemEventRepositoryError(operation, 'System event level is unsupported.');
      }
      const message = input.message.trim();
      if (message.length === 0) {
        throw new SystemEventRepositoryError(operation, 'System event message must not be empty.');
      }
      if (input.attempt !== undefined && input.attempt !== null) {
        if (!Number.isInteger(input.attempt) || input.attempt < 1) {
          throw new SystemEventRepositoryError(
            operation,
            'System event attempt must be a positive integer.',
          );
        }
      }
      const createdAt = input.now ?? new Date();
      if (!Number.isFinite(createdAt.getTime())) {
        throw new SystemEventRepositoryError(operation, 'System event timestamp is invalid.');
      }

      const values: NewSystemEventRow = {
        id: randomUUID(),
        eventType: input.eventType,
        level: input.level,
        runId: input.runId ?? null,
        accountId: input.accountId ?? null,
        friendId: input.friendId ?? null,
        attempt: input.attempt ?? null,
        errorCode: normalizeOptionalText(input.errorCode),
        message,
        screenshotPath: validateRelativeEvidencePath(input.screenshotPath, operation),
        tracePath: validateRelativeEvidencePath(input.tracePath, operation),
        createdAt,
      };
      return this.client.orm.insert(systemEvents).values(values).returning().get();
    } catch (error) {
      if (error instanceof SystemEventRepositoryError) throw error;
      throw new SystemEventRepositoryError(operation, 'Failed to create SystemEvent.', error);
    }
  }

  findById(id: string): SystemEvent | undefined {
    try {
      return this.client.orm.select().from(systemEvents).where(eq(systemEvents.id, id)).get();
    } catch (error) {
      throw new SystemEventRepositoryError('findById', 'Failed to find SystemEvent by id.', error);
    }
  }

  listRecent(limit = DEFAULT_SYSTEM_EVENT_LIMIT): SystemEvent[] {
    const validatedLimit = validateLimit(limit, 'listRecent');
    try {
      return this.client.orm
        .select()
        .from(systemEvents)
        .orderBy(desc(systemEvents.createdAt), desc(systemEvents.id))
        .limit(validatedLimit)
        .all();
    } catch (error) {
      throw new SystemEventRepositoryError(
        'listRecent',
        'Failed to list recent SystemEvents.',
        error,
      );
    }
  }

  listByRunId(runId: string, limit = DEFAULT_SYSTEM_EVENT_LIMIT): SystemEvent[] {
    const validatedLimit = validateLimit(limit, 'listByRunId');
    try {
      return this.client.orm
        .select()
        .from(systemEvents)
        .where(and(eq(systemEvents.runId, runId)))
        .orderBy(desc(systemEvents.createdAt), desc(systemEvents.id))
        .limit(validatedLimit)
        .all();
    } catch (error) {
      throw new SystemEventRepositoryError(
        'listByRunId',
        'Failed to list Run SystemEvents.',
        error,
      );
    }
  }
}

function validateLimit(limit: number, operation: 'listRecent' | 'listByRunId'): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SYSTEM_EVENT_LIMIT) {
    throw new SystemEventRepositoryError(
      operation,
      `System event limit must be an integer between 1 and ${MAX_SYSTEM_EVENT_LIMIT}.`,
    );
  }
  return limit;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validateRelativeEvidencePath(
  value: string | null | undefined,
  operation: 'create',
): string | null {
  const normalized = normalizeOptionalText(value);
  if (normalized === null) return null;
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    normalized.includes('\\') ||
    normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new SystemEventRepositoryError(
      operation,
      'System event evidence path must be a safe relative path.',
    );
  }
  return normalized;
}
