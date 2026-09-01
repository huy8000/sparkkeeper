import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  adminSessions,
  adminUsers,
  type AdminSessionRow,
  type AdminUserRow,
  type NewAdminSessionRow,
} from '../schema/index.js';

export type AdminSession = AdminSessionRow;
export type AdminUser = AdminUserRow;

export interface CreateAdminSessionInput {
  readonly adminUserId: string;
  readonly tokenDigest: string;
  readonly csrfTokenDigest: string;
  readonly sessionVersion: number;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly reauthenticatedAt?: Date | null;
  readonly now?: Date;
}

export class AdminSessionRepositoryError extends RepositoryError {
  readonly sessionOperation:
    | 'create'
    | 'findById'
    | 'findByTokenDigest'
    | 'findActiveByTokenDigest'
    | 'touch'
    | 'reauthenticate'
    | 'revoke'
    | 'revokeAllForUser'
    | 'purgeExpired';

  constructor(
    operation: AdminSessionRepositoryError['sessionOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'AdminSession', operation, cause });
    this.name = 'AdminSessionRepositoryError';
    this.sessionOperation = operation;
  }
}

export class AdminSessionRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateAdminSessionInput): AdminSession {
    const adminUserId = input.adminUserId.trim();
    const tokenDigest = input.tokenDigest.trim();
    const csrfTokenDigest = input.csrfTokenDigest.trim();

