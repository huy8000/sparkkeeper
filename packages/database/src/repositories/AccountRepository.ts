import { randomUUID } from 'node:crypto';

import {
  isAccountLifecycleStatus,
  isAccountProfileState,
  normalizeOptionalIdentifier,
  validateAccountName,
  type AccountLifecycleStatus,
  type AccountProfileState,
  type LoginStatus,
} from '@sparkkeeper/shared';
import { asc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { accounts, type AccountRow, type NewAccountRow } from '../schema/index.js';

export type Account = AccountRow;

export interface CreateAccountInput {
  readonly name: string;
  readonly enabled?: boolean;
  readonly loginStatus?: LoginStatus;
  readonly lastLoginAt?: Date | null;
  readonly avatarRemoteUrl?: string | null;
  readonly avatarCacheKey?: string | null;
  readonly douyinUniqueId?: string | null;
  readonly douyinShortId?: string | null;
  readonly douyinSecUid?: string | null;
  readonly profileState?: AccountProfileState;
  readonly lifecycleStatus?: AccountLifecycleStatus;
  readonly lastAuthCheckAt?: Date | null;
  readonly lastContactSyncAt?: Date | null;
  readonly unboundAt?: Date | null;
  readonly now?: Date;
}

export interface UpdateAccountInput {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly loginStatus?: LoginStatus;
  readonly lastLoginAt?: Date | null;
  readonly avatarRemoteUrl?: string | null;
  readonly avatarCacheKey?: string | null;
  readonly douyinUniqueId?: string | null;
  readonly douyinShortId?: string | null;
  readonly douyinSecUid?: string | null;
  readonly profileState?: AccountProfileState;
  readonly lifecycleStatus?: AccountLifecycleStatus;
  readonly lastAuthCheckAt?: Date | null;
  readonly lastContactSyncAt?: Date | null;
  readonly unboundAt?: Date | null;
  readonly now?: Date;
}

export class AccountRepositoryError extends Error {
  readonly operation: 'create' | 'findById' | 'findBySecUid' | 'list' | 'update';

  constructor(operation: AccountRepositoryError['operation'], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AccountRepositoryError';
    this.operation = operation;
  }
}

export class AccountRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateAccountInput): Account {
    let name: string;
    let avatarRemoteUrl: string | null;
    let avatarCacheKey: string | null;
    let douyinUniqueId: string | null;
    let douyinShortId: string | null;
    let douyinSecUid: string | null;

    try {
      name = validateAccountName(input.name);
      avatarRemoteUrl = normalizeOptionalIdentifier(input.avatarRemoteUrl);
      avatarCacheKey = normalizeOptionalIdentifier(input.avatarCacheKey);
      douyinUniqueId = normalizeOptionalIdentifier(input.douyinUniqueId);
      douyinShortId = normalizeOptionalIdentifier(input.douyinShortId);
      douyinSecUid = normalizeOptionalIdentifier(input.douyinSecUid);
    } catch (error) {
      throw new AccountRepositoryError(
        'create',
        error instanceof Error ? error.message : 'Invalid account input.',
        error,
      );
    }

    const profileState: AccountProfileState = input.profileState ?? 'MIGRATION_REQUIRED';
    if (!isAccountProfileState(profileState)) {
      throw new AccountRepositoryError('create', 'Invalid account profileState.');
    }

    const lifecycleStatus: AccountLifecycleStatus = input.lifecycleStatus ?? 'ACTIVE';
    if (!isAccountLifecycleStatus(lifecycleStatus)) {
      throw new AccountRepositoryError('create', 'Invalid account lifecycleStatus.');
    }

    const unboundAt = input.unboundAt ?? null;
    if (lifecycleStatus === 'UNBOUND' && unboundAt === null) {
      throw new AccountRepositoryError('create', 'UNBOUND account requires unboundAt timestamp.');
    }
    if (lifecycleStatus === 'ACTIVE' && unboundAt !== null) {
      throw new AccountRepositoryError(
        'create',
        'ACTIVE account must not have unboundAt timestamp.',
      );
    }

    const now = input.now ?? new Date();
    const values: NewAccountRow = {
      id: randomUUID(),
      name,
      enabled: input.enabled ?? true,
      loginStatus: input.loginStatus ?? 'UNKNOWN',
      lastLoginAt: input.lastLoginAt ?? null,
      avatarRemoteUrl,
      avatarCacheKey,
      douyinUniqueId,
      douyinShortId,
      douyinSecUid,
      profileState,
      lifecycleStatus,
      lastAuthCheckAt: input.lastAuthCheckAt ?? null,
      lastContactSyncAt: input.lastContactSyncAt ?? null,
      unboundAt,
      createdAt: now,
      updatedAt: now,
    };

