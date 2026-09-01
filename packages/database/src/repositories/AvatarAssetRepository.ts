import { randomUUID } from 'node:crypto';

import { and, asc, eq, isNotNull, lte } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import { avatarAssets, type AvatarAssetRow, type NewAvatarAssetRow } from '../schema/index.js';

export type AvatarAsset = AvatarAssetRow;

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTE_SIZE = 5_242_880;

export function validateAvatarCacheKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new Error('Avatar cache key must not be empty.');
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    throw new Error('Avatar cache key must not start with a slash.');
  }
  if (/^[a-zA-Z]:/.test(trimmed)) {
    throw new Error('Avatar cache key must not contain Windows drive paths.');
  }
  if (trimmed.includes('..') || trimmed.includes('\\')) {
    throw new Error('Avatar cache key must not contain path traversal segments or backslashes.');
  }
  if (!/^[a-zA-Z0-9_\-./]+$/.test(trimmed)) {
    throw new Error('Avatar cache key contains invalid characters.');
  }
  return trimmed;
}

export interface CreateAvatarAssetInput {
  readonly accountId: string;
  readonly cacheKey: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly contentDigest: string;
  readonly fetchedAt?: Date;
  readonly lastReferencedAt?: Date;
  readonly expiresAt?: Date | null;
  readonly now?: Date;
}

export class AvatarAssetRepositoryError extends RepositoryError {
  readonly avatarOperation:
    | 'create'
    | 'findById'
    | 'findByCacheKey'
    | 'findExpiryCandidates'
    | 'touch'
    | 'deleteById'
    | 'listByAccountId';

  constructor(
    operation: AvatarAssetRepositoryError['avatarOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'AvatarAsset', operation, cause });
    this.name = 'AvatarAssetRepositoryError';
    this.avatarOperation = operation;
  }
}

export class AvatarAssetRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateAvatarAssetInput): AvatarAsset {
    const accountId = input.accountId.trim();
    if (accountId.length === 0) {
      throw new AvatarAssetRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }

    let cacheKey: string;
    try {
      cacheKey = validateAvatarCacheKey(input.cacheKey);
    } catch (e) {
      throw new AvatarAssetRepositoryError(
        'create',
        'VALIDATION_ERROR',
        e instanceof Error ? e.message : 'Invalid avatar cacheKey.',
        e,
      );
    }

    const mediaType = input.mediaType.trim();
    const contentDigest = input.contentDigest.trim();

    if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
      throw new AvatarAssetRepositoryError(
        'create',
        'VALIDATION_ERROR',
        `mediaType must be one of: ${ALLOWED_MEDIA_TYPES.join(', ')}.`,
      );
    }
    if (!Number.isInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > MAX_BYTE_SIZE) {
      throw new AvatarAssetRepositoryError(
        'create',
        'VALIDATION_ERROR',
        `byteSize must be an integer between 1 and ${MAX_BYTE_SIZE}.`,
      );
    }
    if (contentDigest.length === 0) {
      throw new AvatarAssetRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'contentDigest must not be empty.',
      );
    }

    const now = input.now ?? new Date();
    const values: NewAvatarAssetRow = {
      id: randomUUID(),
      accountId,
      cacheKey,
      mediaType,
      byteSize: input.byteSize,
      contentDigest,
      fetchedAt: input.fetchedAt ?? now,
      lastReferencedAt: input.lastReferencedAt ?? now,
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    };

    try {
      return this.client.orm.insert(avatarAssets).values(values).returning().get();
    } catch (error) {
      if (error instanceof AvatarAssetRepositoryError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new AvatarAssetRepositoryError(
          'create',
          'CONFLICT',
          `Avatar asset with cacheKey '${cacheKey}' already exists.`,
          error,
        );
      }
      throw new AvatarAssetRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create avatar asset.',
        error,
      );
    }
  }

  findById(id: string): AvatarAsset | undefined {
    try {
      return this.client.orm.select().from(avatarAssets).where(eq(avatarAssets.id, id)).get();
    } catch (error) {
      throw new AvatarAssetRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find avatar asset by id.',
        error,
      );
    }
  }

  findByCacheKey(cacheKey: string): AvatarAsset | undefined {
    let trimmed: string;
    try {
      trimmed = validateAvatarCacheKey(cacheKey);
    } catch (e) {
      throw new AvatarAssetRepositoryError(
        'findByCacheKey',
        'VALIDATION_ERROR',
        e instanceof Error ? e.message : 'Invalid cacheKey.',
        e,
      );
    }

    try {
      return this.client.orm
        .select()
        .from(avatarAssets)
        .where(eq(avatarAssets.cacheKey, trimmed))
        .get();
    } catch (error) {
      throw new AvatarAssetRepositoryError(
        'findByCacheKey',
        'INTEGRITY_ERROR',
        'Failed to find avatar asset by cacheKey.',
        error,
      );
    }
  }

  findExpiryCandidates(options: { beforeDate: Date; limit?: number }): AvatarAsset[] {
    const limit = Math.min(Math.max(1, options.limit ?? 50), 1000);
    try {
      return this.client.orm
        .select()
        .from(avatarAssets)
        .where(
          and(isNotNull(avatarAssets.expiresAt), lte(avatarAssets.expiresAt, options.beforeDate)),
        )
        .orderBy(asc(avatarAssets.expiresAt), asc(avatarAssets.id))
        .limit(limit)
        .all();
    } catch (error) {
      throw new AvatarAssetRepositoryError(
        'findExpiryCandidates',
        'INTEGRITY_ERROR',
        'Failed to find avatar asset expiry candidates.',
        error,
      );
    }
  }

  touch(id: string, now?: Date): AvatarAsset | undefined {
    const timestamp = now ?? new Date();
    try {
      return this.client.orm
        .update(avatarAssets)
        .set({
          lastReferencedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(avatarAssets.id, id))
        .returning()
        .get();
    } catch (error) {
      throw new AvatarAssetRepositoryError(
        'touch',
        'INTEGRITY_ERROR',
        'Failed to touch avatar asset.',
        error,
      );
    }
  }

  deleteById(id: string): boolean {
    try {
      const result = this.client.orm
        .delete(avatarAssets)
        .where(eq(avatarAssets.id, id))
        .returning()
        .all();
      return result.length > 0;
    } catch (error) {
      throw new AvatarAssetRepositoryError(
        'deleteById',
        'INTEGRITY_ERROR',
        'Failed to delete avatar asset.',
        error,
      );
    }
  }

  listByAccountId(accountId: string, options?: { limit?: number; offset?: number }): AvatarAsset[] {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new AvatarAssetRepositoryError(
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
        .from(avatarAssets)
        .where(eq(avatarAssets.accountId, trimmed))
        .orderBy(asc(avatarAssets.createdAt), asc(avatarAssets.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new AvatarAssetRepositoryError(
        'listByAccountId',
        'INTEGRITY_ERROR',
        'Failed to list avatar assets by accountId.',
        error,
      );
    }
  }
}
