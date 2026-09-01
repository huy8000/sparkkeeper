import { randomUUID } from 'node:crypto';

import {
  isContactIdentityKind,
  isContactIdentitySource,
  isContactIdentityState,
  validateIdentityValue,
  type ContactIdentityKind,
  type ContactIdentitySource,
  type ContactIdentityState,
} from '@sparkkeeper/shared';
import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  contactIdentities,
  contacts,
  type ContactIdentityRow,
  type NewContactIdentityRow,
} from '../schema/index.js';
import { ALLOWED_PREFERRED_IDENTITY_KINDS } from './ContactRepository.js';

export type ContactIdentity = ContactIdentityRow;

export interface CreateContactIdentityInput {
  readonly accountId: string;
  readonly contactId: string;
  readonly kind: ContactIdentityKind;
  readonly value: string;
  readonly source: ContactIdentitySource;
  readonly state?: ContactIdentityState;
  readonly isPreferred?: boolean;
  readonly firstObservedAt?: Date;
  readonly lastObservedAt?: Date;
  readonly supersededAt?: Date | null;
  readonly now?: Date;
}

export class ContactIdentityRepositoryError extends RepositoryError {
  readonly identityOperation:
    | 'create'
    | 'findById'
    | 'findActiveByKind'
    | 'findPreferredActiveByContactId'
    | 'listByContactId'
    | 'setPreferred'
    | 'supersede'
    | 'touchObserved';

  constructor(
    operation: ContactIdentityRepositoryError['identityOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'ContactIdentity', operation, cause });
    this.name = 'ContactIdentityRepositoryError';
    this.identityOperation = operation;
  }
}

export class ContactIdentityRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateContactIdentityInput): ContactIdentity {
    const accountId = input.accountId.trim();
    const contactId = input.contactId.trim();

