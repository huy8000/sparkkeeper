import { randomUUID } from 'node:crypto';

import type { LoginStatus } from '@sparkkeeper/shared';
import { asc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { accounts, type AccountRow, type NewAccountRow } from '../schema/index.js';

export type Account = AccountRow;

export interface CreateAccountInput {
  readonly name: string;
  readonly enabled?: boolean;
  readonly loginStatus?: LoginStatus;
  readonly lastLoginAt?: Date | null;
}

export interface UpdateAccountInput {
  readonly name?: string;
  readonly enabled?: boolean;
  readonly loginStatus?: LoginStatus;
  readonly lastLoginAt?: Date | null;
}

export class AccountRepositoryError extends Error {
  readonly operation: 'create' | 'findById' | 'list' | 'update';

  constructor(operation: AccountRepositoryError['operation'], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AccountRepositoryError';
    this.operation = operation;
  }
}

export class AccountRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateAccountInput): Account {
    const name = validateName(input.name, 'create');
    const now = new Date();
    const values: NewAccountRow = {
      id: randomUUID(),
      name,
      enabled: input.enabled ?? true,
      loginStatus: input.loginStatus ?? 'UNKNOWN',
      lastLoginAt: input.lastLoginAt ?? null,
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

  list(): Account[] {
    try {
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
    const values: Partial<NewAccountRow> = { updatedAt: new Date() };
    let mutableFieldCount = 0;

    if (input.name !== undefined) {
      values.name = validateName(input.name, 'update');
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

    if (mutableFieldCount === 0) {
      throw new AccountRepositoryError('update', 'Account update requires at least one field.');
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

function validateName(name: string, operation: AccountRepositoryError['operation']): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AccountRepositoryError(operation, 'Account name must not be empty.');
  }
  return trimmed;
}
