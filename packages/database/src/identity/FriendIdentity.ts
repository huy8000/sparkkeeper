import type { FriendIdentity, FriendMatchField } from '@sparkkeeper/shared';

export interface NormalizedFriendIdentity {
  readonly displayName: string;
  readonly remarkName: string | null;
  readonly shortId: string | null;
  readonly uniqueId: string | null;
  readonly secUid: string | null;
}

export interface FriendMatch {
  readonly field: FriendMatchField;
  readonly key: string;
}

export const FRIEND_MATCH_PRIORITY = [
  'secUid',
  'uniqueId',
  'shortId',
  'remarkName',
  'displayName',
] as const satisfies readonly FriendMatchField[];

export const FRIEND_MATCH_FIELDS = [
  'displayName',
  'remarkName',
  'shortId',
  'uniqueId',
  'secUid',
] as const satisfies readonly FriendMatchField[];

export class FriendIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FriendIdentityError';
  }
}

export function normalizeFriendIdentity(identity: FriendIdentity): NormalizedFriendIdentity {
  const displayName = identity.displayName.trim();
  if (displayName.length === 0) {
    throw new FriendIdentityError('Friend displayName must not be empty.');
  }

  return {
    displayName,
    remarkName: normalizeOptionalIdentityValue(identity.remarkName),
    shortId: normalizeOptionalIdentityValue(identity.shortId),
    uniqueId: normalizeOptionalIdentityValue(identity.uniqueId),
    secUid: normalizeOptionalIdentityValue(identity.secUid),
  };
}

export function selectFriendMatch(
  identity: NormalizedFriendIdentity,
  requestedField?: FriendMatchField,
): FriendMatch {
  if (requestedField !== undefined) {
    if (!isFriendMatchField(requestedField)) {
      throw new FriendIdentityError('Friend match field is not supported.');
    }
    return matchFromField(identity, requestedField);
  }

  for (const field of FRIEND_MATCH_PRIORITY) {
    const key = identity[field];
    if (key !== null) {
      return { field, key };
    }
  }

  throw new FriendIdentityError('Friend identity has no usable match field.');
}

function isFriendMatchField(value: string): value is FriendMatchField {
  return (FRIEND_MATCH_FIELDS as readonly string[]).includes(value);
}

function normalizeOptionalIdentityValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function matchFromField(identity: NormalizedFriendIdentity, field: FriendMatchField): FriendMatch {
  const key = identity[field];
  if (key === null) {
    throw new FriendIdentityError(`Friend match field "${field}" has no identity value.`);
  }
  return { field, key };
}
