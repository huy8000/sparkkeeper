import { createHash, randomUUID } from 'node:crypto';

import {
  isAccountLoginFailureCode,
  validateDouyinAccountIdentity,
  validateIdempotencyKey,
  type AccountLoginFailureCode,
  type AccountLoginPurpose,
  type DouyinAccountIdentity,
  type DouyinAccountIdentityInput,
} from '@sparkkeeper/shared';
import { and, eq, inArray } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  accountLoginSessions,
  accounts,
  auditEvents,
  type AccountLoginSessionRow,
  type AccountRow,
  type NewAccountLoginSessionRow,
  type NewAccountRow,
} from '../schema/index.js';
import { ACTIVE_LOGIN_SESSION_STATUSES } from './AccountLoginSessionRepository.js';

export const ACCOUNT_LOGIN_SESSION_TTL_MS = 15 * 60 * 1000;
export const ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS = 500;

const INTERACTIVE_LOGIN_SESSION_STATUSES = ['PENDING', 'STARTING', 'AWAITING_USER'] as const;
const STAGING_CLEANUP_SESSION_STATUSES = ['CANCELLED', 'EXPIRED', 'FAILED'] as const;

export type AccountOnboardingSession = AccountLoginSessionRow;

export interface StartAccountOnboardingInput {
  readonly purpose: AccountLoginPurpose;
  readonly accountId?: string | null;
  readonly createdByAdminUserId: string;
  readonly idempotencyKey: string;
  readonly now?: Date;
}

export type StartAccountOnboardingResult =
  | { readonly outcome: 'CREATED' | 'REPLAY'; readonly session: AccountOnboardingSession }
  | { readonly outcome: 'IDEMPOTENCY_CONFLICT' }
  | {
      readonly outcome: 'ACTIVE_CONFLICT';
      readonly ownedSession: AccountOnboardingSession | null;
    }
  | { readonly outcome: 'ACCOUNT_NOT_FOUND' | 'ACCOUNT_STATE_CONFLICT' };

export type InteractiveTransitionResult =
  | { readonly outcome: 'UPDATED'; readonly session: AccountOnboardingSession }
  | { readonly outcome: 'EXPIRED'; readonly session: AccountOnboardingSession }
  | { readonly outcome: 'NOT_FOUND' | 'STATE_CONFLICT' };

export type CancelAccountOnboardingResult =
  | { readonly outcome: 'CANCELLED' | 'EXPIRED'; readonly session: AccountOnboardingSession }
  | { readonly outcome: 'NOT_FOUND' | 'STATE_CONFLICT' | 'VERSION_CONFLICT' };

export type ReadyAccountOnboardingResult =
  | { readonly outcome: 'READY' | 'EXPIRED'; readonly session: AccountOnboardingSession }
  | { readonly outcome: 'NOT_FOUND' | 'STATE_CONFLICT' };

export type BeginCompletionResult =
  | {
      readonly outcome: 'COMPLETING';
      readonly session: AccountOnboardingSession;
      readonly account: AccountRow;
    }
  | { readonly outcome: 'NOT_FOUND' | 'STATE_CONFLICT' | 'IDENTITY_CONFLICT' };

export type FinishCompletionResult =
  | {
      readonly outcome: 'COMPLETED';
      readonly session: AccountOnboardingSession;
      readonly account: AccountRow;
    }
  | { readonly outcome: 'NOT_FOUND' | 'STATE_CONFLICT' };

export interface AccountOnboardingRecoverySnapshot {
  readonly session: AccountOnboardingSession;
  readonly account: AccountRow | null;
}

export class AccountOnboardingRepositoryError extends RepositoryError {
  constructor(operation: string, code: RepositoryErrorCode, message: string, cause?: unknown) {
    super(code, message, { entityName: 'AccountOnboarding', operation, cause });
    this.name = 'AccountOnboardingRepositoryError';
  }
}

function normalizeRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AccountOnboardingRepositoryError(
      'validate',
      'VALIDATION_ERROR',
      `${fieldName} must not be empty.`,
    );
  }
  return trimmed;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return normalizeRequired(value, 'accountId');
}

