import { randomUUID } from 'node:crypto';

import {
  isContactIdentityKind,
  isTargetSendFailureCode,
  normalizeOptionalIdentifier,
  parseBusinessDate,
  type BusinessDate,
  type ContactIdentityKind,
  type TargetSendFailureCode,
  type TargetSendMachineStatus,
} from '@sparkkeeper/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  targetSendRecords,
  type NewTargetSendRecordRow,
  type TargetSendRecordRow,
} from '../schema/index.js';

export type TargetSendRecord = TargetSendRecordRow;

export const TERMINAL_TARGET_SEND_STATUSES: readonly TargetSendMachineStatus[] = [
  'SUCCESS',
  'FAILED',
  'DELIVERY_UNKNOWN',
  'SKIPPED',
] as const;

export const DELIVERY_UNKNOWN_FAILURE_CODES: readonly TargetSendFailureCode[] = [
  'DELIVERY_VERIFICATION_TIMEOUT',
  'DELIVERY_EVIDENCE_INSUFFICIENT',
  'PAGE_CLOSED_AFTER_ACTION',
  'NAVIGATION_AFTER_ACTION',
  'AUTH_STATE_CHANGED_AFTER_ACTION',
  'PROCESS_INTERRUPTED_AFTER_ACTION',
] as const;

export type ClaimTargetSendRecordResult =
  | { readonly type: 'CLAIMED'; readonly record: TargetSendRecord }
  | { readonly type: 'NOT_CLAIMABLE' };

export interface CreateTargetSendRecordInput {
  readonly runId: string;
  readonly taskId?: string | null;
  readonly contactId: string;
  readonly businessDate?: BusinessDate | string | null;
  readonly templateId?: string | null;
  readonly messageText: string;
  readonly targetIdentityKindSnapshot: ContactIdentityKind;
  readonly targetIdentityValueDigest: string;
  readonly now?: Date;
}

export class TargetSendRecordRepositoryError extends RepositoryError {
  readonly recordOperation:
    | 'create'
    | 'findById'
    | 'findByRunAndContact'
    | 'findByTaskContactAndBusinessDate'
    | 'listByRunId'
    | 'listByContactId'
    | 'claimForExecution'
    | 'recordSendActionStarted'
    | 'markSuccess'
    | 'markFailed'
    | 'scheduleRetry'
    | 'markDeliveryUnknown'
    | 'markSkipped';

  constructor(
    operation: TargetSendRecordRepositoryError['recordOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'TargetSendRecord', operation, cause });
    this.name = 'TargetSendRecordRepositoryError';
    this.recordOperation = operation;
  }
}

export class TargetSendRecordRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateTargetSendRecordInput): TargetSendRecord {
    const runId = input.runId.trim();
    const contactId = input.contactId.trim();
    const messageText = input.messageText.trim();
    const targetIdentityValueDigest = input.targetIdentityValueDigest.trim();