    try {
      return this.client.orm.insert(accounts).values(values).returning().get();
    } catch (error) {
      throw new AccountRepositoryError('create', 'Failed to create account.', error);
    }
  }

  findById(id: string): Account | undefined {
    try {
      return this.client.orm.select().from(accounts).where(eq(accounts.id, id)).get();
    } catch (error) {
      throw new AccountRepositoryError('findById', 'Failed to find account by id.', error);
    }
  }

  findBySecUid(secUid: string): Account | undefined {
    const trimmed = secUid.trim();
    if (trimmed.length === 0) {
      throw new AccountRepositoryError('findBySecUid', 'secUid must not be empty.');
    }
    try {
      return this.client.orm
        .select()
        .from(accounts)
        .where(eq(accounts.douyinSecUid, trimmed))
        .get();
    } catch (error) {
      throw new AccountRepositoryError('findBySecUid', 'Failed to find account by secUid.', error);
    }
  }

  list(options?: { lifecycleStatus?: AccountLifecycleStatus }): Account[] {
    try {
      if (options?.lifecycleStatus !== undefined) {
        return this.client.orm
          .select()
          .from(accounts)
          .where(eq(accounts.lifecycleStatus, options.lifecycleStatus))
          .orderBy(asc(accounts.createdAt), asc(accounts.id))
          .all();
      }
      return this.client.orm
        .select()
        .from(accounts)
        .orderBy(asc(accounts.createdAt), asc(accounts.id))
        .all();
    } catch (error) {
      throw new AccountRepositoryError('list', 'Failed to list accounts.', error);
    }
  }

  update(id: string, input: UpdateAccountInput): Account | undefined {
    const existing = this.findById(id);
    if (!existing) {
      return undefined;
    }

    const now = input.now ?? new Date();
    const values: Partial<NewAccountRow> = { updatedAt: now };
    let mutableFieldCount = 0;

    if (input.name !== undefined) {
      values.name = validateAccountName(input.name);
      mutableFieldCount += 1;
    }
    if (input.enabled !== undefined) {
      values.enabled = input.enabled;
      mutableFieldCount += 1;
    }
    if (input.loginStatus !== undefined) {
      values.loginStatus = input.loginStatus;
      mutableFieldCount += 1;
    }
    if (input.lastLoginAt !== undefined) {
      values.lastLoginAt = input.lastLoginAt;
      mutableFieldCount += 1;
    }
    if (input.avatarRemoteUrl !== undefined) {
      values.avatarRemoteUrl = normalizeOptionalIdentifier(input.avatarRemoteUrl);
      mutableFieldCount += 1;
    }
    if (input.avatarCacheKey !== undefined) {
      values.avatarCacheKey = normalizeOptionalIdentifier(input.avatarCacheKey);
      mutableFieldCount += 1;
    }
    if (input.douyinUniqueId !== undefined) {
      values.douyinUniqueId = normalizeOptionalIdentifier(input.douyinUniqueId);
      mutableFieldCount += 1;
    }
    if (input.douyinShortId !== undefined) {
      values.douyinShortId = normalizeOptionalIdentifier(input.douyinShortId);
      mutableFieldCount += 1;
    }
    if (input.douyinSecUid !== undefined) {
      values.douyinSecUid = normalizeOptionalIdentifier(input.douyinSecUid);
      mutableFieldCount += 1;
    }
    if (input.profileState !== undefined) {
      if (!isAccountProfileState(input.profileState)) {
        throw new AccountRepositoryError('update', 'Invalid account profileState.');
      }
      values.profileState = input.profileState;
      mutableFieldCount += 1;
    }
    if (input.lifecycleStatus !== undefined) {
      if (!isAccountLifecycleStatus(input.lifecycleStatus)) {
        throw new AccountRepositoryError('update', 'Invalid account lifecycleStatus.');
      }
      values.lifecycleStatus = input.lifecycleStatus;
      mutableFieldCount += 1;
    }
    if (input.lastAuthCheckAt !== undefined) {
      values.lastAuthCheckAt = input.lastAuthCheckAt;
      mutableFieldCount += 1;
    }
    if (input.lastContactSyncAt !== undefined) {
      values.lastContactSyncAt = input.lastContactSyncAt;
      mutableFieldCount += 1;
    }
    if (input.unboundAt !== undefined) {
      values.unboundAt = input.unboundAt;
      mutableFieldCount += 1;
    }

    if (mutableFieldCount === 0) {
      throw new AccountRepositoryError('update', 'Account update requires at least one field.');
    }

    const effectiveLifecycle = values.lifecycleStatus ?? existing.lifecycleStatus;
    const effectiveUnboundAt =
      values.unboundAt !== undefined ? values.unboundAt : existing.unboundAt;
    if (effectiveLifecycle === 'UNBOUND' && effectiveUnboundAt === null) {
      throw new AccountRepositoryError('update', 'UNBOUND account requires unboundAt timestamp.');
    }
    if (effectiveLifecycle === 'ACTIVE' && effectiveUnboundAt !== null) {
      throw new AccountRepositoryError(
        'update',
        'ACTIVE account must not have unboundAt timestamp.',
      );
    }

    try {
      return this.client.orm
        .update(accounts)
        .set(values)
        .where(eq(accounts.id, id))
        .returning()
        .get();
    } catch (error) {
      throw new AccountRepositoryError('update', 'Failed to update account.', error);
    }
  }
}
