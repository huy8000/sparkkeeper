import { randomUUID } from 'node:crypto';
import { normalizeAdminUsername, validateAdminUsername } from '@sparkkeeper/shared';
import { and, count, eq, isNull } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import { signalContentionObserved } from '../internal/contentionProbe.js';
import {
  adminSessions,
  adminUsers,
  auditEvents,
  type AdminSessionRow,
  type NewAdminSessionRow,
  type NewAdminUserRow,
} from '../schema/index.js';

export const AUTH_DB_BUSY_TIMEOUT_MS = 500;
export const AUTH_DB_CONTENTION_ATTEMPT_TIMEOUT_MS = 50;
export const AUTH_DB_CONTENTION_RETRY_INTERVAL_MS = 25;

export const AUTH_VALIDATE_SESSION_CONTENTION_PROBE_KEY = 'admin-auth.validateSession';

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

function authDbSyncSleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export const authAdminUserSelection = {
  id: adminUsers.id,
  username: adminUsers.username,
  usernameNormalized: adminUsers.usernameNormalized,
  passwordHash: adminUsers.passwordHash,
  status: adminUsers.status,
  sessionVersion: adminUsers.sessionVersion,
  lastLoginAt: adminUsers.lastLoginAt,
  passwordChangedAt: adminUsers.passwordChangedAt,
  createdAt: adminUsers.createdAt,
  updatedAt: adminUsers.updatedAt,
} as const;

