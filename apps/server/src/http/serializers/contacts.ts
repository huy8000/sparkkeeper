import type { Contact, ContactIdentity, ContactSyncRun } from '@sparkkeeper/database';
export function serializeContactSync(run: ContactSyncRun) {
  return {
    id: run.id,
    accountId: run.accountId,
    status: run.status,
    isComplete: run.isComplete,
    candidateCount: run.candidateCount,
    createdCount: run.createdCount,
    updatedCount: run.updatedCount,
    staleCount: run.staleCount,
    unavailableCount: run.unavailableCount,
    issueCount: run.issueCount,
    failureCode: run.failureCode,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
export function serializeContact(contact: Contact, now: Date) {
  const fresh =
    contact.availabilityStatus === 'AVAILABLE' &&
    contact.streakUpdatedAt !== null &&
    now.getTime() - contact.streakUpdatedAt.getTime() <= 86400000;
  return {
    id: contact.id,
    accountId: contact.accountId,
    type: contact.type,
    displayName: contact.displayName,
    remarkName: contact.remarkName,
    avatarAssetId: contact.avatarAssetId,
    streakDays: fresh ? contact.streakDays : null,
    streakUpdatedAt: fresh ? (contact.streakUpdatedAt?.toISOString() ?? null) : null,
    availabilityStatus: contact.availabilityStatus,
    identityStatus: contact.identityStatus,
    discoveredAt: contact.discoveredAt.toISOString(),
    lastSeenAt: contact.lastSeenAt.toISOString(),
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}
export function serializeMaskedIdentity(identity: ContactIdentity) {
  const v = [...identity.value];
  return {
    id: identity.id,
    kind: identity.kind,
    state: identity.state,
    isPreferred: identity.isPreferred,
    maskedValue: v.length <= 4 ? '••••' : `${v.slice(0, 2).join('')}••••${v.slice(-2).join('')}`,
    firstObservedAt: identity.firstObservedAt.toISOString(),
    lastObservedAt: identity.lastObservedAt.toISOString(),
  };
}
