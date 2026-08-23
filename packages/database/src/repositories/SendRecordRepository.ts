import { randomUUID } from 'node:crypto';

import {
  BusinessDateError,
  parseBusinessDate,
  type BusinessDate,
  type SendRecordStatus,
} from '@sparkkeeper/shared';
import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  dailyRuns,
  friends,
  messageTemplates,
  sendRecords,
  type NewSendRecordRow,
  type SendRecordRow,
} from '../schema/index.js';

export type SendRecord = SendRecordRow;

export interface PrepareSendRecordInput {
  readonly dailyRunId: string;
  readonly friendId: string;
  readonly businessDate: BusinessDate;
  readonly messageTemplateId?: string | null;
  readonly messageText: string;
  readonly now: Date;
}

export type PrepareSendRecordResult =
  | { readonly type: 'PREPARED'; readonly record: SendRecord }
  | { readonly type: 'ALREADY_PREPARED'; readonly record: SendRecord };

export type ClaimSendRecordResult =
  | { readonly type: 'CLAIMED'; readonly record: SendRecord }
  | { readonly type: 'NOT_CLAIMABLE'; readonly record: SendRecord }
  | { readonly type: 'NOT_FOUND' };

export type SendRecordRepositoryErrorCode =
  | 'INVALID_BUSINESS_DATE'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_MESSAGE'
  | 'DAILY_RUN_NOT_FOUND'
  | 'FRIEND_NOT_FOUND'
  | 'MESSAGE_TEMPLATE_NOT_FOUND'
  | 'ACCOUNT_MISMATCH'
  | 'BUSINESS_DATE_MISMATCH'
  | 'SEND_RECORD_NOT_FOUND'
  | 'INVALID_STATE_TRANSITION'
  | 'DATABASE_OPERATION_FAILED';

export class SendRecordRepositoryError extends Error {
  constructor(
    readonly operation:
      | 'prepare'
      | 'findById'
      | 'listByDailyRunId'
      | 'listByFriendId'
      | 'claimForExecution'
      | 'markSuccess'
      | 'markFailed'
      | 'markDeliveryUnknown',
    readonly code: SendRecordRepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SendRecordRepositoryError';
  }
}

export class SendRecordRepository {
  constructor(private readonly client: DatabaseClient) {}

  prepare(input: PrepareSendRecordInput): PrepareSendRecordResult {
    const operation = 'prepare' as const;
    try {
      const businessDate = validateBusinessDate(input.businessDate, operation);
      const now = validateTimestamp(input.now, operation);
      validateMessageText(input.messageText, operation);

      const dailyRun = this.client.orm
        .select()
        .from(dailyRuns)
        .where(eq(dailyRuns.id, input.dailyRunId))
        .get();
      if (dailyRun === undefined) {
        throw new SendRecordRepositoryError(
          operation,
          'DAILY_RUN_NOT_FOUND',
          'Daily run was not found.',
        );
      }

      const friend = this.client.orm
        .select()
        .from(friends)
        .where(eq(friends.id, input.friendId))
        .get();
      if (friend === undefined) {
        throw new SendRecordRepositoryError(operation, 'FRIEND_NOT_FOUND', 'Friend was not found.');
      }
      if (dailyRun.accountId !== friend.accountId) {
        throw new SendRecordRepositoryError(
          operation,
          'ACCOUNT_MISMATCH',
          'Daily run and Friend must belong to the same Account.',
        );
      }
      if (dailyRun.businessDate !== businessDate) {
        throw new SendRecordRepositoryError(
          operation,
          'BUSINESS_DATE_MISMATCH',
          'Send record business date must match its DailyRun.',
        );
      }

      const messageTemplateId = input.messageTemplateId ?? null;
      if (messageTemplateId !== null) {
        const template = this.client.orm
          .select({ id: messageTemplates.id })
          .from(messageTemplates)
          .where(eq(messageTemplates.id, messageTemplateId))
          .get();
        if (template === undefined) {
          throw new SendRecordRepositoryError(
            operation,
            'MESSAGE_TEMPLATE_NOT_FOUND',
            'Message template was not found.',
          );
        }
      }

      const values: NewSendRecordRow = {
        id: randomUUID(),
        dailyRunId: input.dailyRunId,
        friendId: input.friendId,
        businessDate,
        messageTemplateId,
        messageText: input.messageText,
        status: 'READY',
        startedAt: null,
        finishedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const inserted = this.client.orm
        .insert(sendRecords)
        .values(values)
        .onConflictDoNothing({ target: [sendRecords.friendId, sendRecords.businessDate] })
        .returning()
        .get();
      if (inserted !== undefined) {
        return { type: 'PREPARED', record: inserted };
      }

      const existing = this.client.orm
        .select()
        .from(sendRecords)
        .where(
          and(eq(sendRecords.friendId, input.friendId), eq(sendRecords.businessDate, businessDate)),
        )
        .get();
      if (existing === undefined) {
        throw new SendRecordRepositoryError(
          operation,
          'DATABASE_OPERATION_FAILED',
          'Send record prepare completed without a canonical row.',
        );
      }
      return { type: 'ALREADY_PREPARED', record: existing };
    } catch (error) {
      throw sendRecordError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to prepare send record.',
        error,
      );
    }
  }

