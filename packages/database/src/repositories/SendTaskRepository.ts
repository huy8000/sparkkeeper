import { randomUUID } from 'node:crypto';

import {
  isSendTaskScheduleType,
  validateSendTaskMaxAttempts,
  validateSendTaskName,
  validateSendTaskRetryIntervalSeconds,
  validateSendTaskScheduleWindow,
  validateSendTaskTimeZone,
  type SendTaskScheduleType,
} from '@sparkkeeper/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  contacts,
  sendTasks,
  sendTaskTargets,
  type NewSendTaskRow,
  type SendTaskRow,
} from '../schema/index.js';

export type SendTask = SendTaskRow;

export interface CreateSendTaskInput {
  readonly name: string;
  readonly accountId: string;
  readonly templateId: string;
  readonly scheduleType?: SendTaskScheduleType;
  readonly startTime: string;
  readonly endTime: string;
  readonly timezone: string;
  readonly maxAttempts?: number;
  readonly retryIntervalSeconds?: number;
  readonly targetContactIds?: string[];
  readonly now?: Date;
}

export interface UpdateSendTaskInput {
  readonly name?: string;
  readonly templateId?: string;
  readonly scheduleType?: SendTaskScheduleType;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly timezone?: string;
  readonly maxAttempts?: number;
  readonly retryIntervalSeconds?: number;
  readonly archivedAt?: Date | null;
  readonly now?: Date;
}

export class SendTaskRepositoryError extends RepositoryError {
  readonly taskOperation:
    | 'create'
    | 'findById'
    | 'listByAccountId'
    | 'update'
    | 'setTargets'
    | 'getTargetContactIds'
    | 'disable'
    | 'archive';

  constructor(
    operation: SendTaskRepositoryError['taskOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'SendTask', operation, cause });
    this.name = 'SendTaskRepositoryError';
    this.taskOperation = operation;
  }
}

export class SendTaskRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateSendTaskInput): { task: SendTask; targetContactIds: string[] } {
    let name: string;
    let timezone: string;
    let window: { startTime: string; endTime: string };
    let maxAttempts: number;
    let retryIntervalSeconds: number;

    try {
      name = validateSendTaskName(input.name);
      timezone = validateSendTaskTimeZone(input.timezone);
      window = validateSendTaskScheduleWindow(input.startTime, input.endTime);
      maxAttempts = validateSendTaskMaxAttempts(input.maxAttempts ?? 3);
      retryIntervalSeconds = validateSendTaskRetryIntervalSeconds(input.retryIntervalSeconds ?? 60);
    } catch (error) {
      throw new SendTaskRepositoryError(
        'create',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid task fields.',
        error,
      );
    }

    const accountId = input.accountId.trim();
    const templateId = input.templateId.trim();
    if (accountId.length === 0) {
      throw new SendTaskRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    if (templateId.length === 0) {
      throw new SendTaskRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'templateId must not be empty.',
      );
    }

    const scheduleType: SendTaskScheduleType = input.scheduleType ?? 'DAILY_WINDOW';
    if (!isSendTaskScheduleType(scheduleType)) {
      throw new SendTaskRepositoryError('create', 'VALIDATION_ERROR', 'Invalid scheduleType.');
    }

    const now = input.now ?? new Date();
    const taskId = randomUUID();
    const values: NewSendTaskRow = {
      id: taskId,
      name,
      accountId,
      templateId,
      scheduleType,
      startTime: window.startTime,
      endTime: window.endTime,
      timezone,
      maxAttempts,
      retryIntervalSeconds,
      enabled: false, // V4-1 strictly hardcodes enabled=false on creation
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const targetContactIds = Array.from(
      new Set((input.targetContactIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0)),
    );

    if (targetContactIds.length > 100) {
      throw new SendTaskRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'A send task cannot have more than 100 target contacts.',
      );
    }