function digestIdempotencyKey(rawKey: string): string {
  let key: string;
  try {
    key = validateIdempotencyKey(rawKey);
  } catch (error) {
    throw new AccountOnboardingRepositoryError(
      'start',
      'VALIDATION_ERROR',
      error instanceof Error ? error.message : 'Invalid idempotency key.',
      error,
    );
  }
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

function validateIdentity(input: DouyinAccountIdentityInput): DouyinAccountIdentity {
  try {
    return validateDouyinAccountIdentity(input);
  } catch (error) {
    throw new AccountOnboardingRepositoryError(
      'identity',
      'VALIDATION_ERROR',
      error instanceof Error ? error.message : 'Invalid Douyin account identity.',
      error,
    );
  }
}

function canonicalRequestMatches(
  session: AccountOnboardingSession,
  purpose: AccountLoginPurpose,
  accountId: string | null,
): boolean {
  return session.purpose === purpose && session.accountId === accountId;
}

export class AccountOnboardingRepository {
  constructor(private readonly client: DatabaseClient) {}

  start(input: StartAccountOnboardingInput): StartAccountOnboardingResult {
    const actorId = normalizeRequired(input.createdByAdminUserId, 'createdByAdminUserId');
    const accountId = normalizeOptional(input.accountId);
    const idempotencyKeyDigest = digestIdempotencyKey(input.idempotencyKey);
    const now = input.now ?? new Date();

    if (input.purpose === 'ADD_ACCOUNT' && accountId !== null) {
      throw new AccountOnboardingRepositoryError(
        'start',
        'VALIDATION_ERROR',
        'ADD_ACCOUNT must not include accountId.',
      );
    }
    if (input.purpose === 'RELOGIN' && accountId === null) {
      throw new AccountOnboardingRepositoryError(
        'start',
        'VALIDATION_ERROR',
        'RELOGIN requires accountId.',
      );
    }

    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const replay = tx
              .select()
              .from(accountLoginSessions)
              .where(
                and(
                  eq(accountLoginSessions.createdByAdminUserId, actorId),
                  eq(accountLoginSessions.idempotencyKeyDigest, idempotencyKeyDigest),
                ),
              )
              .get();

            if (replay) {
              if (!canonicalRequestMatches(replay, input.purpose, accountId)) {
                return { outcome: 'IDEMPOTENCY_CONFLICT' as const };
              }
              return { outcome: 'REPLAY' as const, session: replay };
            }

            if (input.purpose === 'RELOGIN') {
              const account = tx.select().from(accounts).where(eq(accounts.id, accountId!)).get();
              if (!account) return { outcome: 'ACCOUNT_NOT_FOUND' as const };
              if (
                account.lifecycleStatus !== 'ACTIVE' ||
                !['READY', 'MISSING', 'MIGRATION_REQUIRED'].includes(account.profileState)
              ) {
                return { outcome: 'ACCOUNT_STATE_CONFLICT' as const };
              }
            }

            const active = tx
              .select()
              .from(accountLoginSessions)
              .where(inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]))
              .limit(1)
              .get();
            if (active) {
              return {
                outcome: 'ACTIVE_CONFLICT' as const,
                ownedSession: active.createdByAdminUserId === actorId ? active : null,
              };
            }

            const sessionId = randomUUID();
            const pendingAccountId = input.purpose === 'ADD_ACCOUNT' ? randomUUID() : null;
            const values: NewAccountLoginSessionRow = {
              id: sessionId,
              purpose: input.purpose,
              accountId,
              pendingAccountId,
              createdByAdminUserId: actorId,
              status: 'PENDING',
              expiresAt: new Date(now.getTime() + ACCOUNT_LOGIN_SESSION_TTL_MS),
              startedAt: null,
              readyDetectedAt: null,
              completedAt: null,
              cancelledAt: null,
              failureCode: null,
              createdAt: now,
              updatedAt: now,
              idempotencyKeyDigest,
            };
            const session = tx.insert(accountLoginSessions).values(values).returning().get();
            tx.insert(auditEvents)
              .values({
                id: randomUUID(),
                actorAdminUserId: actorId,
                action: 'ACCOUNT_LOGIN_STARTED',
                entityType: 'ACCOUNT_LOGIN_SESSION',
                entityId: sessionId,
                outcome: 'SUCCESS',
                reasonCode: null,
                correlationDigest: null,
                createdAt: now,
              })
              .run();
            return { outcome: 'CREATED' as const, session };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      if (error instanceof AccountOnboardingRepositoryError) throw error;
      throw new AccountOnboardingRepositoryError(
        'start',
        'INTEGRITY_ERROR',
        'Failed to start Account onboarding.',
        error,
      );
    }
  }

  findByIdForAdmin(sessionId: string, adminUserId: string): AccountOnboardingSession | undefined {
    const id = normalizeRequired(sessionId, 'sessionId');
    const actorId = normalizeRequired(adminUserId, 'adminUserId');
    try {
      return this.client.orm
        .select()
        .from(accountLoginSessions)
        .where(
          and(
            eq(accountLoginSessions.id, id),
            eq(accountLoginSessions.createdByAdminUserId, actorId),
          ),
        )
        .get();
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'findByIdForAdmin',
        'INTEGRITY_ERROR',
        'Failed to read Account onboarding session.',
        error,
      );
    }
  }

  findActiveForAdmin(adminUserId: string): AccountOnboardingSession | undefined {
    const actorId = normalizeRequired(adminUserId, 'adminUserId');
    try {
      return this.client.orm
        .select()
        .from(accountLoginSessions)
        .where(
          and(
            eq(accountLoginSessions.createdByAdminUserId, actorId),
            inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]),
          ),
        )
        .get();
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'findActiveForAdmin',
        'INTEGRITY_ERROR',
        'Failed to read active Account onboarding session.',
        error,
      );
    }
  }

  findActiveGlobal(): AccountOnboardingSession | undefined {
    try {
      return this.client.orm
        .select()
        .from(accountLoginSessions)
        .where(inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]))
        .get();
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'findActiveGlobal',
        'INTEGRITY_ERROR',
        'Failed to read the active Account onboarding session.',
        error,
      );
    }
  }

  findTerminalStagingCleanupCandidates(): AccountOnboardingSession[] {
    try {
      return this.client.orm
        .select()
        .from(accountLoginSessions)
        .where(inArray(accountLoginSessions.status, [...STAGING_CLEANUP_SESSION_STATUSES]))
        .all();
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'findTerminalStagingCleanupCandidates',
        'INTEGRITY_ERROR',
        'Failed to find terminal Account onboarding cleanup candidates.',
        error,
      );
    }
  }

  markStarting(sessionId: string, now = new Date()): InteractiveTransitionResult {
    return this.transitionInteractive(sessionId, 'PENDING', 'STARTING', { startedAt: now }, now);
  }

  markAwaitingUser(sessionId: string, now = new Date()): InteractiveTransitionResult {
    return this.transitionInteractive(sessionId, 'STARTING', 'AWAITING_USER', {}, now);
  }

  private transitionInteractive(
    sessionId: string,
    expectedStatus: 'PENDING' | 'STARTING',
    targetStatus: 'STARTING' | 'AWAITING_USER',
    updates: Partial<NewAccountLoginSessionRow>,
    now: Date,
  ): InteractiveTransitionResult {
    const id = normalizeRequired(sessionId, 'sessionId');
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const current = tx
              .select()
              .from(accountLoginSessions)
              .where(eq(accountLoginSessions.id, id))
              .get();
            if (!current) return { outcome: 'NOT_FOUND' as const };
            if (current.status !== expectedStatus) return { outcome: 'STATE_CONFLICT' as const };
            if (now.getTime() >= current.expiresAt.getTime()) {
              const expired = tx
                .update(accountLoginSessions)
                .set({ status: 'EXPIRED', updatedAt: now })
                .where(
                  and(
                    eq(accountLoginSessions.id, id),
                    eq(accountLoginSessions.status, expectedStatus),
                  ),
                )
                .returning()
                .get();
              return expired
                ? { outcome: 'EXPIRED' as const, session: expired }
                : { outcome: 'STATE_CONFLICT' as const };
            }
            const updated = tx
              .update(accountLoginSessions)
              .set({ ...updates, status: targetStatus, updatedAt: now })
              .where(
                and(
                  eq(accountLoginSessions.id, id),
                  eq(accountLoginSessions.status, expectedStatus),
                ),
              )
              .returning()
              .get();
            return updated
              ? { outcome: 'UPDATED' as const, session: updated }
              : { outcome: 'STATE_CONFLICT' as const };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'transitionInteractive',
        'INTEGRITY_ERROR',
        'Failed to transition Account onboarding session.',
        error,
      );
    }
  }

  cancel(
    sessionId: string,
    adminUserId: string,
    expectedUpdatedAt: Date,
    now = new Date(),
  ): CancelAccountOnboardingResult {
    const id = normalizeRequired(sessionId, 'sessionId');
    const actorId = normalizeRequired(adminUserId, 'adminUserId');
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const current = tx
              .select()
              .from(accountLoginSessions)
              .where(
                and(
                  eq(accountLoginSessions.id, id),
                  eq(accountLoginSessions.createdByAdminUserId, actorId),
                ),
              )
              .get();
            if (!current) return { outcome: 'NOT_FOUND' as const };
            if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
              return { outcome: 'VERSION_CONFLICT' as const };
            }
            if (!INTERACTIVE_LOGIN_SESSION_STATUSES.includes(current.status as never)) {
              return { outcome: 'STATE_CONFLICT' as const };
            }

            if (now.getTime() >= current.expiresAt.getTime()) {
              const expired = tx
                .update(accountLoginSessions)
                .set({ status: 'EXPIRED', updatedAt: now })
                .where(
                  and(
                    eq(accountLoginSessions.id, id),
                    eq(accountLoginSessions.updatedAt, expectedUpdatedAt),
                    inArray(accountLoginSessions.status, [...INTERACTIVE_LOGIN_SESSION_STATUSES]),
                  ),
                )
                .returning()
                .get();
              return expired
                ? { outcome: 'EXPIRED' as const, session: expired }
                : { outcome: 'STATE_CONFLICT' as const };
            }

            const cancelled = tx
              .update(accountLoginSessions)
              .set({ status: 'CANCELLED', cancelledAt: now, updatedAt: now })
              .where(
                and(
                  eq(accountLoginSessions.id, id),
                  eq(accountLoginSessions.updatedAt, expectedUpdatedAt),
                  inArray(accountLoginSessions.status, [...INTERACTIVE_LOGIN_SESSION_STATUSES]),
                ),
              )
              .returning()
              .get();
            if (!cancelled) return { outcome: 'STATE_CONFLICT' as const };

            tx.insert(auditEvents)
              .values({
                id: randomUUID(),
                actorAdminUserId: actorId,
                action: 'ACCOUNT_LOGIN_CANCELLED',
                entityType: 'ACCOUNT_LOGIN_SESSION',
                entityId: id,
                outcome: 'SUCCESS',
                reasonCode: null,
                correlationDigest: null,
                createdAt: now,
              })
              .run();
            return { outcome: 'CANCELLED' as const, session: cancelled };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'cancel',
        'INTEGRITY_ERROR',
        'Failed to cancel Account onboarding session.',
        error,
      );
    }
  }

  markReadyDetected(sessionId: string, now = new Date()): ReadyAccountOnboardingResult {
    const id = normalizeRequired(sessionId, 'sessionId');
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const current = tx
              .select()
              .from(accountLoginSessions)
              .where(eq(accountLoginSessions.id, id))
              .get();
            if (!current) return { outcome: 'NOT_FOUND' as const };
            if (current.status !== 'AWAITING_USER') {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            if (now.getTime() >= current.expiresAt.getTime()) {
              const expired = tx
                .update(accountLoginSessions)
                .set({ status: 'EXPIRED', updatedAt: now })
                .where(
                  and(
                    eq(accountLoginSessions.id, id),
                    eq(accountLoginSessions.status, 'AWAITING_USER'),
                  ),
                )
                .returning()
                .get();
              return expired
                ? { outcome: 'EXPIRED' as const, session: expired }
                : { outcome: 'STATE_CONFLICT' as const };
            }
            const ready = tx
              .update(accountLoginSessions)
              .set({ status: 'READY_DETECTED', readyDetectedAt: now, updatedAt: now })
              .where(
                and(
                  eq(accountLoginSessions.id, id),
                  eq(accountLoginSessions.status, 'AWAITING_USER'),
                ),
              )
              .returning()
              .get();
            return ready
              ? { outcome: 'READY' as const, session: ready }
              : { outcome: 'STATE_CONFLICT' as const };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'markReadyDetected',
        'INTEGRITY_ERROR',
        'Failed to mark Account onboarding ready.',
        error,
      );
    }
  }

  expire(sessionId: string, now = new Date()): InteractiveTransitionResult {
    const id = normalizeRequired(sessionId, 'sessionId');
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const current = tx
              .select()
              .from(accountLoginSessions)
              .where(eq(accountLoginSessions.id, id))
              .get();
            if (!current) return { outcome: 'NOT_FOUND' as const };
            if (!INTERACTIVE_LOGIN_SESSION_STATUSES.includes(current.status as never)) {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            if (now.getTime() < current.expiresAt.getTime()) {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            const expired = tx
              .update(accountLoginSessions)
              .set({ status: 'EXPIRED', updatedAt: now })
              .where(
                and(
                  eq(accountLoginSessions.id, id),
                  eq(accountLoginSessions.updatedAt, current.updatedAt),
                  inArray(accountLoginSessions.status, [...INTERACTIVE_LOGIN_SESSION_STATUSES]),
                ),
              )
              .returning()
              .get();
            return expired
              ? { outcome: 'EXPIRED' as const, session: expired }
              : { outcome: 'STATE_CONFLICT' as const };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      if (error instanceof AccountOnboardingRepositoryError) throw error;
      throw new AccountOnboardingRepositoryError(
        'expire',
        'INTEGRITY_ERROR',
        'Failed to expire Account onboarding session.',
        error,
      );
    }
  }

  markFailed(
    sessionId: string,
    failureCode: AccountLoginFailureCode,
    now = new Date(),
  ): AccountOnboardingSession | undefined {
    const id = normalizeRequired(sessionId, 'sessionId');
    if (!isAccountLoginFailureCode(failureCode)) {
      throw new AccountOnboardingRepositoryError(
        'markFailed',
        'VALIDATION_ERROR',
        'Invalid onboarding failure code.',
      );
    }
    try {
      return this.client.orm
        .update(accountLoginSessions)
        .set({ status: 'FAILED', failureCode, updatedAt: now })
        .where(
          and(
            eq(accountLoginSessions.id, id),
            inArray(accountLoginSessions.status, [...ACTIVE_LOGIN_SESSION_STATUSES]),
          ),
        )
        .returning()
        .get();
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'markFailed',
        'INTEGRITY_ERROR',
        'Failed to mark Account onboarding failed.',
        error,
      );
    }
  }

  beginAddCompletion(
    sessionId: string,
    identityInput: DouyinAccountIdentityInput,
    now = new Date(),
  ): BeginCompletionResult {
    const id = normalizeRequired(sessionId, 'sessionId');
    const identity = validateIdentity(identityInput);
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const session = tx
              .select()
              .from(accountLoginSessions)
              .where(eq(accountLoginSessions.id, id))
              .get();
            if (!session) return { outcome: 'NOT_FOUND' as const };
            if (
              session.purpose !== 'ADD_ACCOUNT' ||
              session.status !== 'READY_DETECTED' ||
              session.pendingAccountId === null
            ) {
              return { outcome: 'STATE_CONFLICT' as const };
            }

            if (this.findIdentityCollision(tx, identity, null)) {
              return { outcome: 'IDENTITY_CONFLICT' as const };
            }
            const existingAccount = tx
              .select()
              .from(accounts)
              .where(eq(accounts.id, session.pendingAccountId))
              .get();
            if (existingAccount) return { outcome: 'STATE_CONFLICT' as const };

            const values: NewAccountRow = {
              id: session.pendingAccountId,
              name: identity.displayName,
              enabled: true,
              loginStatus: 'UNKNOWN',
              lastLoginAt: null,
              avatarRemoteUrl: identity.avatarRemoteUrl,
              avatarCacheKey: null,
              douyinUniqueId: identity.douyinUniqueId,
              douyinShortId: identity.douyinShortId,
              douyinSecUid: identity.douyinSecUid,
              profileState: 'PROVISIONING',
              lifecycleStatus: 'ACTIVE',
              lastAuthCheckAt: null,
              lastContactSyncAt: null,
              unboundAt: null,
              createdAt: now,
              updatedAt: now,
            };
            const account = tx.insert(accounts).values(values).returning().get();
            const completing = tx
              .update(accountLoginSessions)
              .set({ status: 'COMPLETING', updatedAt: now })
              .where(
                and(
                  eq(accountLoginSessions.id, id),
                  eq(accountLoginSessions.status, 'READY_DETECTED'),
                ),
              )
              .returning()
              .get();
            if (!completing) return { outcome: 'STATE_CONFLICT' as const };
            return { outcome: 'COMPLETING' as const, session: completing, account };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      if (error instanceof AccountOnboardingRepositoryError) throw error;
      throw new AccountOnboardingRepositoryError(
        'beginAddCompletion',
        'INTEGRITY_ERROR',
        'Failed to begin ADD_ACCOUNT completion.',
        error,
      );
    }
  }

  finishAddCompletion(sessionId: string, now = new Date()): FinishCompletionResult {
    return this.finishStagingCompletion(sessionId, 'ADD_ACCOUNT', now);
  }

  beginReloginReplacement(
    sessionId: string,
    identityInput: DouyinAccountIdentityInput,
    now = new Date(),
  ): BeginCompletionResult {
    const id = normalizeRequired(sessionId, 'sessionId');
    const identity = validateIdentity(identityInput);
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const session = tx
              .select()
              .from(accountLoginSessions)
              .where(eq(accountLoginSessions.id, id))
              .get();
            if (!session) return { outcome: 'NOT_FOUND' as const };
            if (
              session.purpose !== 'RELOGIN' ||
              session.status !== 'READY_DETECTED' ||
              session.accountId === null
            ) {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            const account = tx
              .select()
              .from(accounts)
              .where(eq(accounts.id, session.accountId))
              .get();
            if (
              !account ||
              account.lifecycleStatus !== 'ACTIVE' ||
              !['MISSING', 'MIGRATION_REQUIRED'].includes(account.profileState)
            ) {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            if (!this.identityMatchesAccount(account, identity)) {
              return { outcome: 'IDENTITY_CONFLICT' as const };
            }
            if (this.findIdentityCollision(tx, identity, account.id)) {
              return { outcome: 'IDENTITY_CONFLICT' as const };
            }
            const updatedAccount = tx
              .update(accounts)
              .set({
                ...this.identityUpdates(identity),
                profileState: 'PROVISIONING',
                loginStatus: 'UNKNOWN',
                updatedAt: now,
              })
              .where(eq(accounts.id, account.id))
              .returning()
              .get();
            const completing = tx
              .update(accountLoginSessions)
              .set({ status: 'COMPLETING', updatedAt: now })
              .where(
                and(
                  eq(accountLoginSessions.id, id),
                  eq(accountLoginSessions.status, 'READY_DETECTED'),
                ),
              )
              .returning()
              .get();
            if (!updatedAccount || !completing) return { outcome: 'STATE_CONFLICT' as const };
            return {
              outcome: 'COMPLETING' as const,
              session: completing,
              account: updatedAccount,
            };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      if (error instanceof AccountOnboardingRepositoryError) throw error;
      throw new AccountOnboardingRepositoryError(
        'beginReloginReplacement',
        'INTEGRITY_ERROR',
        'Failed to begin RELOGIN replacement completion.',
        error,
      );
    }
  }

  finishReloginReplacement(sessionId: string, now = new Date()): FinishCompletionResult {
    return this.finishStagingCompletion(sessionId, 'RELOGIN', now);
  }

  completeReloginInPlace(
    sessionId: string,
    identityInput: DouyinAccountIdentityInput,
    now = new Date(),
  ): FinishCompletionResult | { readonly outcome: 'IDENTITY_CONFLICT' } {
    const id = normalizeRequired(sessionId, 'sessionId');
    const identity = validateIdentity(identityInput);
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const session = tx
              .select()
              .from(accountLoginSessions)
              .where(eq(accountLoginSessions.id, id))
              .get();
            if (!session) return { outcome: 'NOT_FOUND' as const };
            if (
              session.purpose !== 'RELOGIN' ||
              session.status !== 'READY_DETECTED' ||
              session.accountId === null
            ) {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            const account = tx
              .select()
              .from(accounts)
              .where(eq(accounts.id, session.accountId))
              .get();
            if (
              !account ||
              account.lifecycleStatus !== 'ACTIVE' ||
              account.profileState !== 'READY'
            ) {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            if (
              !this.identityMatchesAccount(account, identity) ||
              this.findIdentityCollision(tx, identity, account.id)
            ) {
              return { outcome: 'IDENTITY_CONFLICT' as const };
            }

            tx.update(accountLoginSessions)
              .set({ status: 'COMPLETING', updatedAt: now })
              .where(
                and(
                  eq(accountLoginSessions.id, id),
                  eq(accountLoginSessions.status, 'READY_DETECTED'),
                ),
              )
              .run();
            const updatedAccount = tx
              .update(accounts)
              .set({
                ...this.identityUpdates(identity),
                profileState: 'READY',
                loginStatus: 'READY',
                lastLoginAt: now,
                lastAuthCheckAt: now,
                updatedAt: now,
              })
              .where(eq(accounts.id, account.id))
              .returning()
              .get();
            const completed = tx
              .update(accountLoginSessions)
              .set({ status: 'COMPLETED', completedAt: now, updatedAt: now })
              .where(
                and(eq(accountLoginSessions.id, id), eq(accountLoginSessions.status, 'COMPLETING')),
              )
              .returning()
              .get();
            if (!updatedAccount || !completed) return { outcome: 'STATE_CONFLICT' as const };
            this.insertCompletionAudit(
              tx,
              session.createdByAdminUserId,
              'ACCOUNT_RELOGIN_COMPLETED',
              account.id,
              now,
            );
            return { outcome: 'COMPLETED' as const, session: completed, account: updatedAccount };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      if (error instanceof AccountOnboardingRepositoryError) throw error;
      throw new AccountOnboardingRepositoryError(
        'completeReloginInPlace',
        'INTEGRITY_ERROR',
        'Failed to complete RELOGIN.',
        error,
      );
    }
  }

  getRecoverySnapshot(sessionId: string): AccountOnboardingRecoverySnapshot | undefined {
    const id = normalizeRequired(sessionId, 'sessionId');
    try {
      const session = this.client.orm
        .select()
        .from(accountLoginSessions)
        .where(eq(accountLoginSessions.id, id))
        .get();
      if (!session) return undefined;
      const accountId = session.accountId ?? session.pendingAccountId;
      const account = accountId
        ? (this.client.orm.select().from(accounts).where(eq(accounts.id, accountId)).get() ?? null)
        : null;
      return { session, account };
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'getRecoverySnapshot',
        'INTEGRITY_ERROR',
        'Failed to read Account onboarding recovery snapshot.',
        error,
      );
    }
  }

  failCompleting(
    sessionId: string,
    accountProfileState: 'MISSING' | 'QUARANTINED',
    failureCode: 'FINALIZE_FAILED' | 'INTEGRITY_ERROR',
    now = new Date(),
  ): AccountOnboardingRecoverySnapshot | undefined {
    const id = normalizeRequired(sessionId, 'sessionId');
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const session = tx
              .select()
              .from(accountLoginSessions)
              .where(eq(accountLoginSessions.id, id))
              .get();
            if (!session) return undefined;
            if (session.status !== 'COMPLETING') {
              return { session, account: null };
            }
            const accountId = session.accountId ?? session.pendingAccountId;
            let account: AccountRow | null = null;
            if (accountId) {
              account =
                tx
                  .update(accounts)
                  .set({
                    profileState: accountProfileState,
                    loginStatus: 'UNKNOWN',
                    updatedAt: now,
                  })
                  .where(eq(accounts.id, accountId))
                  .returning()
                  .get() ?? null;
            }
            const failed = tx
              .update(accountLoginSessions)
              .set({ status: 'FAILED', failureCode, updatedAt: now })
              .where(
                and(eq(accountLoginSessions.id, id), eq(accountLoginSessions.status, 'COMPLETING')),
              )
              .returning()
              .get();
            if (!failed) return undefined;
            if (accountProfileState === 'QUARANTINED' && accountId) {
              tx.insert(auditEvents)
                .values({
                  id: randomUUID(),
                  actorAdminUserId: session.createdByAdminUserId,
                  action: 'PROFILE_QUARANTINED',
                  entityType: 'DOUYIN_ACCOUNT',
                  entityId: accountId,
                  outcome: 'SUCCESS',
                  reasonCode: failureCode,
                  correlationDigest: null,
                  createdAt: now,
                })
                .run();
            }
            return { session: failed, account };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      throw new AccountOnboardingRepositoryError(
        'failCompleting',
        'INTEGRITY_ERROR',
        'Failed to reconcile Account onboarding failure.',
        error,
      );
    }
  }

  private finishStagingCompletion(
    sessionId: string,
    purpose: 'ADD_ACCOUNT' | 'RELOGIN',
    now: Date,
  ): FinishCompletionResult {
    const id = normalizeRequired(sessionId, 'sessionId');
    try {
      return this.client.withBusyTimeout(ACCOUNT_ONBOARDING_DB_BUSY_TIMEOUT_MS, () =>
        this.client.orm.transaction(
          (tx) => {
            const session = tx
              .select()
              .from(accountLoginSessions)
              .where(eq(accountLoginSessions.id, id))
              .get();
            if (!session) return { outcome: 'NOT_FOUND' as const };
            const accountId =
              purpose === 'ADD_ACCOUNT' ? session.pendingAccountId : session.accountId;
            if (session.purpose !== purpose || session.status !== 'COMPLETING' || !accountId) {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
            if (!account || account.profileState !== 'PROVISIONING') {
              return { outcome: 'STATE_CONFLICT' as const };
            }
            const updatedAccount = tx
              .update(accounts)
              .set({
                profileState: 'READY',
                loginStatus: 'READY',
                lastLoginAt: now,
                lastAuthCheckAt: now,
                updatedAt: now,
              })
              .where(eq(accounts.id, accountId))
              .returning()
              .get();
            const completed = tx
              .update(accountLoginSessions)
              .set({ status: 'COMPLETED', completedAt: now, updatedAt: now })
              .where(
                and(eq(accountLoginSessions.id, id), eq(accountLoginSessions.status, 'COMPLETING')),
              )
              .returning()
              .get();
            if (!updatedAccount || !completed) return { outcome: 'STATE_CONFLICT' as const };
            this.insertCompletionAudit(
              tx,
              session.createdByAdminUserId,
              purpose === 'ADD_ACCOUNT' ? 'ACCOUNT_CREATED' : 'ACCOUNT_RELOGIN_COMPLETED',
              accountId,
              now,
            );
            return { outcome: 'COMPLETED' as const, session: completed, account: updatedAccount };
          },
          { behavior: 'immediate' },
        ),
      );
    } catch (error) {
      if (error instanceof AccountOnboardingRepositoryError) throw error;
      throw new AccountOnboardingRepositoryError(
        'finishStagingCompletion',
        'INTEGRITY_ERROR',
        'Failed to finish Account onboarding completion.',
        error,
      );
    }
  }

  private identityMatchesAccount(account: AccountRow, identity: DouyinAccountIdentity): boolean {
    if (account.douyinSecUid !== null) return identity.douyinSecUid === account.douyinSecUid;
    if (account.douyinUniqueId !== null) {
      return identity.douyinUniqueId === account.douyinUniqueId;
    }
    return true;
  }

  private identityUpdates(identity: DouyinAccountIdentity): Partial<NewAccountRow> {
    return {
      name: identity.displayName,
      douyinSecUid: identity.douyinSecUid,
      douyinUniqueId: identity.douyinUniqueId,
      douyinShortId: identity.douyinShortId,
      avatarRemoteUrl: identity.avatarRemoteUrl,
    };
  }

  private findIdentityCollision(
    tx: Parameters<Parameters<DatabaseClient['orm']['transaction']>[0]>[0],
    identity: DouyinAccountIdentity,
    allowedAccountId: string | null,
  ): AccountRow | undefined {
    if (identity.douyinSecUid !== null) {
      const collision = tx
        .select()
        .from(accounts)
        .where(eq(accounts.douyinSecUid, identity.douyinSecUid))
        .get();
      if (collision && collision.id !== allowedAccountId) {
        return collision;
      }
    }
    if (identity.douyinUniqueId !== null) {
      const collision = tx
        .select()
        .from(accounts)
        .where(eq(accounts.douyinUniqueId, identity.douyinUniqueId))
        .get();
      if (collision && collision.id !== allowedAccountId) {
        return collision;
      }
    }
    return undefined;
  }

  private insertCompletionAudit(
    tx: Parameters<Parameters<DatabaseClient['orm']['transaction']>[0]>[0],
    actorAdminUserId: string,
    action: 'ACCOUNT_CREATED' | 'ACCOUNT_RELOGIN_COMPLETED',
    accountId: string,
    now: Date,
  ): void {
    tx.insert(auditEvents)
      .values({
        id: randomUUID(),
        actorAdminUserId,
        action,
        entityType: 'DOUYIN_ACCOUNT',
        entityId: accountId,
        outcome: 'SUCCESS',
        reasonCode: null,
        correlationDigest: null,
        createdAt: now,
      })
      .run();
  }
}