  findById(id: string): SendRecord | undefined {
    try {
      return this.client.orm.select().from(sendRecords).where(eq(sendRecords.id, id)).get();
    } catch (error) {
      throw sendRecordError(
        'findById',
        'DATABASE_OPERATION_FAILED',
        'Failed to find send record by id.',
        error,
      );
    }
  }

  listByDailyRunId(dailyRunId: string): SendRecord[] {
    try {
      return this.client.orm
        .select()
        .from(sendRecords)
        .where(eq(sendRecords.dailyRunId, dailyRunId))
        .orderBy(asc(sendRecords.createdAt), asc(sendRecords.id))
        .all();
    } catch (error) {
      throw sendRecordError(
        'listByDailyRunId',
        'DATABASE_OPERATION_FAILED',
        'Failed to list send records for daily run.',
        error,
      );
    }
  }

  listByFriendId(friendId: string): SendRecord[] {
    try {
      return this.client.orm
        .select()
        .from(sendRecords)
        .where(eq(sendRecords.friendId, friendId))
        .orderBy(asc(sendRecords.businessDate), asc(sendRecords.createdAt), asc(sendRecords.id))
        .all();
    } catch (error) {
      throw sendRecordError(
        'listByFriendId',
        'DATABASE_OPERATION_FAILED',
        'Failed to list send records for Friend.',
        error,
      );
    }
  }

  claimForExecution(id: string, timestamp: Date): ClaimSendRecordResult {
    const operation = 'claimForExecution' as const;
    try {
      const now = validateTimestamp(timestamp, operation);
      const claimed = this.client.orm
        .update(sendRecords)
        .set({ status: 'RUNNING', startedAt: now, updatedAt: now })
        .where(and(eq(sendRecords.id, id), eq(sendRecords.status, 'READY')))
        .returning()
        .get();
      if (claimed !== undefined) {
        return { type: 'CLAIMED', record: claimed };
      }

      const existing = this.client.orm
        .select()
        .from(sendRecords)
        .where(eq(sendRecords.id, id))
        .get();
      return existing === undefined
        ? { type: 'NOT_FOUND' }
        : { type: 'NOT_CLAIMABLE', record: existing };
    } catch (error) {
      throw sendRecordError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to claim send record.',
        error,
      );
    }
  }

  markSuccess(id: string, now: Date): SendRecord {
    return this.markTerminal(id, 'SUCCESS', now, 'markSuccess');
  }

  markFailed(id: string, now: Date): SendRecord {
    return this.markTerminal(id, 'FAILED', now, 'markFailed');
  }

  markDeliveryUnknown(id: string, now: Date): SendRecord {
    return this.markTerminal(id, 'DELIVERY_UNKNOWN', now, 'markDeliveryUnknown');
  }

  private markTerminal(
    id: string,
    target: Extract<SendRecordStatus, 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN'>,
    timestamp: Date,
    operation: SendRecordRepositoryError['operation'],
  ): SendRecord {
    try {
      const now = validateTimestamp(timestamp, operation);
      const updated = this.client.orm
        .update(sendRecords)
        .set({ status: target, finishedAt: now, updatedAt: now })
        .where(and(eq(sendRecords.id, id), eq(sendRecords.status, 'RUNNING')))
        .returning()
        .get();
      if (updated !== undefined) {
        return updated;
      }

      const existing = this.client.orm
        .select()
        .from(sendRecords)
        .where(eq(sendRecords.id, id))
        .get();
      if (existing === undefined) {
        throw new SendRecordRepositoryError(
          operation,
          'SEND_RECORD_NOT_FOUND',
          'Send record was not found.',
        );
      }
      if (existing.status === target) {
        return existing;
      }
      throw new SendRecordRepositoryError(
        operation,
        'INVALID_STATE_TRANSITION',
        `Send record cannot transition from ${existing.status} to ${target}.`,
      );
    } catch (error) {
      throw sendRecordError(
        operation,
        'DATABASE_OPERATION_FAILED',
        'Failed to update send record state.',
        error,
      );
    }
  }
}

function validateBusinessDate(
  value: BusinessDate,
  operation: SendRecordRepositoryError['operation'],
): BusinessDate {
  try {
    return parseBusinessDate(value);
  } catch (error) {
    throw new SendRecordRepositoryError(
      operation,
      'INVALID_BUSINESS_DATE',
      'Send record business date is invalid.',
      error,
    );
  }
}

function validateTimestamp(value: Date, operation: SendRecordRepositoryError['operation']): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SendRecordRepositoryError(
      operation,
      'INVALID_TIMESTAMP',
      'Send record operation requires a valid timestamp.',
    );
  }
  return value;
}

function validateMessageText(
  value: string,
  operation: SendRecordRepositoryError['operation'],
): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SendRecordRepositoryError(
      operation,
      'INVALID_MESSAGE',
      'Send record message text must be a nonblank string.',
    );
  }
}

function sendRecordError(
  operation: SendRecordRepositoryError['operation'],
  code: SendRecordRepositoryErrorCode,
  fallbackMessage: string,
  error: unknown,
): SendRecordRepositoryError {
  if (error instanceof SendRecordRepositoryError) {
    return error;
  }
  if (error instanceof BusinessDateError) {
    return new SendRecordRepositoryError(operation, 'INVALID_BUSINESS_DATE', error.message, error);
  }
  return new SendRecordRepositoryError(operation, code, fallbackMessage, error);
}