    try {
      return this.client.orm.transaction((tx) => {
        if (targetContactIds.length > 0) {
          const loadedContacts = tx
            .select()
            .from(contacts)
            .where(inArray(contacts.id, targetContactIds))
            .all();

          if (loadedContacts.length !== targetContactIds.length) {
            throw new SendTaskRepositoryError(
              'create',
              'NOT_FOUND',
              'One or more target contacts do not exist.',
            );
          }

          for (const contact of loadedContacts) {
            if (contact.accountId !== accountId) {
              throw new SendTaskRepositoryError(
                'create',
                'ACCOUNT_MISMATCH',
                `Target contact ${contact.id} belongs to account ${contact.accountId}, not task account ${accountId}.`,
              );
            }
            if (contact.type !== 'PERSON' && contact.type !== 'GROUP') {
              throw new SendTaskRepositoryError(
                'create',
                'UNSUPPORTED_TARGET_TYPE',
                `Target contact ${contact.id} has unsupported type '${contact.type}'. Only PERSON and GROUP are allowed.`,
              );
            }
          }
        }

        const task = tx.insert(sendTasks).values(values).returning().get();
        if (targetContactIds.length > 0) {
          tx.insert(sendTaskTargets)
            .values(
              targetContactIds.map((contactId) => ({
                taskId,
                contactId,
                createdAt: now,
              })),
            )
            .run();
        }
        return { task, targetContactIds };
      });
    } catch (error) {
      if (error instanceof SendTaskRepositoryError) {
        throw error;
      }
      throw new SendTaskRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create send task.',
        error,
      );
    }
  }

  findById(id: string): SendTask | undefined {
    try {
      return this.client.orm.select().from(sendTasks).where(eq(sendTasks.id, id)).get();
    } catch (error) {
      throw new SendTaskRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find send task by id.',
        error,
      );
    }
  }

  listByAccountId(
    accountId: string,
    options?: {
      enabled?: boolean;
      includeArchived?: boolean;
      limit?: number;
      offset?: number;
    },
  ): SendTask[] {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new SendTaskRepositoryError(
        'listByAccountId',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }

    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      const conditions = [eq(sendTasks.accountId, trimmed)];
      if (options?.enabled !== undefined) {
        conditions.push(eq(sendTasks.enabled, options.enabled));
      }
      if (!options?.includeArchived) {
        conditions.push(isNull(sendTasks.archivedAt));
      }

      return this.client.orm
        .select()
        .from(sendTasks)
        .where(and(...conditions))
        .orderBy(asc(sendTasks.createdAt), asc(sendTasks.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new SendTaskRepositoryError(
        'listByAccountId',
        'INTEGRITY_ERROR',
        'Failed to list send tasks.',
        error,
      );
    }
  }

  update(id: string, input: UpdateSendTaskInput): SendTask | undefined {
    const existing = this.findById(id);
    if (!existing) {
      return undefined;
    }

    const now = input.now ?? new Date();
    const values: Partial<NewSendTaskRow> = { updatedAt: now };
    let mutationCount = 0;

    if (input.name !== undefined) {
      values.name = validateSendTaskName(input.name);
      mutationCount += 1;
    }
    if (input.templateId !== undefined) {
      const trimmed = input.templateId.trim();
      if (trimmed.length === 0) {
        throw new SendTaskRepositoryError(
          'update',
          'VALIDATION_ERROR',
          'templateId must not be empty.',
        );
      }
      values.templateId = trimmed;
      mutationCount += 1;
    }
    if (input.scheduleType !== undefined) {
      if (!isSendTaskScheduleType(input.scheduleType)) {
        throw new SendTaskRepositoryError('update', 'VALIDATION_ERROR', 'Invalid scheduleType.');
      }
      values.scheduleType = input.scheduleType;
      mutationCount += 1;
    }

    const startTime = input.startTime ?? existing.startTime;
    const endTime = input.endTime ?? existing.endTime;
    if (input.startTime !== undefined || input.endTime !== undefined) {
      const window = validateSendTaskScheduleWindow(startTime, endTime);
      values.startTime = window.startTime;
      values.endTime = window.endTime;
      mutationCount += 1;
    }

    if (input.timezone !== undefined) {
      values.timezone = validateSendTaskTimeZone(input.timezone);
      mutationCount += 1;
    }
    if (input.maxAttempts !== undefined) {
      values.maxAttempts = validateSendTaskMaxAttempts(input.maxAttempts);
      mutationCount += 1;
    }
    if (input.retryIntervalSeconds !== undefined) {
      values.retryIntervalSeconds = validateSendTaskRetryIntervalSeconds(
        input.retryIntervalSeconds,
      );
      mutationCount += 1;
    }
    if (input.archivedAt !== undefined) {
      values.archivedAt = input.archivedAt;
      if (input.archivedAt !== null) {
        values.enabled = false;
      }
      mutationCount += 1;
    }

    if (mutationCount === 0) {
      throw new SendTaskRepositoryError(
        'update',
        'VALIDATION_ERROR',
        'SendTask update requires at least one field.',
      );
    }

    try {
      return this.client.orm
        .update(sendTasks)
        .set(values)
        .where(eq(sendTasks.id, id))
        .returning()
        .get();
    } catch (error) {
      throw new SendTaskRepositoryError(
        'update',
        'INTEGRITY_ERROR',
        'Failed to update send task.',
        error,
      );
    }
  }

  setTargets(taskId: string, targetContactIds: string[], now?: Date): string[] {
    const uniqueTargetIds = Array.from(
      new Set(targetContactIds.map((id) => id.trim()).filter((id) => id.length > 0)),
    );

    if (uniqueTargetIds.length > 100) {
      throw new SendTaskRepositoryError(
        'setTargets',
        'VALIDATION_ERROR',
        'A send task cannot have more than 100 target contacts.',
      );
    }

    const timestamp = now ?? new Date();

    try {
      return this.client.orm.transaction((tx) => {
        const task = tx.select().from(sendTasks).where(eq(sendTasks.id, taskId)).get();
        if (!task) {
          throw new SendTaskRepositoryError(
            'setTargets',
            'NOT_FOUND',
            `Send task ${taskId} not found.`,
          );
        }

        if (uniqueTargetIds.length > 0) {
          const loadedContacts = tx
            .select()
            .from(contacts)
            .where(inArray(contacts.id, uniqueTargetIds))
            .all();

          if (loadedContacts.length !== uniqueTargetIds.length) {
            throw new SendTaskRepositoryError(
              'setTargets',
              'NOT_FOUND',
              'One or more target contacts do not exist.',
            );
          }

          for (const contact of loadedContacts) {
            if (contact.accountId !== task.accountId) {
              throw new SendTaskRepositoryError(
                'setTargets',
                'ACCOUNT_MISMATCH',
                `Target contact ${contact.id} belongs to account ${contact.accountId}, not task account ${task.accountId}.`,
              );
            }
            if (contact.type !== 'PERSON' && contact.type !== 'GROUP') {
              throw new SendTaskRepositoryError(
                'setTargets',
                'UNSUPPORTED_TARGET_TYPE',
                `Target contact ${contact.id} has unsupported type '${contact.type}'. Only PERSON and GROUP are allowed.`,
              );
            }
          }
        }

        // Only after all validations pass do we delete old targets and insert new targets
        tx.delete(sendTaskTargets).where(eq(sendTaskTargets.taskId, taskId)).run();
        if (uniqueTargetIds.length > 0) {
          tx.insert(sendTaskTargets)
            .values(
              uniqueTargetIds.map((contactId) => ({
                taskId,
                contactId,
                createdAt: timestamp,
              })),
            )
            .run();
        }
        return uniqueTargetIds;
      });
    } catch (error) {
      if (error instanceof SendTaskRepositoryError) {
        throw error;
      }
      throw new SendTaskRepositoryError(
        'setTargets',
        'INTEGRITY_ERROR',
        'Failed to set send task targets.',
        error,
      );
    }
  }

  getTargetContactIds(taskId: string): string[] {
    try {
      const rows = this.client.orm
        .select({ contactId: sendTaskTargets.contactId })
        .from(sendTaskTargets)
        .where(eq(sendTaskTargets.taskId, taskId))
        .orderBy(asc(sendTaskTargets.createdAt))
        .all();
      return rows.map((r) => r.contactId);
    } catch (error) {
      throw new SendTaskRepositoryError(
        'getTargetContactIds',
        'INTEGRITY_ERROR',
        'Failed to get target contact IDs.',
        error,
      );
    }
  }

  disable(id: string, now?: Date): SendTask | undefined {
    const timestamp = now ?? new Date();
    try {
      return this.client.orm
        .update(sendTasks)
        .set({
          enabled: false,
          updatedAt: timestamp,
        })
        .where(eq(sendTasks.id, id))
        .returning()
        .get();
    } catch (error) {
      throw new SendTaskRepositoryError(
        'disable',
        'INTEGRITY_ERROR',
        'Failed to disable send task.',
        error,
      );
    }
  }

  archive(id: string, now?: Date): SendTask | undefined {
    const timestamp = now ?? new Date();
    try {
      return this.client.orm
        .update(sendTasks)
        .set({
          enabled: false,
          archivedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(sendTasks.id, id))
        .returning()
        .get();
    } catch (error) {
      throw new SendTaskRepositoryError(
        'archive',
        'INTEGRITY_ERROR',
        'Failed to archive send task.',
        error,
      );
    }
  }
}
