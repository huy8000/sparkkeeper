import { randomUUID } from 'node:crypto';

import type { FriendIdentity, FriendMatchField } from '@sparkkeeper/shared';
import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  FriendIdentityError,
  normalizeFriendIdentity,
  selectFriendMatch,
  type NormalizedFriendIdentity,
} from '../identity/index.js';
import { friends, type FriendRow, type NewFriendRow } from '../schema/index.js';

export type Friend = FriendRow;

export interface CreateFriendInput extends FriendIdentity {
  readonly accountId: string;
  readonly matchField?: FriendMatchField;
  readonly enabled?: boolean;
}

export interface UpdateFriendInput {
  readonly displayName?: string;
  readonly remarkName?: string | null;
  readonly shortId?: string | null;
  readonly uniqueId?: string | null;
  readonly secUid?: string | null;
  readonly matchField?: FriendMatchField;
  readonly enabled?: boolean;
}

export class FriendRepositoryError extends Error {
  readonly operation:
    'create' | 'findById' | 'listByAccountId' | 'listEnabledByAccountId' | 'update';

  constructor(operation: FriendRepositoryError['operation'], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FriendRepositoryError';
    this.operation = operation;
  }
}

export class FriendRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateFriendInput): Friend {
    try {
      const identity = normalizeFriendIdentity(input);
      const match = selectFriendMatch(identity, input.matchField);
      const now = new Date();
      const values: NewFriendRow = {
        id: randomUUID(),
        accountId: input.accountId,
        ...identity,
        matchField: match.field,
        matchKey: match.key,
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };

      return this.client.orm.insert(friends).values(values).returning().get();
    } catch (error) {
      throw repositoryError('create', 'Failed to create friend.', error);
    }
  }

  findById(id: string): Friend | undefined {
    try {
      return this.client.orm.select().from(friends).where(eq(friends.id, id)).get();
    } catch (error) {
      throw repositoryError('findById', 'Failed to find friend by id.', error);
    }
  }

  listByAccountId(accountId: string): Friend[] {
    try {
      return this.client.orm
        .select()
        .from(friends)
        .where(eq(friends.accountId, accountId))
        .orderBy(asc(friends.createdAt), asc(friends.id))
        .all();
    } catch (error) {
      throw repositoryError('listByAccountId', 'Failed to list friends for account.', error);
    }
  }

  listEnabledByAccountId(accountId: string): Friend[] {
    try {
      return this.client.orm
        .select()
        .from(friends)
        .where(and(eq(friends.accountId, accountId), eq(friends.enabled, true)))
        .orderBy(asc(friends.createdAt), asc(friends.id))
        .all();
    } catch (error) {
      throw repositoryError(
        'listEnabledByAccountId',
        'Failed to list enabled friends for account.',
        error,
      );
    }
  }

  update(id: string, input: UpdateFriendInput): Friend | undefined {
    try {
      const existing = this.client.orm.select().from(friends).where(eq(friends.id, id)).get();
      if (existing === undefined) {
        return undefined;
      }

      const identityChanged = hasIdentityChange(input);
      const mutableFieldCount =
        Number(identityChanged) +
        Number(input.matchField !== undefined) +
        Number(input.enabled !== undefined);
      if (mutableFieldCount === 0) {
        throw new FriendRepositoryError('update', 'Friend update requires at least one field.');
      }

      const values: Partial<NewFriendRow> = { updatedAt: new Date() };
      if (input.enabled !== undefined) {
        values.enabled = input.enabled;
      }

      if (identityChanged || input.matchField !== undefined) {
        const identity = mergedIdentity(existing, input);
        const match = selectFriendMatch(identity, input.matchField);
        Object.assign(values, identity, {
          matchField: match.field,
          matchKey: match.key,
        });
      }

      return this.client.orm
        .update(friends)
        .set(values)
        .where(eq(friends.id, id))
        .returning()
        .get();
    } catch (error) {
      throw repositoryError('update', 'Failed to update friend.', error);
    }
  }
}

function hasIdentityChange(input: UpdateFriendInput): boolean {
  return (
    input.displayName !== undefined ||
    input.remarkName !== undefined ||
    input.shortId !== undefined ||
    input.uniqueId !== undefined ||
    input.secUid !== undefined
  );
}

function mergedIdentity(existing: Friend, input: UpdateFriendInput): NormalizedFriendIdentity {
  return normalizeFriendIdentity({
    displayName: input.displayName ?? existing.displayName,
    remarkName: input.remarkName === undefined ? existing.remarkName : input.remarkName,
    shortId: input.shortId === undefined ? existing.shortId : input.shortId,
    uniqueId: input.uniqueId === undefined ? existing.uniqueId : input.uniqueId,
    secUid: input.secUid === undefined ? existing.secUid : input.secUid,
  });
}

function repositoryError(
  operation: FriendRepositoryError['operation'],
  fallbackMessage: string,
  error: unknown,
): FriendRepositoryError {
  if (error instanceof FriendRepositoryError) {
    return error;
  }
  if (error instanceof FriendIdentityError) {
    return new FriendRepositoryError(operation, error.message, error);
  }
  return new FriendRepositoryError(operation, fallbackMessage, error);
}
