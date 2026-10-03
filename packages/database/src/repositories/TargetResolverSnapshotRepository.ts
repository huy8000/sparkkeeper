import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  freezeResolverRequest,
  normalizeResolverIdentifier,
  supportedResolverKind,
  targetResolutionFailure,
  type ResolverAccountBinding,
  type ResolverRequest,
  type TargetResolutionFailure,
} from '@sparkkeeper/shared';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import { accounts, contacts, contactIdentities } from '../schema/index.js';

export type TargetResolverSnapshot =
  | {
      readonly status: 'READY';
      readonly request: ResolverRequest;
      readonly accountBinding: ResolverAccountBinding;
    }
  | TargetResolutionFailure;
export interface TargetResolverSnapshotSource {
  load(accountId: string, contactId: string): TargetResolverSnapshot;
}

/** Short coherent read transaction. No identity choice, mutation, or browser access. */
export class TargetResolverSnapshotRepository implements TargetResolverSnapshotSource {
  constructor(private readonly client: DatabaseClient) {}
  load(accountId: string, contactId: string): TargetResolverSnapshot {
    try {
      // Reads must not inherit the connection's five-second contention wait mid-resolution.
      return this.client.withBusyTimeout(0, () =>
        this.client.orm.transaction((tx) => {
          const account = tx.select().from(accounts).where(eq(accounts.id, accountId)).get();
          const contact = tx.select().from(contacts).where(eq(contacts.id, contactId)).get();
          if (!account || !contact || contact.accountId !== accountId)
            return targetResolutionFailure('TARGET_NOT_ELIGIBLE');
          const preferred = tx
            .select()
            .from(contactIdentities)
            .where(
              and(
                eq(contactIdentities.contactId, contactId),
                eq(contactIdentities.state, 'ACTIVE'),
                eq(contactIdentities.isPreferred, true),
              ),
            )
            .limit(2)
            .all();
          if (preferred.length > 1 || preferred.some((i) => i.accountId !== accountId))
            return targetResolutionFailure('PERSISTENCE_FAILURE');
          if (
            account.profileState !== 'READY' ||
            account.lifecycleStatus !== 'ACTIVE' ||
            !account.enabled
          )
            return targetResolutionFailure('ACCOUNT_NOT_READY');
          if (account.loginStatus === 'AUTH_EXPIRED')
            return targetResolutionFailure('AUTH_EXPIRED');
          if (account.loginStatus !== 'READY') return targetResolutionFailure('ACCOUNT_NOT_READY');
          if (contact.type !== 'PERSON' && contact.type !== 'GROUP')
            return targetResolutionFailure('UNSUPPORTED_TARGET_TYPE');
          if (contact.identityStatus === 'CHANGED')
            return targetResolutionFailure('IDENTITY_CHANGED');
          if (contact.identityStatus === 'AMBIGUOUS')
            return targetResolutionFailure('TARGET_AMBIGUOUS');
          if (contact.availabilityStatus !== 'AVAILABLE')
            return targetResolutionFailure('CONTACT_UNAVAILABLE');
          if (contact.identityStatus !== 'READY')
            return targetResolutionFailure('TARGET_NOT_ELIGIBLE');
          const identity = preferred[0];
          if (!identity || !supportedResolverKind(contact.type, identity.kind))
            return targetResolutionFailure('TARGET_IDENTITY_UNAVAILABLE');
          const value = normalizeResolverIdentifier(identity.normalizedValue);
          if (
            !value ||
            value !== identity.normalizedValue ||
            normalizeResolverIdentifier(identity.value) !== value ||
            !Number.isFinite(identity.lastObservedAt.getTime()) ||
            identity.lastObservedAt.getTime() < 0
          )
            return targetResolutionFailure('TARGET_IDENTITY_UNAVAILABLE');
          const kind = account.douyinSecUid !== null ? 'SEC_UID' : 'UNIQUE_ID';
          const self = normalizeResolverIdentifier(
            kind === 'SEC_UID' ? account.douyinSecUid : account.douyinUniqueId,
          );
          if (!self) return targetResolutionFailure('ACCOUNT_NOT_READY');
          // Private fingerprint, never an API token or logged digest. Contents guard same-ms changes.
          const version = createHash('sha256')
            .update(
              JSON.stringify([
                account.id,
                account.enabled,
                account.lifecycleStatus,
                account.profileState,
                account.loginStatus,
                account.douyinSecUid,
                account.douyinUniqueId,
                account.updatedAt.getTime(),
                contact.id,
                contact.accountId,
                contact.type,
                contact.displayName,
                contact.remarkName,
                contact.availabilityStatus,
                contact.identityStatus,
                contact.updatedAt.getTime(),
                identity.id,
                identity.accountId,
                identity.contactId,
                identity.kind,
                identity.normalizedValue,
                identity.state,
                identity.isPreferred,
                identity.updatedAt.getTime(),
                identity.lastObservedAt.getTime(),
              ]),
            )
            .digest('hex');
          return Object.freeze({
            status: 'READY' as const,
            request: freezeResolverRequest({
              accountId,
              contactId,
              contactType: contact.type,
              preferredIdentity: {
                id: identity.id,
                kind: identity.kind,
                normalizedValue: value,
                observedAt: identity.lastObservedAt.getTime(),
              },
              expectedMetadataVersion: version,
            }),
            accountBinding: Object.freeze({ accountId, kind, normalizedValue: self }),
          });
        }),
      );
    } catch {
      return targetResolutionFailure('PERSISTENCE_FAILURE');
    }
  }
}
