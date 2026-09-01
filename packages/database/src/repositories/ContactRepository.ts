import { randomUUID } from 'node:crypto';

import {
  isContactAvailabilityStatus,
  isContactIdentitySource,
  isContactIdentityStatus,
  isContactType,
  normalizeOptionalIdentifier,
  validateContactDisplayName,
  validateIdentityValue,
  validateOptionalContactString,
  validateStreakDays,
  type ContactAvailabilityStatus,
  type ContactIdentityKind,
  type ContactIdentitySource,
  type ContactIdentityStatus,
  type ContactType,
} from '@sparkkeeper/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  contactIdentities,
  contacts,
  sendTaskTargets,
  type ContactIdentityRow,
  type ContactRow,
  type NewContactIdentityRow,
  type NewContactRow,
} from '../schema/index.js';

export type Contact = ContactRow;
export type ContactIdentity = ContactIdentityRow;

export const ALLOWED_PREFERRED_IDENTITY_KINDS: Readonly<
  Record<ContactType, readonly ContactIdentityKind[]>
> = {
  PERSON: ['SEC_UID', 'UNIQUE_ID', 'SHORT_ID'],
  GROUP: ['CONVERSATION_ID'],
  SYSTEM: [],
  UNKNOWN: [],
};

export interface CreateContactInput {
  readonly accountId: string;
  readonly type: ContactType;
  readonly displayName: string;
  readonly remarkName?: string | null;
  readonly avatarRemoteUrl?: string | null;
  readonly avatarAssetId?: string | null;
  readonly streakDays?: number | null;
  readonly streakUpdatedAt?: Date | null;
  readonly availabilityStatus?: ContactAvailabilityStatus;
  readonly identityStatus?: ContactIdentityStatus;
  readonly discoveredAt?: Date;
  readonly lastSeenAt?: Date;
  readonly lastFullSyncId?: string | null;
  readonly missedFullSyncCount?: number;
  readonly now?: Date;
}

export interface InitialPreferredIdentityInput {
  readonly kind: ContactIdentityKind;
  readonly value: string;
  readonly source: ContactIdentitySource;
  readonly firstObservedAt?: Date;
  readonly lastObservedAt?: Date;
}

export interface CreateContactWithPreferredIdentityInput extends CreateContactInput {
  readonly initialIdentity: InitialPreferredIdentityInput;
}

export interface UpdateContactInput {
  readonly type?: ContactType;
  readonly displayName?: string;
  readonly remarkName?: string | null;
  readonly avatarRemoteUrl?: string | null;
  readonly avatarAssetId?: string | null;
  readonly streakDays?: number | null;
  readonly streakUpdatedAt?: Date | null;
  readonly availabilityStatus?: ContactAvailabilityStatus;
  readonly identityStatus?: ContactIdentityStatus;
  readonly lastSeenAt?: Date;
  readonly lastFullSyncId?: string | null;
  readonly missedFullSyncCount?: number;
  readonly now?: Date;
}

export class ContactRepositoryError extends RepositoryError {
  readonly contactOperation:
    | 'create'
    | 'createWithPreferredIdentity'
    | 'findById'
    | 'listByAccountId'
    | 'update'
    | 'incrementMissedFullSync'
    | 'resetMissedFullSync';

  constructor(
    operation: ContactRepositoryError['contactOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'Contact', operation, cause });
    this.name = 'ContactRepositoryError';
    this.contactOperation = operation;
  }
}

export class ContactRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateContactInput): Contact {
    const accountId = input.accountId.trim();
    if (accountId.length === 0) {
      throw new ContactRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    if (input.type === 'PERSON' || input.type === 'GROUP') {
      throw new ContactRepositoryError(
        'create',
        'VALIDATION_ERROR',
        `Contact type '${input.type}' requires an initial preferred identity. Use 'createWithPreferredIdentity()' instead.`,
      );
    }

    let displayName: string;
    let remarkName: string | null;
    let avatarRemoteUrl: string | null;
    let avatarAssetId: string | null;
    let streakDays: number | null;

    try {
      displayName = validateContactDisplayName(input.displayName);
      remarkName = validateOptionalContactString(input.remarkName, 'remarkName');
      avatarRemoteUrl = validateOptionalContactString(input.avatarRemoteUrl, 'avatarRemoteUrl');
      avatarAssetId = normalizeOptionalIdentifier(input.avatarAssetId);
      streakDays = validateStreakDays(input.streakDays);
    } catch (error) {
      throw new ContactRepositoryError(
        'create',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid contact fields.',
        error,
      );
    }

    const availabilityStatus: ContactAvailabilityStatus = input.availabilityStatus ?? 'AVAILABLE';
    if (!isContactAvailabilityStatus(availabilityStatus)) {
      throw new ContactRepositoryError('create', 'VALIDATION_ERROR', 'Invalid availabilityStatus.');
    }

    const identityStatus: ContactIdentityStatus = input.identityStatus ?? 'UNAVAILABLE';
    if (!isContactIdentityStatus(identityStatus)) {
      throw new ContactRepositoryError('create', 'VALIDATION_ERROR', 'Invalid identityStatus.');
    }

    const now = input.now ?? new Date();
    const discoveredAt = input.discoveredAt ?? now;
    const lastSeenAt = input.lastSeenAt ?? now;

    if (lastSeenAt < discoveredAt) {
      throw new ContactRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'lastSeenAt must be >= discoveredAt.',
      );
    }

