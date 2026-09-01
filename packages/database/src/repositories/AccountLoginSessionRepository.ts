import { randomUUID } from 'node:crypto';

import {
  isAccountLoginFailureCode,
  isAccountLoginPurpose,
  normalizeOptionalIdentifier,
  type AccountLoginFailureCode,
  type AccountLoginPurpose,
  type AccountLoginSessionStatus,
} from '@sparkkeeper/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import { signalAccountLoginSessionContentionObserved } from '../internal/contentionProbe.js';
import {
  accountLoginSessions,
  type AccountLoginSessionRow,
  type NewAccountLoginSessionRow,
} from '../schema/index.js';

export type AccountLoginSession = AccountLoginSessionRow;

export const ACTIVE_LOGIN_SESSION_STATUSES: readonly AccountLoginSessionStatus[] = [
  'PENDING',
  'STARTING',
  'AWAITING_USER',
  'READY_DETECTED',
  'COMPLETING',
] as const;

export const TERMINAL_LOGIN_SESSION_STATUSES: readonly AccountLoginSessionStatus[] = [
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'FAILED',
] as const;

export const ALLOWED_LOGIN_SESSION_TRANSITIONS: Readonly<
  Record<AccountLoginSessionStatus, readonly AccountLoginSessionStatus[]>
> = {
  PENDING: ['STARTING', 'CANCELLED', 'EXPIRED', 'FAILED'],
  STARTING: ['AWAITING_USER', 'CANCELLED', 'EXPIRED', 'FAILED'],
  AWAITING_USER: ['READY_DETECTED', 'CANCELLED', 'EXPIRED', 'FAILED'],
  READY_DETECTED: ['COMPLETING', 'FAILED'],
  COMPLETING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
};

export interface CreateAccountLoginSessionInput {
  readonly purpose: AccountLoginPurpose;
  readonly accountId?: string | null;
  readonly pendingAccountId?: string | null;
  readonly createdByAdminUserId: string;
  readonly expiresAt: Date;
  readonly now?: Date;
}

export class AccountLoginSessionRepositoryError extends RepositoryError {
  readonly loginOperation:
    | 'create'
    | 'findById'
    | 'findActive'
    | 'findActiveByAccountId'
    | 'markStarting'
    | 'markAwaitingUser'
    | 'markReadyDetected'
    | 'markCompleting'
    | 'markCompleted'
    | 'markCancelled'
    | 'markExpired'
    | 'markFailed'
    | 'listRecent';

  constructor(
    operation: AccountLoginSessionRepositoryError['loginOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'AccountLoginSession', operation, cause });
    this.name = 'AccountLoginSessionRepositoryError';
    this.loginOperation = operation;
  }
}

export const LOGIN_SESSION_CONTENTION_DEADLINE_MS = 500;
export const LOGIN_SESSION_CONTENTION_ATTEMPT_TIMEOUT_MS = 50;
export const LOGIN_SESSION_CONTENTION_RETRY_INTERVAL_MS = 25;

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (
    typeof err.code === 'string' &&
    (err.code === 'SQLITE_BUSY' ||
      err.code === 'SQLITE_BUSY_SNAPSHOT' ||
      err.code === 'SQLITE_LOCKED')
  ) {
    return true;
  }
  if (
    typeof err.message === 'string' &&
    (err.message.startsWith('SqliteError: database is locked') ||
      err.message.startsWith('SqliteError: SQLITE_BUSY') ||
      err.message.startsWith('SqliteError: SQLITE_LOCKED'))
  ) {
    return true;
  }
  if (err.cause && err.cause !== error) {
    return isSqliteBusyError(err.cause);
  }
  return false;
}

function syncSleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class AccountLoginSessionRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateAccountLoginSessionInput): AccountLoginSession {
    if (!isAccountLoginPurpose(input.purpose)) {
      throw new AccountLoginSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid account login purpose.',
      );
    }

    const createdByAdminUserId = input.createdByAdminUserId.trim();
    if (createdByAdminUserId.length === 0) {
      throw new AccountLoginSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'createdByAdminUserId must not be empty.',
      );
    }

    const accountId = normalizeOptionalIdentifier(input.accountId);
    const pendingAccountId = normalizeOptionalIdentifier(input.pendingAccountId);

    if (input.purpose === 'ADD_ACCOUNT') {
      if (accountId !== null || pendingAccountId === null) {
        throw new AccountLoginSessionRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'ADD_ACCOUNT login session requires pendingAccountId and accountId must be null.',
        );
      }
    } else if (input.purpose === 'RELOGIN') {
      if (accountId === null || pendingAccountId !== null) {
        throw new AccountLoginSessionRepositoryError(
          'create',
          'VALIDATION_ERROR',
          'RELOGIN login session requires accountId and pendingAccountId must be null.',
        );
      }
    }

    const now = input.now ?? new Date();
    if (input.expiresAt <= now) {
      throw new AccountLoginSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'expiresAt must be in the future.',
      );
    }

    const values: NewAccountLoginSessionRow = {
      id: randomUUID(),
      purpose: input.purpose,
      accountId,
      pendingAccountId,
      createdByAdminUserId,
      status: 'PENDING',
      expiresAt: input.expiresAt,
      startedAt: null,
      readyDetectedAt: null,
      completedAt: null,
      cancelledAt: null,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    };

    const deadlineAt = performance.now() + LOGIN_SESSION_CONTENTION_DEADLINE_MS;

    while (true) {
      const remainingMs = Math.floor(deadlineAt - performance.now());
      if (remainingMs <= 0) {
        throw new AccountLoginSessionRepositoryError(
          'create',
          'INTEGRITY_ERROR',
          'Database is busy or write lock contention could not be resolved.',
        );
      }

      const attemptTimeoutMs = Math.max(
        1,
        Math.min(LOGIN_SESSION_CONTENTION_ATTEMPT_TIMEOUT_MS, remainingMs),
      );

      try {
        return this.client.withBusyTimeout(attemptTimeoutMs, () => {
          return this.client.orm.transaction(
            (tx) => {
              const activeExisting = tx
                .select()
                .from(accountLoginSessions)
                .where(inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]))
                .limit(1)
                .get();

              if (activeExisting) {
                throw new AccountLoginSessionRepositoryError(
                  'create',
                  'CONFLICT',
                  `An active login session '${activeExisting.id}' already exists in status '${activeExisting.status}'.`,
                );
              }

              return tx.insert(accountLoginSessions).values(values).returning().get();
            },
            { behavior: 'immediate' },
          );
        });
      } catch (error) {
        if (error instanceof AccountLoginSessionRepositoryError) {
          throw error;
        }

        if (isSqliteBusyError(error)) {
          signalAccountLoginSessionContentionObserved();
          const timeRemaining = Math.floor(deadlineAt - performance.now());
          if (timeRemaining > LOGIN_SESSION_CONTENTION_RETRY_INTERVAL_MS) {
            syncSleep(Math.min(LOGIN_SESSION_CONTENTION_RETRY_INTERVAL_MS, timeRemaining));
            continue;
          }
          throw new AccountLoginSessionRepositoryError(
            'create',
            'INTEGRITY_ERROR',
            'Database is busy or write lock contention could not be resolved.',
            error,
          );
        }

        // Non-contention database errors fail immediately without retry
        throw new AccountLoginSessionRepositoryError(
          'create',
          'INTEGRITY_ERROR',
          'Failed to create account login session.',
          error,
        );
      }
    }
  }

  findById(id: string): AccountLoginSession | undefined {
    try {
      return this.client.orm
        .select()
        .from(accountLoginSessions)
        .where(eq(accountLoginSessions.id, id))
        .get();
    } catch (error) {
      throw new AccountLoginSessionRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find account login session by id.',
        error,
      );
    }
  }

  findActive(): AccountLoginSession | undefined {
    try {
      return this.client.orm
        .select()
        .from(accountLoginSessions)
        .where(inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]))
        .get();
    } catch (error) {
      throw new AccountLoginSessionRepositoryError(
        'findActive',
        'INTEGRITY_ERROR',
        'Failed to find active account login session.',
        error,
      );
    }
  }

  findActiveByAccountId(accountId: string): AccountLoginSession | undefined {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new AccountLoginSessionRepositoryError(
        'findActiveByAccountId',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }

    try {
      return this.client.orm
        .select()
        .from(accountLoginSessions)
        .where(
          and(
            eq(accountLoginSessions.accountId, trimmed),
            inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]),
          ),
        )
        .get();
    } catch (error) {
      throw new AccountLoginSessionRepositoryError(
        'findActiveByAccountId',
        'INTEGRITY_ERROR',
        'Failed to find active account login session.',
        error,
      );
    }
  }

  /**
   * Internal atomic compare-and-transition state machine primitive
   */
  private transition(
    operation: AccountLoginSessionRepositoryError['loginOperation'],
    id: string,
    targetStatus: AccountLoginSessionStatus,
    allowedFrom: readonly AccountLoginSessionStatus[],
    updates: Partial<NewAccountLoginSessionRow>,
    now: Date,
  ): AccountLoginSession {
    const setValues: Partial<NewAccountLoginSessionRow> = {
      ...updates,
      status: targetStatus,
      updatedAt: now,
    };

    try {
      const result = this.client.orm
        .update(accountLoginSessions)
        .set(setValues)
        .where(
          and(
            eq(accountLoginSessions.id, id),
            inArray(accountLoginSessions.status, [...allowedFrom]),
          ),
        )
        .returning()
        .get();

      if (result) {
        return result;
      }

      // If affectedRows == 0, check reason
      const existing = this.findById(id);
      if (!existing) {
        throw new AccountLoginSessionRepositoryError(
          operation,
          'NOT_FOUND',
          `Account login session '${id}' not found.`,
        );
      }
      if (TERMINAL_LOGIN_SESSION_STATUSES.includes(existing.status)) {
        throw new AccountLoginSessionRepositoryError(
          operation,
          'TERMINAL_STATE',
          `Cannot transition session from terminal status '${existing.status}'.`,
        );
      }
      throw new AccountLoginSessionRepositoryError(
        operation,
        'INVALID_TRANSITION',
        `Cannot transition session '${id}' from current status '${existing.status}' to '${targetStatus}'.`,
      );
    } catch (error) {
      if (error instanceof AccountLoginSessionRepositoryError) {
        throw error;
      }
      throw new AccountLoginSessionRepositoryError(
        operation,
        'INTEGRITY_ERROR',
        'Failed to transition account login session status.',
        error,
      );
    }
  }

  // Named transition convenience methods with strictly enforced lifecycle metadata
  markStarting(
    id: string,
    options?: { startedAt?: Date | undefined; now?: Date | undefined },
  ): AccountLoginSession {
    const now = options?.now ?? new Date();
    const startedAt = options?.startedAt ?? now;
    return this.transition('markStarting', id, 'STARTING', ['PENDING'], { startedAt }, now);
  }

  markAwaitingUser(id: string, options?: { now?: Date | undefined }): AccountLoginSession {
    const now = options?.now ?? new Date();
    return this.transition('markAwaitingUser', id, 'AWAITING_USER', ['STARTING'], {}, now);
  }

  markReadyDetected(
    id: string,
    options?: { readyDetectedAt?: Date | undefined; now?: Date | undefined },
  ): AccountLoginSession {
    const now = options?.now ?? new Date();
    const readyDetectedAt = options?.readyDetectedAt ?? now;
    return this.transition(
      'markReadyDetected',
      id,
      'READY_DETECTED',
      ['AWAITING_USER'],
      { readyDetectedAt },
      now,
    );
  }

  markCompleting(id: string, options?: { now?: Date | undefined }): AccountLoginSession {
    const now = options?.now ?? new Date();
    return this.transition('markCompleting', id, 'COMPLETING', ['READY_DETECTED'], {}, now);
  }

  markCompleted(
    id: string,
    options?: { completedAt?: Date | undefined; now?: Date | undefined },
  ): AccountLoginSession {
    const now = options?.now ?? new Date();
    const completedAt = options?.completedAt ?? now;
    return this.transition('markCompleted', id, 'COMPLETED', ['COMPLETING'], { completedAt }, now);
  }

  markCancelled(
    id: string,
    options?: { cancelledAt?: Date | undefined; now?: Date | undefined },
  ): AccountLoginSession {
    const now = options?.now ?? new Date();
    const cancelledAt = options?.cancelledAt ?? now;
    return this.transition(
      'markCancelled',
      id,
      'CANCELLED',
      ['PENDING', 'STARTING', 'AWAITING_USER'],
      { cancelledAt },
      now,
    );
  }

  markExpired(id: string, options?: { now?: Date | undefined }): AccountLoginSession {
    const now = options?.now ?? new Date();
    return this.transition(
      'markExpired',
      id,
      'EXPIRED',
      ['PENDING', 'STARTING', 'AWAITING_USER'],
      {},
      now,
    );
  }

  markFailed(
    id: string,
    failureCode: AccountLoginFailureCode,
    options?: { now?: Date | undefined },
  ): AccountLoginSession {
    if (!isAccountLoginFailureCode(failureCode)) {
      throw new AccountLoginSessionRepositoryError(
        'markFailed',
        'VALIDATION_ERROR',
        'Invalid failure code.',
      );
    }
    const now = options?.now ?? new Date();
    return this.transition(
      'markFailed',
      id,
      'FAILED',
      ['PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING'],
      { failureCode },
      now,
    );
  }

  listRecent(options?: { limit?: number; offset?: number }): AccountLoginSession[] {
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);
    try {
      return this.client.orm
        .select()
        .from(accountLoginSessions)
        .orderBy(desc(accountLoginSessions.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new AccountLoginSessionRepositoryError(
        'listRecent',
        'INTEGRITY_ERROR',
        'Failed to list recent login sessions.',
        error,
      );
    }
  }
}