    if (accountId.length === 0) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    if (contactId.length === 0) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'contactId must not be empty.',
      );
    }
    if (!isContactIdentityKind(input.kind)) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid contact identity kind.',
      );
    }
    if (!isContactIdentitySource(input.source)) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid contact identity source.',
      );
    }

    let value: string;
    try {
      value = validateIdentityValue(input.value);
    } catch (error) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid identity value.',
        error,
      );
    }
    const normalizedValue = value.trim();

    const state: ContactIdentityState = input.state ?? 'ACTIVE';
    if (!isContactIdentityState(state)) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid contact identity state.',
      );
    }

    const isPreferred = input.isPreferred ?? false;
    if (isPreferred && state !== 'ACTIVE') {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Preferred identity must be ACTIVE.',
      );
    }

    const now = input.now ?? new Date();
    const firstObservedAt = input.firstObservedAt ?? now;
    const lastObservedAt = input.lastObservedAt ?? now;

    if (firstObservedAt > lastObservedAt) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'firstObservedAt must be <= lastObservedAt.',
      );
    }

    const supersededAt = input.supersededAt ?? (state === 'SUPERSEDED' ? now : null);
    if (state === 'SUPERSEDED' && supersededAt === null) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'SUPERSEDED identity requires supersededAt.',
      );
    }
    if (state === 'ACTIVE' && supersededAt !== null) {
      throw new ContactIdentityRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'ACTIVE identity must not have supersededAt.',
      );
    }

    try {
      return this.client.orm.transaction((tx) => {
        const contact = tx.select().from(contacts).where(eq(contacts.id, contactId)).get();
        if (!contact) {
          throw new ContactIdentityRepositoryError(
            'create',
            'NOT_FOUND',
            `Contact '${contactId}' not found.`,
          );
        }
        if (contact.accountId !== accountId) {
          throw new ContactIdentityRepositoryError(
            'create',
            'ACCOUNT_MISMATCH',
            `Identity account '${accountId}' does not match contact account '${contact.accountId}'.`,
          );
        }

        if (isPreferred) {
          const allowedKinds = ALLOWED_PREFERRED_IDENTITY_KINDS[contact.type] ?? [];
          if (!allowedKinds.includes(input.kind)) {
            throw new ContactIdentityRepositoryError(
              'create',
              'UNSUPPORTED_TARGET_TYPE',
              `Identity kind '${input.kind}' is not supported as preferred for contact type '${contact.type}'.`,
            );
          }
        }

        const values: NewContactIdentityRow = {
          id: randomUUID(),
          accountId,
          contactId,
          kind: input.kind,
          value,
          normalizedValue,
          source: input.source,
          state,
          isPreferred,
          firstObservedAt,
          lastObservedAt,
          supersededAt,
          createdAt: now,
          updatedAt: now,
        };

        return tx.insert(contactIdentities).values(values).returning().get();
      });
    } catch (error) {
      if (error instanceof ContactIdentityRepositoryError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new ContactIdentityRepositoryError(
          'create',
          'IDENTITY_CONFLICT',
          'Active identity conflict: duplicate preferred identity or duplicate stable identity for this account.',
          error,
        );
      }
      throw new ContactIdentityRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create contact identity.',
        error,
      );
    }
  }

  findById(id: string): ContactIdentity | undefined {
    try {
      return this.client.orm
        .select()
        .from(contactIdentities)
        .where(eq(contactIdentities.id, id))
        .get();
    } catch (error) {
      throw new ContactIdentityRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find contact identity by id.',
        error,
      );
    }
  }

  findActiveByKind(
    accountId: string,
    kind: ContactIdentityKind,
    normalizedValue: string,
  ): ContactIdentity | undefined {
    const trimmedAccount = accountId.trim();
    const trimmedVal = normalizedValue.trim();

    if (trimmedAccount.length === 0) {
      throw new ContactIdentityRepositoryError(
        'findActiveByKind',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    if (!isContactIdentityKind(kind)) {
      throw new ContactIdentityRepositoryError(
        'findActiveByKind',
        'VALIDATION_ERROR',
        'Invalid contact identity kind.',
      );
    }
    if (trimmedVal.length === 0) {
      throw new ContactIdentityRepositoryError(
        'findActiveByKind',
        'VALIDATION_ERROR',
        'normalizedValue must not be empty.',
      );
    }

    try {
      return this.client.orm
        .select()
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.accountId, trimmedAccount),
            eq(contactIdentities.kind, kind),
            eq(contactIdentities.normalizedValue, trimmedVal),
            eq(contactIdentities.state, 'ACTIVE'),
          ),
        )
        .get();
    } catch (error) {
      throw new ContactIdentityRepositoryError(
        'findActiveByKind',
        'INTEGRITY_ERROR',
        'Failed to find active contact identity.',
        error,
      );
    }
  }

  findPreferredActiveByContactId(contactId: string): ContactIdentity | undefined {
    const trimmed = contactId.trim();
    if (trimmed.length === 0) {
      throw new ContactIdentityRepositoryError(
        'findPreferredActiveByContactId',
        'VALIDATION_ERROR',
        'contactId must not be empty.',
      );
    }

    try {
      return this.client.orm
        .select()
        .from(contactIdentities)
        .where(
          and(
            eq(contactIdentities.contactId, trimmed),
            eq(contactIdentities.state, 'ACTIVE'),
            eq(contactIdentities.isPreferred, true),
          ),
        )
        .get();
    } catch (error) {
      throw new ContactIdentityRepositoryError(
        'findPreferredActiveByContactId',
        'INTEGRITY_ERROR',
        'Failed to find preferred active contact identity.',
        error,
      );
    }
  }

  listByContactId(
    contactId: string,
    options?: { limit?: number; offset?: number },
  ): ContactIdentity[] {
    const trimmed = contactId.trim();
    if (trimmed.length === 0) {
      throw new ContactIdentityRepositoryError(
        'listByContactId',
        'VALIDATION_ERROR',
        'contactId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(contactIdentities)
        .where(eq(contactIdentities.contactId, trimmed))
        .orderBy(asc(contactIdentities.createdAt), asc(contactIdentities.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new ContactIdentityRepositoryError(
        'listByContactId',
        'INTEGRITY_ERROR',
        'Failed to list contact identities.',
        error,
      );
    }
  }

  setPreferred(
    contactId: string,
    identityId: string,
    now?: Date,
  ): { previousPreferred?: ContactIdentity | undefined; newPreferred: ContactIdentity } {
    const timestamp = now ?? new Date();

    try {
      return this.client.orm.transaction((tx) => {
        const contact = tx.select().from(contacts).where(eq(contacts.id, contactId)).get();
        if (!contact) {
          throw new ContactIdentityRepositoryError(
            'setPreferred',
            'NOT_FOUND',
            `Contact '${contactId}' not found.`,
          );
        }

        const target = tx
          .select()
          .from(contactIdentities)
          .where(eq(contactIdentities.id, identityId))
          .get();
        if (!target || target.contactId !== contactId) {
          throw new ContactIdentityRepositoryError(
            'setPreferred',
            'NOT_FOUND',
            `Target identity '${identityId}' not found for contact '${contactId}'.`,
          );
        }
        if (target.accountId !== contact.accountId) {
          throw new ContactIdentityRepositoryError(
            'setPreferred',
            'ACCOUNT_MISMATCH',
            `Identity account '${target.accountId}' does not match contact account '${contact.accountId}'.`,
          );
        }
        if (target.state !== 'ACTIVE') {
          throw new ContactIdentityRepositoryError(
            'setPreferred',
            'INVALID_TRANSITION',
            'Cannot set non-ACTIVE identity as preferred.',
          );
        }

        const allowedKinds = ALLOWED_PREFERRED_IDENTITY_KINDS[contact.type] ?? [];
        if (!allowedKinds.includes(target.kind)) {
          throw new ContactIdentityRepositoryError(
            'setPreferred',
            'UNSUPPORTED_TARGET_TYPE',
            `Identity kind '${target.kind}' is not allowed as preferred identity for contact type '${contact.type}'.`,
          );
        }

        const currentPreferred = tx
          .select()
          .from(contactIdentities)
          .where(
            and(
              eq(contactIdentities.contactId, contactId),
              eq(contactIdentities.state, 'ACTIVE'),
              eq(contactIdentities.isPreferred, true),
            ),
          )
          .get();

        if (currentPreferred && currentPreferred.id !== identityId) {
          tx.update(contactIdentities)
            .set({ isPreferred: false, updatedAt: timestamp })
            .where(eq(contactIdentities.id, currentPreferred.id))
            .run();
        }

        const newPreferred = tx
          .update(contactIdentities)
          .set({ isPreferred: true, updatedAt: timestamp })
          .where(eq(contactIdentities.id, identityId))
          .returning()
          .get();

        return {
          previousPreferred: currentPreferred?.id !== identityId ? currentPreferred : undefined,
          newPreferred,
        };
      });
    } catch (error) {
      if (error instanceof ContactIdentityRepositoryError) throw error;
      throw new ContactIdentityRepositoryError(
        'setPreferred',
        'INTEGRITY_ERROR',
        'Failed to set preferred contact identity.',
        error,
      );
    }
  }

  supersede(
    id: string,
    options?: {
      replacement?: {
        kind: ContactIdentityKind;
        value: string;
        source: ContactIdentitySource;
      };
      now?: Date;
    },
  ): ContactIdentity | undefined {
    const timestamp = options?.now ?? new Date();
    try {
      return this.client.orm.transaction((tx) => {
        const existing = tx
          .select()
          .from(contactIdentities)
          .where(eq(contactIdentities.id, id))
          .get();
        if (!existing) return undefined;
        if (existing.state !== 'ACTIVE') {
          throw new ContactIdentityRepositoryError(
            'supersede',
            'INVALID_TRANSITION',
            `Cannot supersede identity in status '${existing.state}'.`,
          );
        }

        const contact = tx.select().from(contacts).where(eq(contacts.id, existing.contactId)).get();
        if (!contact) {
          throw new ContactIdentityRepositoryError(
            'supersede',
            'NOT_FOUND',
            `Contact '${existing.contactId}' not found.`,
          );
        }

        if (options?.replacement) {
          const rep = options.replacement;
          if (!isContactIdentityKind(rep.kind)) {
            throw new ContactIdentityRepositoryError(
              'supersede',
              'VALIDATION_ERROR',
              'Invalid replacement identity kind.',
            );
          }
          if (!isContactIdentitySource(rep.source)) {
            throw new ContactIdentityRepositoryError(
              'supersede',
              'VALIDATION_ERROR',
              'Invalid replacement identity source.',
            );
          }
          let repVal: string;
          try {
            repVal = validateIdentityValue(rep.value);
          } catch (e) {
            throw new ContactIdentityRepositoryError(
              'supersede',
              'VALIDATION_ERROR',
              e instanceof Error ? e.message : 'Invalid replacement identity value.',
              e,
            );
          }

          if (existing.isPreferred) {
            const allowedKinds = ALLOWED_PREFERRED_IDENTITY_KINDS[contact.type] ?? [];
            if (!allowedKinds.includes(rep.kind)) {
              throw new ContactIdentityRepositoryError(
                'supersede',
                'UNSUPPORTED_TARGET_TYPE',
                `Replacement identity kind '${rep.kind}' is not allowed as preferred for contact type '${contact.type}'.`,
              );
            }
          }

          tx.insert(contactIdentities)
            .values({
              id: randomUUID(),
              accountId: existing.accountId,
              contactId: existing.contactId,
              kind: rep.kind,
              value: repVal,
              normalizedValue: repVal.trim(),
              source: rep.source,
              state: 'ACTIVE',
              isPreferred: existing.isPreferred,
              firstObservedAt: timestamp,
              lastObservedAt: timestamp,
              createdAt: timestamp,
              updatedAt: timestamp,
            })
            .run();
        }

        return tx
          .update(contactIdentities)
          .set({
            state: 'SUPERSEDED',
            isPreferred: false,
            supersededAt: timestamp,
            updatedAt: timestamp,
          })
          .where(eq(contactIdentities.id, id))
          .returning()
          .get();
      });
    } catch (error) {
      if (error instanceof ContactIdentityRepositoryError) throw error;
      throw new ContactIdentityRepositoryError(
        'supersede',
        'INTEGRITY_ERROR',
        'Failed to supersede contact identity.',
        error,
      );
    }
  }

  touchObserved(id: string, now?: Date): ContactIdentity | undefined {
    const timestamp = now ?? new Date();
    try {
      return this.client.orm
        .update(contactIdentities)
        .set({
          lastObservedAt: timestamp,
          updatedAt: timestamp,
        })
        .where(eq(contactIdentities.id, id))
        .returning()
        .get();
    } catch (error) {
      throw new ContactIdentityRepositoryError(
        'touchObserved',
        'INTEGRITY_ERROR',
        'Failed to touch observed contact identity.',
        error,
      );
    }
  }
}