    const streakUpdatedAt = input.streakUpdatedAt ?? (streakDays !== null ? now : null);
    if (streakDays !== null && streakUpdatedAt === null) {
      throw new ContactRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'streakUpdatedAt required when streakDays is set.',
      );
    }
    if (streakDays === null && streakUpdatedAt !== null) {
      throw new ContactRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'streakUpdatedAt must be null when streakDays is null.',
      );
    }

    const missedFullSyncCount = input.missedFullSyncCount ?? 0;
    if (!Number.isInteger(missedFullSyncCount) || missedFullSyncCount < 0) {
      throw new ContactRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'missedFullSyncCount must be a non-negative integer.',
      );
    }

    const values: NewContactRow = {
      id: randomUUID(),
      accountId,
      type: input.type,
      displayName,
      remarkName,
      avatarRemoteUrl,
      avatarAssetId,
      streakDays,
      streakUpdatedAt,
      availabilityStatus,
      identityStatus,
      discoveredAt,
      lastSeenAt,
      lastFullSyncId: normalizeOptionalIdentifier(input.lastFullSyncId),
      missedFullSyncCount,
      createdAt: now,
      updatedAt: now,
    };

    try {
      return this.client.orm.insert(contacts).values(values).returning().get();
    } catch (error) {
      throw new ContactRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create contact.',
        error,
      );
    }
  }

  /**
   * Atomic Contact + Initial Preferred Identity Aggregate Creation
   */
  createWithPreferredIdentity(input: CreateContactWithPreferredIdentityInput): {
    contact: Contact;
    identity: ContactIdentity;
  } {
    const contactType = input.type;
    const allowedKinds = ALLOWED_PREFERRED_IDENTITY_KINDS[contactType] ?? [];
    if (!allowedKinds.includes(input.initialIdentity.kind)) {
      throw new ContactRepositoryError(
        'createWithPreferredIdentity',
        'UNSUPPORTED_TARGET_TYPE',
        `Identity kind '${input.initialIdentity.kind}' is not allowed as preferred identity for contact type '${contactType}'. Allowed: ${allowedKinds.join(', ')}`,
      );
    }

    let identityVal: string;
    try {
      identityVal = validateIdentityValue(input.initialIdentity.value);
    } catch (error) {
      throw new ContactRepositoryError(
        'createWithPreferredIdentity',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid identity value.',
        error,
      );
    }

    if (!isContactIdentitySource(input.initialIdentity.source)) {
      throw new ContactRepositoryError(
        'createWithPreferredIdentity',
        'VALIDATION_ERROR',
        'Invalid identity source.',
      );
    }

    const now = input.now ?? new Date();

    try {
      return this.client.orm.transaction((tx) => {
        // 1. Create Contact
        const contactId = randomUUID();
        const accountId = input.accountId.trim();

        const contactValues: NewContactRow = {
          id: contactId,
          accountId,
          type: input.type,
          displayName: validateContactDisplayName(input.displayName),
          remarkName: validateOptionalContactString(input.remarkName, 'remarkName'),
          avatarRemoteUrl: validateOptionalContactString(input.avatarRemoteUrl, 'avatarRemoteUrl'),
          avatarAssetId: normalizeOptionalIdentifier(input.avatarAssetId),
          streakDays: validateStreakDays(input.streakDays),
          streakUpdatedAt: input.streakUpdatedAt ?? (input.streakDays ? now : null),
          availabilityStatus: input.availabilityStatus ?? 'AVAILABLE',
          identityStatus: 'READY',
          discoveredAt: input.discoveredAt ?? now,
          lastSeenAt: input.lastSeenAt ?? now,
          lastFullSyncId: normalizeOptionalIdentifier(input.lastFullSyncId),
          missedFullSyncCount: input.missedFullSyncCount ?? 0,
          createdAt: now,
          updatedAt: now,
        };

        const contact = tx.insert(contacts).values(contactValues).returning().get();

        // 2. Create Initial Preferred Identity
        const identityValues: NewContactIdentityRow = {
          id: randomUUID(),
          accountId,
          contactId,
          kind: input.initialIdentity.kind,
          value: identityVal,
          normalizedValue: identityVal.trim(),
          source: input.initialIdentity.source,
          state: 'ACTIVE',
          isPreferred: true,
          firstObservedAt: input.initialIdentity.firstObservedAt ?? now,
          lastObservedAt: input.initialIdentity.lastObservedAt ?? now,
          supersededAt: null,
          createdAt: now,
          updatedAt: now,
        };

        const identity = tx.insert(contactIdentities).values(identityValues).returning().get();

        return { contact, identity };
      });
    } catch (error) {
      if (error instanceof ContactRepositoryError) throw error;
      throw new ContactRepositoryError(
        'createWithPreferredIdentity',
        'INTEGRITY_ERROR',
        'Failed to create contact with initial preferred identity.',
        error,
      );
    }
  }

  findById(id: string): Contact | undefined {
    try {
      return this.client.orm.select().from(contacts).where(eq(contacts.id, id)).get();
    } catch (error) {
      throw new ContactRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find contact by id.',
        error,
      );
    }
  }

  listByAccountId(
    accountId: string,
    options?: {
      type?: ContactType;
      availabilityStatus?: ContactAvailabilityStatus;
      limit?: number;
      offset?: number;
    },
  ): Contact[] {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new ContactRepositoryError(
        'listByAccountId',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      const conditions = [eq(contacts.accountId, trimmed)];
      if (options?.type !== undefined) {
        conditions.push(eq(contacts.type, options.type));
      }
      if (options?.availabilityStatus !== undefined) {
        conditions.push(eq(contacts.availabilityStatus, options.availabilityStatus));
      }

      return this.client.orm
        .select()
        .from(contacts)
        .where(and(...conditions))
        .orderBy(asc(contacts.createdAt), asc(contacts.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new ContactRepositoryError(
        'listByAccountId',
        'INTEGRITY_ERROR',
        'Failed to list contacts.',
        error,
      );
    }
  }

  update(id: string, input: UpdateContactInput): Contact | undefined {
    try {
      return this.client.orm.transaction((tx) => {
        const existing = tx.select().from(contacts).where(eq(contacts.id, id)).get();
        if (!existing) {
          return undefined;
        }

        const now = input.now ?? new Date();
        const values: Partial<NewContactRow> = { updatedAt: now };
        let mutationCount = 0;

        if (input.type !== undefined) {
          if (!isContactType(input.type)) {
            throw new ContactRepositoryError('update', 'VALIDATION_ERROR', 'Invalid contact type.');
          }
          values.type = input.type;
          mutationCount += 1;

          // 1. Post-Admission Target Safety: Cannot change type to SYSTEM or UNKNOWN if targeted
          if (input.type === 'SYSTEM' || input.type === 'UNKNOWN') {
            const targeted = tx
              .select({ taskId: sendTaskTargets.taskId })
              .from(sendTaskTargets)
              .where(eq(sendTaskTargets.contactId, id))
              .limit(1)
              .get();

            if (targeted) {
              throw new ContactRepositoryError(
                'update',
                'UNSUPPORTED_TARGET_TYPE',
                `Cannot change contact '${id}' type to '${input.type}' because it is assigned as a target in send task '${targeted.taskId}'.`,
              );
            }
          }

          // 2. Preferred Identity Compatibility: If contact has active preferred identity, it must be compatible
          const preferredIdent = tx
            .select()
            .from(contactIdentities)
            .where(
              and(
                eq(contactIdentities.contactId, id),
                eq(contactIdentities.state, 'ACTIVE'),
                eq(contactIdentities.isPreferred, true),
              ),
            )
            .get();

          if (preferredIdent) {
            const allowedKinds = ALLOWED_PREFERRED_IDENTITY_KINDS[input.type] ?? [];
            if (!allowedKinds.includes(preferredIdent.kind)) {
              throw new ContactRepositoryError(
                'update',
                'UNSUPPORTED_TARGET_TYPE',
                `Cannot change contact '${id}' type to '${input.type}' because existing preferred identity '${preferredIdent.id}' of kind '${preferredIdent.kind}' is incompatible.`,
              );
            }
          } else if (input.type === 'PERSON' || input.type === 'GROUP') {
            throw new ContactRepositoryError(
              'update',
              'VALIDATION_ERROR',
              `Cannot change contact '${id}' type to '${input.type}' without an active preferred identity.`,
            );
          }
        }

        if (input.displayName !== undefined) {
          values.displayName = validateContactDisplayName(input.displayName);
          mutationCount += 1;
        }
        if (input.remarkName !== undefined) {
          values.remarkName = validateOptionalContactString(input.remarkName, 'remarkName');
          mutationCount += 1;
        }
        if (input.avatarRemoteUrl !== undefined) {
          values.avatarRemoteUrl = validateOptionalContactString(
            input.avatarRemoteUrl,
            'avatarRemoteUrl',
          );
          mutationCount += 1;
        }
        if (input.avatarAssetId !== undefined) {
          values.avatarAssetId = normalizeOptionalIdentifier(input.avatarAssetId);
          mutationCount += 1;
        }
        if (input.streakDays !== undefined) {
          values.streakDays = validateStreakDays(input.streakDays);
          mutationCount += 1;
        }
        if (input.streakUpdatedAt !== undefined) {
          values.streakUpdatedAt = input.streakUpdatedAt;
          mutationCount += 1;
        }
        if (input.availabilityStatus !== undefined) {
          if (!isContactAvailabilityStatus(input.availabilityStatus)) {
            throw new ContactRepositoryError(
              'update',
              'VALIDATION_ERROR',
              'Invalid availabilityStatus.',
            );
          }
          values.availabilityStatus = input.availabilityStatus;
          mutationCount += 1;
        }
        if (input.identityStatus !== undefined) {
          if (!isContactIdentityStatus(input.identityStatus)) {
            throw new ContactRepositoryError(
              'update',
              'VALIDATION_ERROR',
              'Invalid identityStatus.',
            );
          }
          values.identityStatus = input.identityStatus;
          mutationCount += 1;
        }
        if (input.lastSeenAt !== undefined) {
          values.lastSeenAt = input.lastSeenAt;
          mutationCount += 1;
        }
        if (input.lastFullSyncId !== undefined) {
          values.lastFullSyncId = normalizeOptionalIdentifier(input.lastFullSyncId);
          mutationCount += 1;
        }
        if (input.missedFullSyncCount !== undefined) {
          if (!Number.isInteger(input.missedFullSyncCount) || input.missedFullSyncCount < 0) {
            throw new ContactRepositoryError(
              'update',
              'VALIDATION_ERROR',
              'missedFullSyncCount must be a non-negative integer.',
            );
          }
          values.missedFullSyncCount = input.missedFullSyncCount;
          mutationCount += 1;
        }

        if (mutationCount === 0) {
          throw new ContactRepositoryError(
            'update',
            'VALIDATION_ERROR',
            'Contact update requires at least one field.',
          );
        }

        const finalStreakDays =
          values.streakDays !== undefined ? values.streakDays : existing.streakDays;
        const finalStreakUpdatedAt =
          values.streakUpdatedAt !== undefined ? values.streakUpdatedAt : existing.streakUpdatedAt;

        if (finalStreakDays !== null && finalStreakUpdatedAt === null) {
          throw new ContactRepositoryError(
            'update',
            'VALIDATION_ERROR',
            'streakUpdatedAt required when streakDays is non-null.',
          );
        }
        if (finalStreakDays === null && finalStreakUpdatedAt !== null) {
          throw new ContactRepositoryError(
            'update',
            'VALIDATION_ERROR',
            'streakUpdatedAt must be null when streakDays is null.',
          );
        }

        return tx.update(contacts).set(values).where(eq(contacts.id, id)).returning().get();
      });
    } catch (error) {
      if (error instanceof ContactRepositoryError) throw error;
      throw new ContactRepositoryError(
        'update',
        'INTEGRITY_ERROR',
        'Failed to update contact.',
        error,
      );
    }
  }

  incrementMissedFullSync(contactIds: string[]): number {
    if (contactIds.length === 0) {
      return 0;
    }
    try {
      const result = this.client.orm
        .update(contacts)
        .set({
          missedFullSyncCount: sql`${contacts.missedFullSyncCount} + 1`,
        })
        .where(inArray(contacts.id, contactIds))
        .returning()
        .all();
      return result.length;
    } catch (error) {
      throw new ContactRepositoryError(
        'incrementMissedFullSync',
        'INTEGRITY_ERROR',
        'Failed to increment missedFullSyncCount.',
        error,
      );
    }
  }

  resetMissedFullSync(contactIds: string[], lastFullSyncId: string, now?: Date): number {
    if (contactIds.length === 0) {
      return 0;
    }
    const syncId = lastFullSyncId.trim();
    if (syncId.length === 0) {
      throw new ContactRepositoryError(
        'resetMissedFullSync',
        'VALIDATION_ERROR',
        'lastFullSyncId must not be empty.',
      );
    }
    const timestamp = now ?? new Date();

    try {
      const result = this.client.orm
        .update(contacts)
        .set({
          missedFullSyncCount: 0,
          lastFullSyncId: syncId,
          lastSeenAt: timestamp,
          updatedAt: timestamp,
        })
        .where(inArray(contacts.id, contactIds))
        .returning()
        .all();
      return result.length;
    } catch (error) {
      throw new ContactRepositoryError(
        'resetMissedFullSync',
        'INTEGRITY_ERROR',
        'Failed to reset missedFullSyncCount.',
        error,
      );
    }
  }
}
