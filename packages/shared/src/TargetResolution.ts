import type { ContactIdentityKind, ContactType } from './Contact.js';

export const TARGET_RESOLUTION_REASONS = Object.freeze({
  TARGET_AMBIGUOUS: 'AMBIGUOUS',
  TARGET_NOT_FOUND: 'NOT_FOUND',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  IDENTITY_CHANGED: 'IDENTITY_CHANGED',
  METADATA_VERSION_CHANGED: 'IDENTITY_CHANGED',
  TARGET_IDENTITY_UNAVAILABLE: 'UNAVAILABLE',
  CONTACT_UNAVAILABLE: 'UNAVAILABLE',
  ACCOUNT_NOT_READY: 'UNAVAILABLE',
  TARGET_NOT_ELIGIBLE: 'UNAVAILABLE',
  UNSUPPORTED_TARGET_TYPE: 'UNAVAILABLE',
  AUTH_UNKNOWN: 'UNVERIFIABLE',
  ACCOUNT_IDENTITY_MISMATCH: 'UNVERIFIABLE',
  SELECTOR_CONTRACT_UNAVAILABLE: 'UNVERIFIABLE',
  DIRECTORY_INCOMPLETE: 'UNVERIFIABLE',
  DIRECTORY_CHANGED: 'UNVERIFIABLE',
  CANDIDATE_ANCHOR_UNAVAILABLE: 'UNVERIFIABLE',
  TARGET_DISAPPEARED: 'UNVERIFIABLE',
  RESOLUTION_LIMIT_REACHED: 'UNVERIFIABLE',
  PAGE_CLOSED: 'FAILED',
  BROWSER_FAILURE: 'FAILED',
  PERSISTENCE_FAILURE: 'FAILED',
  RUNTIME_OWNERSHIP_LOST: 'FAILED',
  RESOLUTION_TIMEOUT: 'FAILED',
} as const);
export type TargetResolutionReason = keyof typeof TARGET_RESOLUTION_REASONS;
export type TargetResolutionStatus =
  'VERIFIED' | (typeof TARGET_RESOLUTION_REASONS)[TargetResolutionReason];
export interface TargetResolutionFailure {
  readonly status: Exclude<TargetResolutionStatus, 'VERIFIED'>;
  readonly reason: TargetResolutionReason;
}
export function targetResolutionFailure(reason: TargetResolutionReason): TargetResolutionFailure {
  return Object.freeze({ status: TARGET_RESOLUTION_REASONS[reason], reason });
}
export type ResolverIdentityKind = 'SEC_UID' | 'UNIQUE_ID' | 'SHORT_ID' | 'CONVERSATION_ID';
/** Private domain input: never an HTTP DTO or log payload. */
export interface ResolverRequest {
  readonly accountId: string;
  readonly contactId: string;
  readonly contactType: ContactType;
  readonly preferredIdentity: {
    readonly id: string;
    readonly kind: ContactIdentityKind;
    readonly normalizedValue: string;
    readonly observedAt: number;
  };
  readonly expectedMetadataVersion: string;
}
export interface ResolverAccountBinding {
  readonly accountId: string;
  readonly kind: 'SEC_UID' | 'UNIQUE_ID';
  readonly normalizedValue: string;
}
export function normalizeResolverIdentifier(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 256 || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
export function supportedResolverKind(
  type: ContactType,
  kind: ContactIdentityKind,
): kind is ResolverIdentityKind {
  return type === 'PERSON'
    ? kind === 'SEC_UID' || kind === 'UNIQUE_ID' || kind === 'SHORT_ID'
    : type === 'GROUP' && kind === 'CONVERSATION_ID';
}
export function freezeResolverRequest(request: ResolverRequest): ResolverRequest {
  return Object.freeze({
    ...request,
    preferredIdentity: Object.freeze({ ...request.preferredIdentity }),
  });
}
export function sameResolverRequest(a: ResolverRequest, b: ResolverRequest): boolean {
  return (
    a.accountId === b.accountId &&
    a.contactId === b.contactId &&
    a.contactType === b.contactType &&
    a.expectedMetadataVersion === b.expectedMetadataVersion &&
    a.preferredIdentity.id === b.preferredIdentity.id &&
    a.preferredIdentity.kind === b.preferredIdentity.kind &&
    a.preferredIdentity.normalizedValue === b.preferredIdentity.normalizedValue &&
    a.preferredIdentity.observedAt === b.preferredIdentity.observedAt
  );
}