    if (runId.length === 0) {
      throw new TargetSendRecordRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'runId must not be empty.',
      );
    }
    if (contactId.length === 0) {
      throw new TargetSendRecordRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'contactId must not be empty.',
      );
    }
    if (messageText.length === 0) {
      throw new TargetSendRecordRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'messageText must not be empty.',
      );
    }
    if (targetIdentityValueDigest.length === 0) {
      throw new TargetSendRecordRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'targetIdentityValueDigest must not be empty.',
      );
    }
    if (!isContactIdentityKind(input.targetIdentityKindSnapshot)) {
      throw new TargetSendRecordRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid targetIdentityKindSnapshot.',
      );
    }

    const taskId = normalizeOptionalIdentifier(input.taskId);
    const templateId = normalizeOptionalIdentifier(input.templateId);
    let businessDateStr: string | null = null;
    if (input.businessDate !== undefined && input.businessDate !== null) {
      businessDateStr = parseBusinessDate(input.businessDate);
    }

    const now = input.now ?? new Date();
    const values: NewTargetSendRecordRow = {
      id: randomUUID(),
      runId,
      taskId,
      contactId,
      businessDate: businessDateStr,
      templateId,
      messageText,
      targetIdentityKindSnapshot: input.targetIdentityKindSnapshot,
      targetIdentityValueDigest,
      machineStatus: 'READY',
      attemptCount: 0,
      nextRetryAt: null,
      failureCode: null,
      sendActionStartedAt: null,
      sentAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      return this.client.orm.insert(targetSendRecords).values(values).returning().get();
    } catch (error) {
      throw new TargetSendRecordRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create target send record.',
        error,
      );
    }
  }

  findById(id: string): TargetSendRecord | undefined {
    try {
      return this.client.orm
        .select()
        .from(targetSendRecords)
        .where(eq(targetSendRecords.id, id))
        .get();
    } catch (error) {
      throw new TargetSendRecordRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find target send record by id.',
        error,
      );
    }
  }

  findByRunAndContact(runId: string, contactId: string): TargetSendRecord | undefined {
    const trimmedRun = runId.trim();
    const trimmedContact = contactId.trim();
    if (trimmedRun.length === 0 || trimmedContact.length === 0) {
      throw new TargetSendRecordRepositoryError(
        'findByRunAndContact',
        'VALIDATION_ERROR',
        'runId and contactId must not be empty.',
      );
    }

    try {
      return this.client.orm
        .select()
        .from(targetSendRecords)
        .where(
          and(
            eq(targetSendRecords.runId, trimmedRun),
            eq(targetSendRecords.contactId, trimmedContact),
          ),
        )
        .get();
    } catch (error) {
      throw new TargetSendRecordRepositoryError(
        'findByRunAndContact',
        'INTEGRITY_ERROR',
        'Failed to find target send record.',
        error,
      );
    }
  }

  findByTaskContactAndBusinessDate(
    taskId: string,
    contactId: string,
    businessDate: BusinessDate | string,
  ): TargetSendRecord | undefined {
    const trimmedTask = taskId.trim();
    const trimmedContact = contactId.trim();
    if (trimmedTask.length === 0 || trimmedContact.length === 0) {
      throw new TargetSendRecordRepositoryError(
        'findByTaskContactAndBusinessDate',
        'VALIDATION_ERROR',
        'taskId and contactId must not be empty.',
      );
    }

    const dateStr = parseBusinessDate(businessDate);

    try {
      return this.client.orm
        .select()
        .from(targetSendRecords)
        .where(
          and(
            eq(targetSendRecords.taskId, trimmedTask),
            eq(targetSendRecords.contactId, trimmedContact),
            eq(targetSendRecords.businessDate, dateStr),
          ),
        )
        .get();
    } catch (error) {
      throw new TargetSendRecordRepositoryError(
        'findByTaskContactAndBusinessDate',
        'INTEGRITY_ERROR',
        'Failed to find target send record.',
        error,
      );
    }
  }

  listByRunId(runId: string, options?: { limit?: number; offset?: number }): TargetSendRecord[] {
    const trimmedRun = runId.trim();
    if (trimmedRun.length === 0) {
      throw new TargetSendRecordRepositoryError(
        'listByRunId',
        'VALIDATION_ERROR',
        'runId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(targetSendRecords)
        .where(eq(targetSendRecords.runId, trimmedRun))
        .orderBy(asc(targetSendRecords.createdAt), asc(targetSendRecords.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new TargetSendRecordRepositoryError(
        'listByRunId',
        'INTEGRITY_ERROR',
        'Failed to list target send records.',
        error,
      );
    }
  }

  listByContactId(
    contactId: string,
    options?: { limit?: number; offset?: number },
  ): TargetSendRecord[] {
    const trimmedContact = contactId.trim();
    if (trimmedContact.length === 0) {
      throw new TargetSendRecordRepositoryError(
        'listByContactId',
        'VALIDATION_ERROR',
        'contactId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(targetSendRecords)
        .where(eq(targetSendRecords.contactId, trimmedContact))
        .orderBy(desc(targetSendRecords.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new TargetSendRecordRepositoryError(
        'listByContactId',
        'INTEGRITY_ERROR',
        'Failed to list target send records.',
        error,
      );
    }
  }

  claimForExecution(id: string, now?: Date): ClaimTargetSendRecordResult {
    const timestamp = now ?? new Date();
    try {
      const record = this.client.orm
        .update(targetSendRecords)
        .set({
          machineStatus: 'RUNNING',
          attemptCount: sql`${targetSendRecords.attemptCount} + 1`,
          startedAt: timestamp,
          nextRetryAt: null,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(targetSendRecords.id, id),
            inArray(targetSendRecords.machineStatus, ['READY', 'RETRY_WAIT']),
          ),
        )
        .returning()
        .get();

      if (record) {
        return { type: 'CLAIMED', record };
      }
      return { type: 'NOT_CLAIMABLE' };
    } catch (error) {
      throw new TargetSendRecordRepositoryError(
        'claimForExecution',
        'INTEGRITY_ERROR',
        'Failed to claim target send record for execution.',
        error,
      );
    }
  }

  recordSendActionStarted(id: string, actionTimestamp?: Date, now?: Date): TargetSendRecord {
    const timestamp = now ?? new Date();
    const actionStartedAt = actionTimestamp ?? timestamp;

    try {
      const record = this.client.orm
        .update(targetSendRecords)
        .set({
          sendActionStartedAt: actionStartedAt,
          updatedAt: timestamp,
        })
        .where(and(eq(targetSendRecords.id, id), eq(targetSendRecords.machineStatus, 'RUNNING')))
        .returning()
        .get();

      if (record) return record;

      const existing = this.findById(id);
      if (!existing) {
        throw new TargetSendRecordRepositoryError(
          'recordSendActionStarted',
          'NOT_FOUND',
          `Target send record '${id}' not found.`,
        );
      }
      if (TERMINAL_TARGET_SEND_STATUSES.includes(existing.machineStatus)) {
        throw new TargetSendRecordRepositoryError(
          'recordSendActionStarted',
          'TERMINAL_STATE',
          `Target send record is in terminal state '${existing.machineStatus}'.`,
        );
      }
      throw new TargetSendRecordRepositoryError(
        'recordSendActionStarted',
        'INVALID_TRANSITION',
        `Cannot record send action for record in status '${existing.machineStatus}'.`,
      );
    } catch (error) {
      if (error instanceof TargetSendRecordRepositoryError) throw error;
      throw new TargetSendRecordRepositoryError(
        'recordSendActionStarted',
        'INTEGRITY_ERROR',
        'Failed to record send action started.',
        error,
      );
    }
  }

  markSuccess(
    id: string,
    options: { sentAt: Date; finishedAt?: Date; now?: Date },
  ): TargetSendRecord {
    const now = options.now ?? new Date();
    const finishedAt = options.finishedAt ?? now;

    try {
      const record = this.client.orm
        .update(targetSendRecords)
        .set({
          machineStatus: 'SUCCESS',
          sentAt: options.sentAt,
          finishedAt,
          failureCode: null,
          nextRetryAt: null,
          updatedAt: now,
        })
        .where(and(eq(targetSendRecords.id, id), eq(targetSendRecords.machineStatus, 'RUNNING')))
        .returning()
        .get();

      if (record) return record;

      const existing = this.findById(id);
      if (!existing) {
        throw new TargetSendRecordRepositoryError(
          'markSuccess',
          'NOT_FOUND',
          `Target send record '${id}' not found.`,
        );
      }
      if (TERMINAL_TARGET_SEND_STATUSES.includes(existing.machineStatus)) {
        throw new TargetSendRecordRepositoryError(
          'markSuccess',
          'TERMINAL_STATE',
          `Cannot mark success on terminal record in status '${existing.machineStatus}'.`,
        );
      }
      throw new TargetSendRecordRepositoryError(
        'markSuccess',
        'INVALID_TRANSITION',
        `Cannot mark success for record in status '${existing.machineStatus}'.`,
      );
    } catch (error) {
      if (error instanceof TargetSendRecordRepositoryError) throw error;
      throw new TargetSendRecordRepositoryError(
        'markSuccess',
        'INTEGRITY_ERROR',
        'Failed to mark target send record success.',
        error,
      );
    }
  }

  markFailed(
    id: string,
    options: { failureCode: TargetSendFailureCode; finishedAt?: Date; now?: Date },
  ): TargetSendRecord {
    if (!isTargetSendFailureCode(options.failureCode)) {
      throw new TargetSendRecordRepositoryError(
        'markFailed',
        'VALIDATION_ERROR',
        'Invalid failure code.',
      );
    }

    const now = options.now ?? new Date();
    const finishedAt = options.finishedAt ?? now;

    try {
      const record = this.client.orm
        .update(targetSendRecords)
        .set({
          machineStatus: 'FAILED',
          failureCode: options.failureCode,
          finishedAt,
          nextRetryAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(targetSendRecords.id, id),
            inArray(targetSendRecords.machineStatus, ['RUNNING', 'RETRY_WAIT']),
            isNull(targetSendRecords.sendActionStartedAt),
          ),
        )
        .returning()
        .get();

      if (record) return record;

      const existing = this.findById(id);
      if (!existing) {
        throw new TargetSendRecordRepositoryError(
          'markFailed',
          'NOT_FOUND',
          `Target send record '${id}' not found.`,
        );
      }
      if (existing.sendActionStartedAt !== null) {
        throw new TargetSendRecordRepositoryError(
          'markFailed',
          'INVALID_TRANSITION',
          'Cannot mark failed after send action has started. Use DELIVERY_UNKNOWN or record SUCCESS.',
        );
      }
      if (TERMINAL_TARGET_SEND_STATUSES.includes(existing.machineStatus)) {
        throw new TargetSendRecordRepositoryError(
          'markFailed',
          'TERMINAL_STATE',
          `Cannot mark failed on terminal record in status '${existing.machineStatus}'.`,
        );
      }
      throw new TargetSendRecordRepositoryError(
        'markFailed',
        'INVALID_TRANSITION',
        `Cannot mark failed for record in status '${existing.machineStatus}'.`,
      );
    } catch (error) {
      if (error instanceof TargetSendRecordRepositoryError) throw error;
      throw new TargetSendRecordRepositoryError(
        'markFailed',
        'INTEGRITY_ERROR',
        'Failed to mark target send record failed.',
        error,
      );
    }
  }

  scheduleRetry(
    id: string,
    options: { nextRetryAt: Date; failureCode?: TargetSendFailureCode; now?: Date },
  ): TargetSendRecord {
    if (options.failureCode !== undefined && !isTargetSendFailureCode(options.failureCode)) {
      throw new TargetSendRecordRepositoryError(
        'scheduleRetry',
        'VALIDATION_ERROR',
        'Invalid failure code.',
      );
    }

    const now = options.now ?? new Date();
    if (options.nextRetryAt <= now) {
      throw new TargetSendRecordRepositoryError(
        'scheduleRetry',
        'VALIDATION_ERROR',
        'nextRetryAt must be in the future.',
      );
    }

    try {
      // Forbidden if send action has already started!
      const record = this.client.orm
        .update(targetSendRecords)
        .set({
          machineStatus: 'RETRY_WAIT',
          nextRetryAt: options.nextRetryAt,
          failureCode: options.failureCode ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(targetSendRecords.id, id),
            eq(targetSendRecords.machineStatus, 'RUNNING'),
            isNull(targetSendRecords.sendActionStartedAt),
          ),
        )
        .returning()
        .get();

      if (record) return record;

      const existing = this.findById(id);
      if (!existing) {
        throw new TargetSendRecordRepositoryError(
          'scheduleRetry',
          'NOT_FOUND',
          `Target send record '${id}' not found.`,
        );
      }
      if (existing.sendActionStartedAt !== null) {
        throw new TargetSendRecordRepositoryError(
          'scheduleRetry',
          'INVALID_TRANSITION',
          'Cannot schedule retry after send action has started.',
        );
      }
      if (TERMINAL_TARGET_SEND_STATUSES.includes(existing.machineStatus)) {
        throw new TargetSendRecordRepositoryError(
          'scheduleRetry',
          'TERMINAL_STATE',
          `Cannot schedule retry on terminal record in status '${existing.machineStatus}'.`,
        );
      }
      throw new TargetSendRecordRepositoryError(
        'scheduleRetry',
        'INVALID_TRANSITION',
        `Cannot schedule retry for record in status '${existing.machineStatus}'.`,
      );
    } catch (error) {
      if (error instanceof TargetSendRecordRepositoryError) throw error;
      throw new TargetSendRecordRepositoryError(
        'scheduleRetry',
        'INTEGRITY_ERROR',
        'Failed to schedule retry for target send record.',
        error,
      );
    }
  }

  markDeliveryUnknown(
    id: string,
    options?: { failureCode?: TargetSendFailureCode; finishedAt?: Date; now?: Date },
  ): TargetSendRecord {
    const failureCode: TargetSendFailureCode =
      options?.failureCode ?? 'DELIVERY_VERIFICATION_TIMEOUT';
    if (!DELIVERY_UNKNOWN_FAILURE_CODES.includes(failureCode)) {
      throw new TargetSendRecordRepositoryError(
        'markDeliveryUnknown',
        'VALIDATION_ERROR',
        `Invalid failureCode '${failureCode}' for DELIVERY_UNKNOWN. Allowed: ${DELIVERY_UNKNOWN_FAILURE_CODES.join(', ')}`,
      );
    }

    const now = options?.now ?? new Date();
    const finishedAt = options?.finishedAt ?? now;

    try {
      return this.client.orm.transaction((tx) => {
        const current = tx
          .select()
          .from(targetSendRecords)
          .where(eq(targetSendRecords.id, id))
          .get();

        if (!current) {
          throw new TargetSendRecordRepositoryError(
            'markDeliveryUnknown',
            'NOT_FOUND',
            `Target send record '${id}' not found.`,
          );
        }
        if (TERMINAL_TARGET_SEND_STATUSES.includes(current.machineStatus)) {
          throw new TargetSendRecordRepositoryError(
            'markDeliveryUnknown',
            'TERMINAL_STATE',
            `Cannot mark delivery unknown on terminal record in status '${current.machineStatus}'.`,
          );
        }
        if (current.sendActionStartedAt === null) {
          throw new TargetSendRecordRepositoryError(
            'markDeliveryUnknown',
            'INVALID_TRANSITION',
            'Cannot mark delivery unknown before send action has started.',
          );
        }
        if (current.machineStatus !== 'RUNNING') {
          throw new TargetSendRecordRepositoryError(
            'markDeliveryUnknown',
            'INVALID_TRANSITION',
            `Cannot mark delivery unknown for record in status '${current.machineStatus}'.`,
          );
        }

        return tx
          .update(targetSendRecords)
          .set({
            machineStatus: 'DELIVERY_UNKNOWN',
            failureCode,
            finishedAt,
            nextRetryAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(targetSendRecords.id, id),
              eq(targetSendRecords.machineStatus, 'RUNNING'),
              sql`${targetSendRecords.sendActionStartedAt} is not null`,
            ),
          )
          .returning()
          .get();
      });
    } catch (error) {
      if (error instanceof TargetSendRecordRepositoryError) throw error;
      throw new TargetSendRecordRepositoryError(
        'markDeliveryUnknown',
        'INTEGRITY_ERROR',
        'Failed to mark target send record delivery unknown.',
        error,
      );
    }
  }

  markSkipped(
    id: string,
    options?: { failureCode?: TargetSendFailureCode; finishedAt?: Date; now?: Date },
  ): TargetSendRecord {
    const failureCode: TargetSendFailureCode = options?.failureCode ?? 'BATCH_ABORTED';
    if (!isTargetSendFailureCode(failureCode)) {
      throw new TargetSendRecordRepositoryError(
        'markSkipped',
        'VALIDATION_ERROR',
        'Invalid failure code for skipped record.',
      );
    }

    const now = options?.now ?? new Date();
    const finishedAt = options?.finishedAt ?? now;

    try {
      const record = this.client.orm
        .update(targetSendRecords)
        .set({
          machineStatus: 'SKIPPED',
          failureCode,
          finishedAt,
          nextRetryAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(targetSendRecords.id, id),
            inArray(targetSendRecords.machineStatus, ['READY', 'RETRY_WAIT']),
          ),
        )
        .returning()
        .get();

      if (record) return record;

      const existing = this.findById(id);
      if (!existing) {
        throw new TargetSendRecordRepositoryError(
          'markSkipped',
          'NOT_FOUND',
          `Target send record '${id}' not found.`,
        );
      }
      if (TERMINAL_TARGET_SEND_STATUSES.includes(existing.machineStatus)) {
        throw new TargetSendRecordRepositoryError(
          'markSkipped',
          'TERMINAL_STATE',
          `Cannot mark skipped on terminal record in status '${existing.machineStatus}'.`,
        );
      }
      throw new TargetSendRecordRepositoryError(
        'markSkipped',
        'INVALID_TRANSITION',
        `Cannot mark skipped for record in status '${existing.machineStatus}'.`,
      );
    } catch (error) {
      if (error instanceof TargetSendRecordRepositoryError) throw error;
      throw new TargetSendRecordRepositoryError(
        'markSkipped',
        'INTEGRITY_ERROR',
        'Failed to mark target send record skipped.',
        error,
      );
    }
  }
}
