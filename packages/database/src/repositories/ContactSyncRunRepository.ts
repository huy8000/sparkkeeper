import { randomUUID } from 'node:crypto';

import {
  isContactSyncFailureCode,
  isContactSyncRunStatus,
  type ContactSyncFailureCode,
  type ContactSyncRunStatus,
} from '@sparkkeeper/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  contactSyncRuns,
  type ContactSyncRunRow,
  type NewContactSyncRunRow,
} from '../schema/index.js';

export type ContactSyncRun = ContactSyncRunRow;

export const TERMINAL_CONTACT_SYNC_STATUSES: readonly ContactSyncRunStatus[] = [
  'COMPLETE',
  'PARTIAL',
  'FAILED',
  'AUTH_EXPIRED',
] as const;

export const ALLOWED_CONTACT_SYNC_TRANSITIONS: Readonly<
  Record<ContactSyncRunStatus, readonly ContactSyncRunStatus[]>
> = {
  PENDING: ['RUNNING', 'FAILED', 'AUTH_EXPIRED'],
  RUNNING: ['COMPLETE', 'PARTIAL', 'FAILED', 'AUTH_EXPIRED'],
  COMPLETE: [],
  PARTIAL: [],
  FAILED: [],
  AUTH_EXPIRED: [],
};

export interface CreateContactSyncRunInput {
  readonly accountId: string;
  readonly requestedByAdminUserId: string;
  readonly now?: Date | undefined;
}

export interface UpdateContactSyncRunInput {
  readonly status?: ContactSyncRunStatus | undefined;
  readonly isComplete?: boolean | undefined;
  readonly candidateCount?: number | undefined;
  readonly createdCount?: number | undefined;
  readonly updatedCount?: number | undefined;
  readonly staleCount?: number | undefined;
  readonly unavailableCount?: number | undefined;
  readonly issueCount?: number | undefined;
  readonly failureCode?: ContactSyncFailureCode | null | undefined;
  readonly startedAt?: Date | null | undefined;
  readonly finishedAt?: Date | null | undefined;
  readonly now?: Date | undefined;
}

export interface TransitionContactSyncRunOptions {
  readonly isComplete?: boolean | undefined;
  readonly candidateCount?: number | undefined;
  readonly createdCount?: number | undefined;
  readonly updatedCount?: number | undefined;
  readonly staleCount?: number | undefined;
  readonly unavailableCount?: number | undefined;
  readonly issueCount?: number | undefined;
  readonly failureCode?: ContactSyncFailureCode | null | undefined;
  readonly startedAt?: Date | null | undefined;
  readonly finishedAt?: Date | null | undefined;
  readonly now?: Date | undefined;
}

export class ContactSyncRunRepositoryError extends RepositoryError {
  readonly syncOperation:
    'create' | 'findById' | 'findLatestByAccountId' | 'update' | 'transition' | 'listByAccountId';

  constructor(
    operation: ContactSyncRunRepositoryError['syncOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'ContactSyncRun', operation, cause });
    this.name = 'ContactSyncRunRepositoryError';
    this.syncOperation = operation;
  }
}

export class ContactSyncRunRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateContactSyncRunInput): ContactSyncRun {
    const accountId = input.accountId.trim();
    const requestedByAdminUserId = input.requestedByAdminUserId.trim();

    if (accountId.length === 0) {
      throw new ContactSyncRunRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    if (requestedByAdminUserId.length === 0) {
      throw new ContactSyncRunRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'requestedByAdminUserId must not be empty.',
      );
    }

