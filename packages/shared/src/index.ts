/** Login-state metadata shared by automation and persistence boundaries. */
export type LoginStatus = 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN';

/** Identity metadata that can be shared without database or browser dependencies. */
export interface FriendIdentity {
  readonly displayName: string;
  readonly remarkName?: string | null;
  readonly shortId?: string | null;
  readonly uniqueId?: string | null;
  readonly secUid?: string | null;
}

/** The single normalized identity field currently used to bind a Friend. */
export type FriendMatchField = 'displayName' | 'remarkName' | 'shortId' | 'uniqueId' | 'secUid';