    if (adminUserId.length === 0) {
      throw new AdminSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'adminUserId must not be empty.',
      );
    }
    if (tokenDigest.length === 0) {
      throw new AdminSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'tokenDigest must not be empty.',
      );
    }
    if (csrfTokenDigest.length === 0) {
      throw new AdminSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'csrfTokenDigest must not be empty.',
      );
    }
    if (!Number.isInteger(input.sessionVersion) || input.sessionVersion < 1) {
      throw new AdminSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'sessionVersion must be an integer >= 1.',
      );
    }

    const now = input.now ?? new Date();
    if (input.absoluteExpiresAt <= now) {
      throw new AdminSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'absoluteExpiresAt must be after creation time.',
      );
    }
    if (input.idleExpiresAt > input.absoluteExpiresAt) {
      throw new AdminSessionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'idleExpiresAt must not exceed absoluteExpiresAt.',
      );
    }

    const values: NewAdminSessionRow = {
      id: randomUUID(),
      adminUserId,
      tokenDigest,
      csrfTokenDigest,
      sessionVersion: input.sessionVersion,
      reauthenticatedAt: input.reauthenticatedAt ?? null,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      revokedAt: null,
      revokeReason: null,
    };

    try {
      return this.client.orm.insert(adminSessions).values(values).returning().get();
    } catch (error) {
      throw new AdminSessionRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create admin session.',
        error,
      );
    }
  }

  findById(id: string): AdminSession | undefined {
    try {
      return this.client.orm.select().from(adminSessions).where(eq(adminSessions.id, id)).get();
    } catch (error) {
      throw new AdminSessionRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find admin session by id.',
        error,
      );
    }
  }

  findByTokenDigest(tokenDigest: string): AdminSession | undefined {
    const trimmed = tokenDigest.trim();
    if (trimmed.length === 0) {
      throw new AdminSessionRepositoryError(
        'findByTokenDigest',
        'VALIDATION_ERROR',
        'tokenDigest must not be empty.',
      );
    }
    try {
      return this.client.orm
        .select()
        .from(adminSessions)
        .where(eq(adminSessions.tokenDigest, trimmed))
        .get();
    } catch (error) {
      throw new AdminSessionRepositoryError(
        'findByTokenDigest',
        'INTEGRITY_ERROR',
        'Failed to find admin session by token digest.',
        error,
      );
    }
  }

  findActiveByTokenDigest(
    tokenDigest: string,
    now?: Date,
  ): { session: AdminSession; user: AdminUser } | undefined {
    const trimmed = tokenDigest.trim();
    if (trimmed.length === 0) {
      throw new AdminSessionRepositoryError(
        'findActiveByTokenDigest',
        'VALIDATION_ERROR',
        'tokenDigest must not be empty.',
      );
    }
    const currentTime = now ?? new Date();

    try {
      const session = this.client.orm
        .select()
        .from(adminSessions)
        .where(
          and(
            eq(adminSessions.tokenDigest, trimmed),
            isNull(adminSessions.revokedAt),
            gt(adminSessions.idleExpiresAt, currentTime),
            gt(adminSessions.absoluteExpiresAt, currentTime),
          ),
        )
        .get();

      if (!session) return undefined;

      const user = this.client.orm
        .select()
        .from(adminUsers)
        .where(and(eq(adminUsers.id, session.adminUserId), eq(adminUsers.status, 'ACTIVE')))
        .get();

      if (!user) return undefined;
      if (session.sessionVersion !== user.sessionVersion) return undefined;

      return { session, user };
    } catch (error) {
      if (error instanceof AdminSessionRepositoryError) throw error;
      throw new AdminSessionRepositoryError(
        'findActiveByTokenDigest',
        'INTEGRITY_ERROR',
        'Failed to find active admin session by token digest.',
        error,
      );
    }
  }

  touch(id: string, options: { lastSeenAt: Date; idleExpiresAt: Date }): AdminSession | undefined {
    try {
      return this.client.orm
        .update(adminSessions)
        .set({
          lastSeenAt: options.lastSeenAt,
          idleExpiresAt: options.idleExpiresAt,
        })
        .where(and(eq(adminSessions.id, id), isNull(adminSessions.revokedAt)))
        .returning()
        .get();
    } catch (error) {
      throw new AdminSessionRepositoryError(
        'touch',
        'INTEGRITY_ERROR',
        'Failed to touch admin session.',
        error,
      );
    }
  }

  reauthenticate(
    id: string,
    options: { reauthenticatedAt: Date; lastSeenAt: Date; idleExpiresAt: Date },
  ): AdminSession | undefined {
    try {
      return this.client.orm
        .update(adminSessions)
        .set({
          reauthenticatedAt: options.reauthenticatedAt,
          lastSeenAt: options.lastSeenAt,
          idleExpiresAt: options.idleExpiresAt,
        })
        .where(and(eq(adminSessions.id, id), isNull(adminSessions.revokedAt)))
        .returning()
        .get();
    } catch (error) {
      throw new AdminSessionRepositoryError(
        'reauthenticate',
        'INTEGRITY_ERROR',
        'Failed to reauthenticate admin session.',
        error,
      );
    }
  }

  revoke(id: string, options: { revokedAt: Date; reason: string }): AdminSession | undefined {
    const reason = options.reason.trim();
    if (reason.length === 0) {
      throw new AdminSessionRepositoryError(
        'revoke',
        'VALIDATION_ERROR',
        'Revoke reason must not be empty.',
      );
    }

    try {
      return this.client.orm
        .update(adminSessions)
        .set({
          revokedAt: options.revokedAt,
          revokeReason: reason,
        })
        .where(eq(adminSessions.id, id))
        .returning()
        .get();
    } catch (error) {
      throw new AdminSessionRepositoryError(
        'revoke',
        'INTEGRITY_ERROR',
        'Failed to revoke admin session.',
        error,
      );
    }
  }

  revokeAllForUser(adminUserId: string, options: { revokedAt: Date; reason: string }): number {
    const reason = options.reason.trim();
    if (reason.length === 0) {
      throw new AdminSessionRepositoryError(
        'revokeAllForUser',
        'VALIDATION_ERROR',
        'Revoke reason must not be empty.',
      );
    }

    try {
      const result = this.client.orm
        .update(adminSessions)
        .set({
          revokedAt: options.revokedAt,
          revokeReason: reason,
        })
        .where(and(eq(adminSessions.adminUserId, adminUserId), isNull(adminSessions.revokedAt)))
        .returning()
        .all();
      return result.length;
    } catch (error) {
      throw new AdminSessionRepositoryError(
        'revokeAllForUser',
        'INTEGRITY_ERROR',
        'Failed to revoke all admin sessions for user.',
        error,
      );
    }
  }

  purgeExpired(now: Date): number {
    try {
      const result = this.client.orm
        .delete(adminSessions)
        .where(or(lte(adminSessions.absoluteExpiresAt, now), lte(adminSessions.idleExpiresAt, now)))
        .returning()
        .all();
      return result.length;
    } catch (error) {
      throw new AdminSessionRepositoryError(
        'purgeExpired',
        'INTEGRITY_ERROR',
        'Failed to purge expired sessions.',
        error,
      );
    }
  }
}
