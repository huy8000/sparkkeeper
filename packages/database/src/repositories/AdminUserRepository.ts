import { randomUUID } from 'node:crypto';

import {
  isAdminUserStatus,
  normalizeAdminUsername,
  validateAdminUsername,
  type AdminUserStatus,
} from '@sparkkeeper/shared';
import { count, eq, sql } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import { adminUsers, type AdminUserRow, type NewAdminUserRow } from '../schema/index.js';

export type AdminUser = AdminUserRow;

export interface CreateAdminUserInput {
  readonly username: string;
  readonly passwordHash: string;
  readonly status?: AdminUserStatus;
  readonly now?: Date;
}

export interface UpdateAdminUserInput {
  readonly username?: string;
  readonly passwordHash?: string;
  readonly status?: AdminUserStatus;
  readonly sessionVersionIncrement?: boolean;
  readonly failedLoginCount?: number;
  readonly incrementFailedLoginCount?: boolean;
  readonly lockedUntil?: Date | null;
  readonly lastFailedLoginAt?: Date | null;
  readonly lastLoginAt?: Date | null;
  readonly passwordChangedAt?: Date;
  readonly now?: Date;
}

export class AdminUserRepositoryError extends RepositoryError {
  readonly adminOperation:
    'create' | 'findById' | 'findByUsername' | 'findActiveAdmin' | 'update' | 'count';

  constructor(
    operation: AdminUserRepositoryError['adminOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'AdminUser', operation, cause });
    this.name = 'AdminUserRepositoryError';
    this.adminOperation = operation;
  }
}

export class AdminUserRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateAdminUserInput): AdminUser {
    let username: string;
    let usernameNormalized: string;
    try {
      username = validateAdminUsername(input.username);
      usernameNormalized = normalizeAdminUsername(username);
    } catch (error) {
      throw new AdminUserRepositoryError(
        'create',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid admin username.',
        error,
      );
    }