export type AuthAdminUserRow = {
  id: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  status: 'ACTIVE' | 'DISABLED';
  sessionVersion: number;
  lastLoginAt: Date | null;
  passwordChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export interface BootstrapInitialAdminInput {
  readonly username: string;
  readonly passwordHash: string;
  readonly now?: Date | undefined;
}

export type BootstrapInitialAdminResult =
  | { readonly outcome: 'SUCCESS'; readonly adminUser: AuthAdminUserRow }
  | { readonly outcome: 'ADMIN_ALREADY_INITIALIZED' };

export interface CompleteAuthenticatedLoginInput {
  readonly adminUserId: string;
  readonly expectedSessionVersion: number;
  readonly tokenDigest: string;
  readonly csrfTokenDigest: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly newPasswordHashRehash?: string | undefined;
  readonly currentSessionIdToRevoke?: string | undefined;
  readonly now?: Date | undefined;
}

export type CompleteAuthenticatedLoginResult =
  | {
      readonly outcome: 'SUCCESS';
      readonly session: AdminSessionRow;
      readonly adminUser: AuthAdminUserRow;
    }
  | { readonly outcome: 'USER_INVALID'; readonly reason: string };

export interface ValidateSessionInput {
  readonly tokenDigest: string;
  readonly now: Date;
}

export type ValidateSessionResult =
  | {
      readonly outcome: 'VALID';
      readonly session: AdminSessionRow;
      readonly adminUser: AuthAdminUserRow;
    }
  | { readonly outcome: 'UNAUTHENTICATED' }
  | { readonly outcome: 'SESSION_EXPIRED'; readonly session: AdminSessionRow }
  | {
      readonly outcome: 'SESSION_REVOKED';
      readonly session: AdminSessionRow;
      readonly reason: string;
    };

export interface RecordKnownCredentialFailureAuditInput {
  readonly adminUserId: string;
  readonly correlationDigest?: string | null | undefined;
  readonly now?: Date | undefined;
}

export interface RecordKnownCredentialFailureAuditResult {
  readonly outcome: 'SUCCESS';
}

export interface LogoutCurrentSessionInput {
  readonly sessionId: string;
  readonly adminUserId: string;
  readonly now?: Date | undefined;
}

export type LogoutCurrentSessionResult =
  { readonly outcome: 'SUCCESS' } | { readonly outcome: 'NOT_FOUND_OR_REVOKED' };

export class AdminAuthRepositoryError extends RepositoryError {
  constructor(operation: string, code: RepositoryErrorCode, message: string, cause?: unknown) {
    super(code, message, { entityName: 'AdminAuth', operation, cause });
    this.name = 'AdminAuthRepositoryError';
  }
}

export class AdminAuthRepository {
  constructor(private readonly client: DatabaseClient) {}

  /**
   * Atomically checks that zero AdminUsers exist, creates the single initial ACTIVE AdminUser,
   * and records an ADMIN_INITIALIZED audit event in one BEGIN IMMEDIATE transaction.
   * Legacy failedLoginCount, lockedUntil, lastFailedLoginAt are untouched and use schema defaults.
   */
  bootstrapInitialAdminWithAudit(input: BootstrapInitialAdminInput): BootstrapInitialAdminResult {
    let username: string;
    let usernameNormalized: string;
    try {
      username = validateAdminUsername(input.username);
      usernameNormalized = normalizeAdminUsername(username);
    } catch (error) {
      throw new AdminAuthRepositoryError(
        'bootstrapInitialAdminWithAudit',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid admin username.',
        error,
      );
    }

    const trimmedHash = input.passwordHash.trim();
    if (trimmedHash.length === 0) {
      throw new AdminAuthRepositoryError(
        'bootstrapInitialAdminWithAudit',
        'VALIDATION_ERROR',
        'passwordHash must not be empty.',
      );
    }

    const now = input.now ?? new Date();

    try {
      return this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () => {
        return this.client.orm.transaction(
          (tx) => {
            const row = tx.select({ total: count() }).from(adminUsers).get();

            if ((row?.total ?? 0) > 0) {
              return { outcome: 'ADMIN_ALREADY_INITIALIZED' as const };
            }

            const id = randomUUID();
            const userValues: Partial<NewAdminUserRow> = {
              id,
              username,
              usernameNormalized,
              passwordHash: trimmedHash,
              status: 'ACTIVE',
              sessionVersion: 1,
              lastLoginAt: null,
              passwordChangedAt: now,
              createdAt: now,
              updatedAt: now,
            };

            const adminUser = tx
              .insert(adminUsers)
              .values(userValues as NewAdminUserRow)
              .returning(authAdminUserSelection)
              .get();

            tx.insert(auditEvents)
              .values({
                id: randomUUID(),
                actorAdminUserId: id,
                action: 'ADMIN_INITIALIZED',
                entityType: 'ADMIN_USER',
                entityId: id,
                outcome: 'SUCCESS',
                reasonCode: null,
                correlationDigest: null,
                createdAt: now,
              })
              .run();

            return { outcome: 'SUCCESS' as const, adminUser };
          },
          { behavior: 'immediate' },
        );
      });
    } catch (error) {
      if (error instanceof AdminAuthRepositoryError) throw error;
      throw new AdminAuthRepositoryError(
        'bootstrapInitialAdminWithAudit',
        'INTEGRITY_ERROR',
        'Failed to bootstrap initial admin user.',
        error,
      );
    }
  }

  /**
   * Finalizes an authenticated login atomically:
   * - verifies user status and sessionVersion
   * - updates lastLoginAt
   * - optionally applies upward-only rehash
   * - revokes current valid session if replacing
   * - creates new session
   * - records LOGIN_SUCCEEDED audit event
   */
  completeAuthenticatedLogin(
    input: CompleteAuthenticatedLoginInput,
  ): CompleteAuthenticatedLoginResult {
    const now = input.now ?? new Date();

    try {
      return this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () => {
        return this.client.orm.transaction(
          (tx) => {
            const user = tx
              .select(authAdminUserSelection)
              .from(adminUsers)
              .where(eq(adminUsers.id, input.adminUserId))
              .get();

            if (
              !user ||
              user.status !== 'ACTIVE' ||
              user.sessionVersion !== input.expectedSessionVersion
            ) {
              return {
                outcome: 'USER_INVALID' as const,
                reason: !user
                  ? 'ADMIN_NOT_FOUND'
                  : user.status !== 'ACTIVE'
                    ? 'ADMIN_DISABLED'
                    : 'SESSION_VERSION_CHANGED',
              };
            }

            // Update user lastLoginAt and optionally passwordHash on rehash.
            // Legacy failedLoginCount, lockedUntil, lastFailedLoginAt are deliberately untouched.
            const userUpdates: Partial<NewAdminUserRow> = {
              lastLoginAt: now,
              updatedAt: now,
            };

            if (input.newPasswordHashRehash) {
              userUpdates.passwordHash = input.newPasswordHashRehash;
            }

            const updatedUser = tx
              .update(adminUsers)
              .set(userUpdates)
              .where(eq(adminUsers.id, input.adminUserId))
              .returning(authAdminUserSelection)
              .get();

            // Revoke old session if replacing current session
            if (input.currentSessionIdToRevoke) {
              tx.update(adminSessions)
                .set({
                  revokedAt: now,
                  revokeReason: 'LOGIN_REPLACED',
                })
                .where(
                  and(
                    eq(adminSessions.id, input.currentSessionIdToRevoke),
                    isNull(adminSessions.revokedAt),
                  ),
                )
                .run();
            }

            // Create new session
            const newSessionId = randomUUID();
            const sessionValues: NewAdminSessionRow = {
              id: newSessionId,
              adminUserId: input.adminUserId,
              tokenDigest: input.tokenDigest,
              csrfTokenDigest: input.csrfTokenDigest,
              sessionVersion: user.sessionVersion,
              reauthenticatedAt: now,
              createdAt: now,
              lastSeenAt: now,
              idleExpiresAt: input.idleExpiresAt,
              absoluteExpiresAt: input.absoluteExpiresAt,
              revokedAt: null,
              revokeReason: null,
            };

            const session = tx.insert(adminSessions).values(sessionValues).returning().get();

            // Append LOGIN_SUCCEEDED audit event
            tx.insert(auditEvents)
              .values({
                id: randomUUID(),
                actorAdminUserId: input.adminUserId,
                action: 'LOGIN_SUCCEEDED',
                entityType: 'ADMIN_SESSION',
                entityId: newSessionId,
                outcome: 'SUCCESS',
                reasonCode: null,
                correlationDigest: null,
                createdAt: now,
              })
              .run();

            return {
              outcome: 'SUCCESS' as const,
              session,
              adminUser: updatedUser,
            };
          },
          { behavior: 'immediate' },
        );
      });
    } catch (error) {
      if (error instanceof AdminAuthRepositoryError) throw error;
      throw new AdminAuthRepositoryError(
        'completeAuthenticatedLogin',
        'INTEGRITY_ERROR',
        'Failed to complete authenticated login transaction.',
        error,
      );
    }
  }

  /**
   * Validates a session by token digest atomically inside a BEGIN IMMEDIATE transaction:
   * - checks revocation
   * - checks AdminUser ACTIVE status and sessionVersion match (marking session revoked on mismatch)
   * - checks idle and absolute expiration deadlines against sampled now
   * - applies guarded 5-minute write-throttled touch
   */
  validateSession(input: ValidateSessionInput): ValidateSessionResult {
    const { tokenDigest, now } = input;

    // V4-1 contention pattern (mirrors AccountLoginSessionRepository.create):
    // a bounded 500ms deadline of 50ms immediate-transaction quanta with
    // syncSleep backoff. Real SQLITE_BUSY/LOCKED attempts are reported to the
    // internal observe-only probe (no public API, no classification effect).
    const deadlineAt = performance.now() + AUTH_DB_BUSY_TIMEOUT_MS;

    const runAttempt = (): ValidateSessionResult => {
      return this.client.withBusyTimeout(AUTH_DB_CONTENTION_ATTEMPT_TIMEOUT_MS, () => {
        return this.client.orm.transaction(
          (tx) => {
            const row = tx
              .select({
                session: adminSessions,
                adminUser: authAdminUserSelection,
              })
              .from(adminSessions)
              .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
              .where(eq(adminSessions.tokenDigest, tokenDigest))
              .get();

            if (!row) {
              return { outcome: 'UNAUTHENTICATED' as const };
            }

            const { session, adminUser } = row;

            // 1. Check if already revoked
            if (session.revokedAt !== null) {
              return {
                outcome: 'SESSION_REVOKED' as const,
                session,
                reason: session.revokeReason ?? 'REVOKED',
              };
            }

            // 2. Check if admin user is disabled
            if (adminUser.status !== 'ACTIVE') {
              tx.update(adminSessions)
                .set({ revokedAt: now, revokeReason: 'ADMIN_DISABLED' })
                .where(and(eq(adminSessions.id, session.id), isNull(adminSessions.revokedAt)))
                .run();
              return {
                outcome: 'SESSION_REVOKED' as const,
                session: {
                  ...session,
                  revokedAt: now,
                  revokeReason: 'ADMIN_DISABLED',
                },
                reason: 'ADMIN_DISABLED',
              };
            }

            // 3. Check if sessionVersion changed
            if (session.sessionVersion !== adminUser.sessionVersion) {
              tx.update(adminSessions)
                .set({ revokedAt: now, revokeReason: 'SESSION_VERSION_CHANGED' })
                .where(and(eq(adminSessions.id, session.id), isNull(adminSessions.revokedAt)))
                .run();
              return {
                outcome: 'SESSION_REVOKED' as const,
                session: {
                  ...session,
                  revokedAt: now,
                  revokeReason: 'SESSION_VERSION_CHANGED',
                },
                reason: 'SESSION_VERSION_CHANGED',
              };
            }

            // 4. Check expiration deadlines (exclusive validity: now >= deadline is expired)
            if (
              now.getTime() >= session.idleExpiresAt.getTime() ||
              now.getTime() >= session.absoluteExpiresAt.getTime()
            ) {
              return {
                outcome: 'SESSION_EXPIRED' as const,
                session,
              };
            }

            // 5. Session is valid; check if touch throttle (5 minutes) elapsed
            const elapsedSinceLastSeen = now.getTime() - session.lastSeenAt.getTime();
            if (elapsedSinceLastSeen >= 5 * 60 * 1000) {
              const newIdleExpiresAt = new Date(
                Math.min(now.getTime() + 30 * 60 * 1000, session.absoluteExpiresAt.getTime()),
              );

              tx.update(adminSessions)
                .set({
                  lastSeenAt: now,
                  idleExpiresAt: newIdleExpiresAt,
                })
                .where(and(eq(adminSessions.id, session.id), isNull(adminSessions.revokedAt)))
                .run();

              return {
                outcome: 'VALID' as const,
                session: {
                  ...session,
                  lastSeenAt: now,
                  idleExpiresAt: newIdleExpiresAt,
                },
                adminUser,
              };
            }

            return {
              outcome: 'VALID' as const,
              session,
              adminUser,
            };
          },
          { behavior: 'immediate' },
        );
      });
    };

    try {
      for (;;) {
        const remainingMs = Math.floor(deadlineAt - performance.now());
        if (remainingMs <= 0) {
          throw new AdminAuthRepositoryError(
            'validateSession',
            'INTEGRITY_ERROR',
            'Database is busy or write lock contention could not be resolved.',
          );
        }
        try {
          return runAttempt();
        } catch (error) {
          if (error instanceof AdminAuthRepositoryError) {
            throw error;
          }
          if (isSqliteBusyError(error)) {
            // Internal observe-only signal: an actual SQLITE_BUSY/LOCKED
            // attempt occurred. It cannot alter timeout, retry, or result.
            signalContentionObserved(AUTH_VALIDATE_SESSION_CONTENTION_PROBE_KEY);
            authDbSyncSleep(Math.min(AUTH_DB_CONTENTION_RETRY_INTERVAL_MS, remainingMs));
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if (error instanceof AdminAuthRepositoryError) throw error;
      throw new AdminAuthRepositoryError(
        'validateSession',
        'INTEGRITY_ERROR',
        'Failed to validate admin session.',
        error,
      );
    }
  }

  /**
   * Records a known-user LOGIN_FAILED audit event using the bounded auth DB contention boundary.
   */
  recordKnownCredentialFailureAudit(
    input: RecordKnownCredentialFailureAuditInput,
  ): RecordKnownCredentialFailureAuditResult {
    const now = input.now ?? new Date();

    try {
      return this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () => {
        this.client.orm
          .insert(auditEvents)
          .values({
            id: randomUUID(),
            actorAdminUserId: null,
            action: 'LOGIN_FAILED',
            entityType: 'ADMIN_USER',
            entityId: input.adminUserId,
            outcome: 'REJECTED',
            reasonCode: 'INVALID_CREDENTIALS',
            correlationDigest: input.correlationDigest ?? null,
            createdAt: now,
          })
          .run();

        return { outcome: 'SUCCESS' as const };
      });
    } catch (error) {
      if (error instanceof AdminAuthRepositoryError) throw error;
      throw new AdminAuthRepositoryError(
        'recordKnownCredentialFailureAudit',
        'INTEGRITY_ERROR',
        'Failed to record credential failure audit event.',
        error,
      );
    }
  }

  /**
   * Revokes the current session and records a LOGOUT audit event in one BEGIN IMMEDIATE transaction.
   */
  logoutCurrentSession(input: LogoutCurrentSessionInput): LogoutCurrentSessionResult {
    const now = input.now ?? new Date();

    try {
      return this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () => {
        return this.client.orm.transaction(
          (tx) => {
            const session = tx
              .select()
              .from(adminSessions)
              .where(eq(adminSessions.id, input.sessionId))
              .get();

            if (!session || session.revokedAt !== null) {
              return { outcome: 'NOT_FOUND_OR_REVOKED' as const };
            }

            tx.update(adminSessions)
              .set({
                revokedAt: now,
                revokeReason: 'LOGOUT',
              })
              .where(and(eq(adminSessions.id, input.sessionId), isNull(adminSessions.revokedAt)))
              .run();

            tx.insert(auditEvents)
              .values({
                id: randomUUID(),
                actorAdminUserId: input.adminUserId,
                action: 'LOGOUT',
                entityType: 'ADMIN_SESSION',
                entityId: input.sessionId,
                outcome: 'SUCCESS',
                reasonCode: null,
                correlationDigest: null,
                createdAt: now,
              })
              .run();

            return { outcome: 'SUCCESS' as const };
          },
          { behavior: 'immediate' },
        );
      });
    } catch (error) {
      if (error instanceof AdminAuthRepositoryError) throw error;
      throw new AdminAuthRepositoryError(
        'logoutCurrentSession',
        'INTEGRITY_ERROR',
        'Failed to log out admin session.',
        error,
      );
    }
  }

  /**
   * Finds an AdminUser by normalized username for authentication lookup.
   * Legacy failedLoginCount, lockedUntil, lastFailedLoginAt are excluded from projection.
   */
  findByNormalizedUsername(usernameNormalized: string): AuthAdminUserRow | undefined {
    try {
      return this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () => {
        return this.client.orm
          .select(authAdminUserSelection)
          .from(adminUsers)
          .where(eq(adminUsers.usernameNormalized, usernameNormalized))
          .get();
      });
    } catch (error) {
      if (error instanceof AdminAuthRepositoryError) throw error;
      throw new AdminAuthRepositoryError(
        'findByNormalizedUsername',
        'INTEGRITY_ERROR',
        'Failed to query admin user by username.',
        error,
      );
    }
  }

  /**
   * Counts total AdminUsers to determine if system is initialized.
   */
  countAdminUsers(): number {
    try {
      return this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () => {
        const row = this.client.orm.select({ total: count() }).from(adminUsers).get();
        return row?.total ?? 0;
      });
    } catch (error) {
      if (error instanceof AdminAuthRepositoryError) throw error;
      throw new AdminAuthRepositoryError(
        'countAdminUsers',
        'INTEGRITY_ERROR',
        'Failed to count admin users.',
        error,
      );
    }
  }
}