    const now = input.now ?? new Date();
    const values: NewContactSyncRunRow = {
      id: randomUUID(),
      accountId,
      requestedByAdminUserId,
      status: 'PENDING',
      isComplete: false,
      candidateCount: 0,
      createdCount: 0,
      updatedCount: 0,
      staleCount: 0,
      unavailableCount: 0,
      issueCount: 0,
      failureCode: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      return this.client.orm.insert(contactSyncRuns).values(values).returning().get();
    } catch (error) {
      throw new ContactSyncRunRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create contact sync run.',
        error,
      );
    }
  }

  findById(id: string): ContactSyncRun | undefined {
    try {
      return this.client.orm.select().from(contactSyncRuns).where(eq(contactSyncRuns.id, id)).get();
    } catch (error) {
      throw new ContactSyncRunRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find contact sync run by id.',
        error,
      );
    }
  }

  findLatestByAccountId(accountId: string): ContactSyncRun | undefined {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new ContactSyncRunRepositoryError(
        'findLatestByAccountId',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }

    try {
      return this.client.orm
        .select()
        .from(contactSyncRuns)
        .where(eq(contactSyncRuns.accountId, trimmed))
        .orderBy(desc(contactSyncRuns.createdAt))
        .limit(1)
        .get();
    } catch (error) {
      throw new ContactSyncRunRepositoryError(
        'findLatestByAccountId',
        'INTEGRITY_ERROR',
        'Failed to find latest contact sync run.',
        error,
      );
    }
  }

  transition(
    id: string,
    targetStatus: ContactSyncRunStatus,
    options?: TransitionContactSyncRunOptions,
  ): ContactSyncRun {
    if (!isContactSyncRunStatus(targetStatus)) {
      throw new ContactSyncRunRepositoryError(
        'transition',
        'VALIDATION_ERROR',
        'Invalid target contact sync run status.',
      );
    }

    const now = options?.now ?? new Date();

    const legalPredecessors = (
      Object.keys(ALLOWED_CONTACT_SYNC_TRANSITIONS) as ContactSyncRunStatus[]
    ).filter((source) => ALLOWED_CONTACT_SYNC_TRANSITIONS[source].includes(targetStatus));

    if (legalPredecessors.length === 0) {
      throw new ContactSyncRunRepositoryError(
        'transition',
        'INVALID_TRANSITION',
        `No valid transition path to status '${targetStatus}'.`,
      );
    }

    const values: Partial<NewContactSyncRunRow> = {
      status: targetStatus,
      updatedAt: now,
    };

    if (options?.isComplete !== undefined) {
      values.isComplete = options.isComplete;
    }
    if (options?.candidateCount !== undefined) {
      if (
        !Number.isInteger(options.candidateCount) ||
        options.candidateCount < 0 ||
        options.candidateCount > 500
      ) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'VALIDATION_ERROR',
          'candidateCount must be between 0 and 500.',
        );
      }
      values.candidateCount = options.candidateCount;
    }
    if (options?.createdCount !== undefined) {
      if (
        !Number.isInteger(options.createdCount) ||
        options.createdCount < 0 ||
        options.createdCount > 500
      ) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'VALIDATION_ERROR',
          'createdCount must be between 0 and 500.',
        );
      }
      values.createdCount = options.createdCount;
    }
    if (options?.updatedCount !== undefined) {
      if (
        !Number.isInteger(options.updatedCount) ||
        options.updatedCount < 0 ||
        options.updatedCount > 500
      ) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'VALIDATION_ERROR',
          'updatedCount must be between 0 and 500.',
        );
      }
      values.updatedCount = options.updatedCount;
    }
    if (options?.staleCount !== undefined) {
      if (
        !Number.isInteger(options.staleCount) ||
        options.staleCount < 0 ||
        options.staleCount > 500
      ) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'VALIDATION_ERROR',
          'staleCount must be between 0 and 500.',
        );
      }
      values.staleCount = options.staleCount;
    }
    if (options?.unavailableCount !== undefined) {
      if (
        !Number.isInteger(options.unavailableCount) ||
        options.unavailableCount < 0 ||
        options.unavailableCount > 500
      ) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'VALIDATION_ERROR',
          'unavailableCount must be between 0 and 500.',
        );
      }
      values.unavailableCount = options.unavailableCount;
    }
    if (options?.issueCount !== undefined) {
      if (
        !Number.isInteger(options.issueCount) ||
        options.issueCount < 0 ||
        options.issueCount > 500
      ) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'VALIDATION_ERROR',
          'issueCount must be between 0 and 500.',
        );
      }
      values.issueCount = options.issueCount;
    }
    if (options?.failureCode !== undefined) {
      if (options.failureCode !== null && !isContactSyncFailureCode(options.failureCode)) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'VALIDATION_ERROR',
          'Invalid failure code.',
        );
      }
      values.failureCode = options.failureCode;
    }
    if (options?.startedAt !== undefined) {
      values.startedAt = options.startedAt;
    }
    if (options?.finishedAt !== undefined) {
      values.finishedAt = options.finishedAt;
    }

    if (targetStatus === 'RUNNING' && values.startedAt === undefined) {
      values.startedAt = now;
    }
    if (targetStatus === 'COMPLETE') {
      values.isComplete = true;
      values.failureCode = null;
      if (values.finishedAt === undefined) values.finishedAt = now;
    }
    if (['PARTIAL', 'FAILED', 'AUTH_EXPIRED'].includes(targetStatus)) {
      values.isComplete = false;
      if (values.failureCode === undefined && targetStatus === 'AUTH_EXPIRED') {
        values.failureCode = 'AUTH_EXPIRED';
      }
      if (values.finishedAt === undefined) values.finishedAt = now;
    }

    try {
      const record = this.client.orm
        .update(contactSyncRuns)
        .set(values)
        .where(
          and(eq(contactSyncRuns.id, id), inArray(contactSyncRuns.status, [...legalPredecessors])),
        )
        .returning()
        .get();

      if (record) return record;

      const existing = this.findById(id);
      if (!existing) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'NOT_FOUND',
          `Contact sync run '${id}' not found.`,
        );
      }
      if (TERMINAL_CONTACT_SYNC_STATUSES.includes(existing.status)) {
        throw new ContactSyncRunRepositoryError(
          'transition',
          'TERMINAL_STATE',
          `Cannot transition from terminal status '${existing.status}'.`,
        );
      }
      throw new ContactSyncRunRepositoryError(
        'transition',
        'INVALID_TRANSITION',
        `Cannot transition contact sync run '${id}' from '${existing.status}' to '${targetStatus}'.`,
      );
    } catch (error) {
      if (error instanceof ContactSyncRunRepositoryError) throw error;
      throw new ContactSyncRunRepositoryError(
        'transition',
        'INTEGRITY_ERROR',
        'Failed to transition contact sync run status.',
        error,
      );
    }
  }

  markRunning(
    id: string,
    options?: { startedAt?: Date | undefined; now?: Date | undefined },
  ): ContactSyncRun {
    return this.transition(id, 'RUNNING', options);
  }

  markComplete(
    id: string,
    options?: {
      candidateCount?: number | undefined;
      createdCount?: number | undefined;
      updatedCount?: number | undefined;
      staleCount?: number | undefined;
      unavailableCount?: number | undefined;
      issueCount?: number | undefined;
      finishedAt?: Date | undefined;
      now?: Date | undefined;
    },
  ): ContactSyncRun {
    return this.transition(id, 'COMPLETE', { ...options, isComplete: true });
  }

  markPartial(
    id: string,
    failureCode: ContactSyncFailureCode,
    options?: {
      candidateCount?: number | undefined;
      createdCount?: number | undefined;
      updatedCount?: number | undefined;
      staleCount?: number | undefined;
      unavailableCount?: number | undefined;
      issueCount?: number | undefined;
      finishedAt?: Date | undefined;
      now?: Date | undefined;
    },
  ): ContactSyncRun {
    return this.transition(id, 'PARTIAL', { ...options, failureCode });
  }

  markFailed(
    id: string,
    failureCode: ContactSyncFailureCode,
    options?: { finishedAt?: Date | undefined; now?: Date | undefined },
  ): ContactSyncRun {
    return this.transition(id, 'FAILED', { ...options, failureCode });
  }

  markAuthExpired(
    id: string,
    options?: { finishedAt?: Date | undefined; now?: Date | undefined },
  ): ContactSyncRun {
    return this.transition(id, 'AUTH_EXPIRED', { ...options, failureCode: 'AUTH_EXPIRED' });
  }

  update(
    id: string,
    input: TransitionContactSyncRunOptions & { status?: ContactSyncRunStatus },
  ): ContactSyncRun | undefined {
    if (input.status !== undefined) {
      return this.transition(id, input.status, input);
    }
    const existing = this.findById(id);
    if (!existing) return undefined;
    return this.transition(id, existing.status, input);
  }

  listByAccountId(
    accountId: string,
    options?: { limit?: number; offset?: number },
  ): ContactSyncRun[] {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new ContactSyncRunRepositoryError(
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
        .from(contactSyncRuns)
        .where(eq(contactSyncRuns.accountId, trimmed))
        .orderBy(desc(contactSyncRuns.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new ContactSyncRunRepositoryError(
        'listByAccountId',
        'INTEGRITY_ERROR',
        'Failed to list contact sync runs.',
        error,
      );
    }
  }
}