    const trimmedHash = input.passwordHash.trim();
    if (trimmedHash.length === 0) {
      throw new AdminUserRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'passwordHash must not be empty.',
      );
    }

    const status: AdminUserStatus = input.status ?? 'ACTIVE';
    if (!isAdminUserStatus(status)) {
      throw new AdminUserRepositoryError('create', 'VALIDATION_ERROR', 'Invalid admin status.');
    }

    const now = input.now ?? new Date();
    const values: NewAdminUserRow = {
      id: randomUUID(),
      username,
      usernameNormalized,
      passwordHash: trimmedHash,
      status,
      sessionVersion: 1,
      failedLoginCount: 0,
      lockedUntil: null,
      lastFailedLoginAt: null,
      lastLoginAt: null,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    try {
      return this.client.orm.insert(adminUsers).values(values).returning().get();
    } catch (error) {
      if (error instanceof AdminUserRepositoryError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new AdminUserRepositoryError(
          'create',
          'CONFLICT',
          'Admin user conflict: only 1 ACTIVE admin allowed, or username is taken.',
          error,
        );
      }
      throw new AdminUserRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create admin user.',
        error,
      );
    }
  }

  findById(id: string): AdminUser | undefined {
    try {
      return this.client.orm.select().from(adminUsers).where(eq(adminUsers.id, id)).get();
    } catch (error) {
      throw new AdminUserRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find admin user by id.',
        error,
      );
    }
  }

  findByUsername(username: string): AdminUser | undefined {
    const trimmed = username.trim();
    if (trimmed.length === 0) {
      throw new AdminUserRepositoryError(
        'findByUsername',
        'VALIDATION_ERROR',
        'username must not be empty.',
      );
    }
    const normalized = normalizeAdminUsername(trimmed);

    try {
      return this.client.orm
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.usernameNormalized, normalized))
        .get();
    } catch (error) {
      throw new AdminUserRepositoryError(
        'findByUsername',
        'INTEGRITY_ERROR',
        'Failed to find admin user by username.',
        error,
      );
    }
  }

  findActiveAdmin(): AdminUser | undefined {
    try {
      return this.client.orm
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.status, 'ACTIVE'))
        .limit(1)
        .get();
    } catch (error) {
      throw new AdminUserRepositoryError(
        'findActiveAdmin',
        'INTEGRITY_ERROR',
        'Failed to find active admin user.',
        error,
      );
    }
  }

  update(id: string, input: UpdateAdminUserInput): AdminUser | undefined {
    const existing = this.findById(id);
    if (!existing) {
      return undefined;
    }

    const now = input.now ?? new Date();
    const values: Record<string, unknown> = { updatedAt: now };
    let mutationCount = 0;

    if (input.username !== undefined) {
      const valid = validateAdminUsername(input.username);
      values.username = valid;
      values.usernameNormalized = normalizeAdminUsername(valid);
      mutationCount += 1;
    }
    if (input.passwordHash !== undefined) {
      const trimmed = input.passwordHash.trim();
      if (trimmed.length === 0) {
        throw new AdminUserRepositoryError(
          'update',
          'VALIDATION_ERROR',
          'passwordHash must not be empty.',
        );
      }
      values.passwordHash = trimmed;
      values.passwordChangedAt = input.passwordChangedAt ?? now;
      // Changing password atomically increments sessionVersion to invalidate existing sessions
      values.sessionVersion = sql`${adminUsers.sessionVersion} + 1`;
      mutationCount += 1;
    }
    if (input.status !== undefined) {
      if (!isAdminUserStatus(input.status)) {
        throw new AdminUserRepositoryError(
          'update',
          'VALIDATION_ERROR',
          'Invalid admin user status.',
        );
      }
      values.status = input.status;
      mutationCount += 1;
    }
    if (input.sessionVersionIncrement && input.passwordHash === undefined) {
      values.sessionVersion = sql`${adminUsers.sessionVersion} + 1`;
      mutationCount += 1;
    }
    if (input.incrementFailedLoginCount) {
      values.failedLoginCount = sql`${adminUsers.failedLoginCount} + 1`;
      mutationCount += 1;
    } else if (input.failedLoginCount !== undefined) {
      if (!Number.isInteger(input.failedLoginCount) || input.failedLoginCount < 0) {
        throw new AdminUserRepositoryError(
          'update',
          'VALIDATION_ERROR',
          'failedLoginCount must be a non-negative integer.',
        );
      }
      values.failedLoginCount = input.failedLoginCount;
      mutationCount += 1;
    }
    if (input.lockedUntil !== undefined) {
      values.lockedUntil = input.lockedUntil;
      mutationCount += 1;
    }
    if (input.lastFailedLoginAt !== undefined) {
      values.lastFailedLoginAt = input.lastFailedLoginAt;
      mutationCount += 1;
    }
    if (input.lastLoginAt !== undefined) {
      values.lastLoginAt = input.lastLoginAt;
      mutationCount += 1;
    }

    if (mutationCount === 0) {
      throw new AdminUserRepositoryError(
        'update',
        'VALIDATION_ERROR',
        'AdminUser update requires at least one field.',
      );
    }

    try {
      return this.client.orm
        .update(adminUsers)
        .set(values)
        .where(eq(adminUsers.id, id))
        .returning()
        .get();
    } catch (error) {
      if (error instanceof AdminUserRepositoryError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new AdminUserRepositoryError(
          'update',
          'CONFLICT',
          'Admin user conflict: only 1 ACTIVE admin allowed, or username is taken.',
          error,
        );
      }
      throw new AdminUserRepositoryError(
        'update',
        'INTEGRITY_ERROR',
        'Failed to update admin user.',
        error,
      );
    }
  }

  count(): number {
    try {
      const result = this.client.orm.select({ val: count() }).from(adminUsers).get();
      return result?.val ?? 0;
    } catch (error) {
      throw new AdminUserRepositoryError(
        'count',
        'INTEGRITY_ERROR',
        'Failed to count admin users.',
        error,
      );
    }
  }
}
