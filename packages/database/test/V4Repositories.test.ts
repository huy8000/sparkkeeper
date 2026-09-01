import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountLoginSessionRepository,
  AccountRepository,
  AdminSessionRepository,
  AdminUserRepository,
  AuditEventRepository,
  AvatarAssetRepository,
  ContactIdentityRepository,
  ContactRepository,
  ContactSyncRunRepository,
  DeliveryResolutionRepository,
  ExecutionRunRepository,
  MessageTemplateRepository,
  RepositoryError,
  SendTaskRepository,
  TargetSendRecordRepository,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

test('V4Repositories: AdminUserRepository operations', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repo = new AdminUserRepository(client);

  assert.equal(repo.count(), 0);

  const admin = repo.create({
    username: 'SystemAdmin',
    passwordHash: 'argon2-hash-xyz',
    status: 'ACTIVE',
  });

  assert.equal(repo.count(), 1);
  assert.equal(admin.username, 'SystemAdmin');
  assert.equal(admin.usernameNormalized, 'systemadmin');
  assert.equal(admin.sessionVersion, 1);
  assert.equal(admin.failedLoginCount, 0);

  const byUser = repo.findByUsername('SYSTEMADMIN');
  assert.equal(byUser?.id, admin.id);

  const active = repo.findActiveAdmin();
  assert.equal(active?.id, admin.id);

  const updated = repo.update(admin.id, {
    incrementFailedLoginCount: true,
    sessionVersionIncrement: true,
    lastLoginAt: new Date(),
  });

  assert.equal(updated?.failedLoginCount, 1);
  assert.equal(updated?.sessionVersion, 2);
  assert.ok(updated?.lastLoginAt);
});

test('V4Repositories: AdminSessionRepository lifecycle and purge', (context) => {
  const { client } = createTemporaryDatabase(context);
  const admin = new AdminUserRepository(client).create({
    username: 'admin',
    passwordHash: 'hash',
  });
  const sessionRepo = new AdminSessionRepository(client);

  const now = new Date('2026-08-31T10:00:00.000Z');
  const idle = new Date('2026-08-31T10:30:00.000Z');
  const absolute = new Date('2026-08-31T18:00:00.000Z');

  const session1 = sessionRepo.create({
    adminUserId: admin.id,
    tokenDigest: 'tok-digest-1',
    csrfTokenDigest: 'csrf-digest-1',
    sessionVersion: 1,
    idleExpiresAt: idle,
    absoluteExpiresAt: absolute,
    now,
  });

  const session2 = sessionRepo.create({
    adminUserId: admin.id,
    tokenDigest: 'tok-digest-2',
    csrfTokenDigest: 'csrf-digest-2',
    sessionVersion: 1,
    idleExpiresAt: idle,
    absoluteExpiresAt: absolute,
    now,
  });

  assert.equal(sessionRepo.findByTokenDigest('tok-digest-1')?.id, session1.id);
  assert.equal(sessionRepo.findByTokenDigest('tok-digest-2')?.id, session2.id);

  const touched = sessionRepo.touch(session1.id, {
    lastSeenAt: new Date('2026-08-31T10:15:00.000Z'),
    idleExpiresAt: new Date('2026-08-31T10:45:00.000Z'),
  });
  assert.equal(touched?.idleExpiresAt.toISOString(), '2026-08-31T10:45:00.000Z');

  const reauthed = sessionRepo.reauthenticate(session1.id, {
    reauthenticatedAt: new Date('2026-08-31T10:20:00.000Z'),
    lastSeenAt: new Date('2026-08-31T10:20:00.000Z'),
    idleExpiresAt: new Date('2026-08-31T10:50:00.000Z'),
  });
  assert.equal(reauthed?.reauthenticatedAt?.toISOString(), '2026-08-31T10:20:00.000Z');

  const revoked = sessionRepo.revoke(session1.id, {
    revokedAt: new Date('2026-08-31T10:25:00.000Z'),
    reason: 'Manual logout',
  });
  assert.equal(revoked?.revokeReason, 'Manual logout');

  const revokedCount = sessionRepo.revokeAllForUser(admin.id, {
    revokedAt: new Date('2026-08-31T10:26:00.000Z'),
    reason: 'Password change',
  });
  assert.equal(revokedCount, 1);

  const session3 = sessionRepo.create({
    adminUserId: admin.id,
    tokenDigest: 'tok-digest-3',
    csrfTokenDigest: 'csrf-digest-3',
    sessionVersion: 1,
    idleExpiresAt: new Date(now.getTime() + 1800_000),
    absoluteExpiresAt: new Date(now.getTime() + 7200_000),
    now,
  });

  // Active lookup succeeds
  const activeLookup = sessionRepo.findActiveByTokenDigest(
    'tok-digest-3',
    new Date(now.getTime() + 60_000),
  );
  assert.ok(activeLookup);
  assert.equal(activeLookup.session.id, session3.id);
  assert.equal(activeLookup.user.id, admin.id);

  // Updating admin password automatically increments user's sessionVersion
  const adminRepo = new AdminUserRepository(client);
  adminRepo.update(admin.id, { passwordHash: 'new-password-hash' });

  // Previous session is now invalid due to sessionVersion mismatch
  assert.equal(
    sessionRepo.findActiveByTokenDigest('tok-digest-3', new Date(now.getTime() + 60_000)),
    undefined,
  );

  // Purge expired
  const purged = sessionRepo.purgeExpired(new Date('2026-08-31T19:00:00.000Z'));
  assert.equal(purged, 3);
});

test('V4Repositories: AccountLoginSession state machine and compare-and-transition', (context) => {
  const { client } = createTemporaryDatabase(context);
  const admin = new AdminUserRepository(client).create({ username: 'admin', passwordHash: 'hash' });
  const account1 = new AccountRepository(client).create({ name: 'Douyin Account 1' });
  const account2 = new AccountRepository(client).create({ name: 'Douyin Account 2' });
  const loginRepo = new AccountLoginSessionRepository(client);

  const createPendingRelogin = (accId = account1.id) =>
    loginRepo.create({
      purpose: 'RELOGIN',
      accountId: accId,
      createdByAdminUserId: admin.id,
      expiresAt: new Date(Date.now() + 600_000),
    });

  const createPendingAddAccount = (pendingId = 'pending-acc-1') =>
    loginRepo.create({
      purpose: 'ADD_ACCOUNT',
      pendingAccountId: pendingId,
      createdByAdminUserId: admin.id,
      expiresAt: new Date(Date.now() + 600_000),
    });

  // 1. Positive Tests: Happy Path (PENDING -> STARTING -> AWAITING_USER -> READY_DETECTED -> COMPLETING -> COMPLETED)
  const session1 = createPendingRelogin();
  assert.equal(session1.status, 'PENDING');
  assert.equal(session1.startedAt, null);
  assert.equal(session1.readyDetectedAt, null);
  assert.equal(session1.completedAt, null);
  assert.equal(loginRepo.findActive()?.id, session1.id);
  assert.equal(loginRepo.findActiveByAccountId(account1.id)?.id, session1.id);

  const s1 = loginRepo.markStarting(session1.id);
  assert.equal(s1.status, 'STARTING');
  assert.ok(s1.startedAt);
  assert.equal(s1.readyDetectedAt, null);
  assert.equal(s1.completedAt, null);

  const s2 = loginRepo.markAwaitingUser(session1.id);
  assert.equal(s2.status, 'AWAITING_USER');
  assert.ok(s2.startedAt);

  const s3 = loginRepo.markReadyDetected(session1.id);
  assert.equal(s3.status, 'READY_DETECTED');
  assert.ok(s3.readyDetectedAt);
  assert.equal(s3.completedAt, null);

  const s4 = loginRepo.markCompleting(session1.id);
  assert.equal(s4.status, 'COMPLETING');
  assert.ok(s4.readyDetectedAt);

  const s5 = loginRepo.markCompleted(session1.id);
  assert.equal(s5.status, 'COMPLETED');
  assert.ok(s5.completedAt);
  assert.equal(loginRepo.findActive(), undefined);
  assert.equal(loginRepo.findActiveByAccountId(account1.id), undefined);

  // 2. Positive Tests: All alternative legal exits
  // 2.1 PENDING legal exits: CANCELLED, EXPIRED, FAILED
  const pCancel = createPendingRelogin();
  const resPCancel = loginRepo.markCancelled(pCancel.id);
  assert.equal(resPCancel.status, 'CANCELLED');
  assert.ok(resPCancel.cancelledAt);

  const pExpire = createPendingRelogin();
  assert.equal(loginRepo.markExpired(pExpire.id).status, 'EXPIRED');

  const pFail = createPendingRelogin();
  const resPFail = loginRepo.markFailed(pFail.id, 'START_FAILED');
  assert.equal(resPFail.status, 'FAILED');
  assert.equal(resPFail.failureCode, 'START_FAILED');

  // 2.2 STARTING legal exits: CANCELLED, EXPIRED, FAILED
  const stCancel = createPendingRelogin();
  loginRepo.markStarting(stCancel.id);
  const resStCancel = loginRepo.markCancelled(stCancel.id);
  assert.equal(resStCancel.status, 'CANCELLED');
  assert.ok(resStCancel.cancelledAt);

  const stExpire = createPendingRelogin();
  loginRepo.markStarting(stExpire.id);
  assert.equal(loginRepo.markExpired(stExpire.id).status, 'EXPIRED');

  const stFail = createPendingRelogin();
  loginRepo.markStarting(stFail.id);
  const resStFail = loginRepo.markFailed(stFail.id, 'CONSOLE_START_FAILED');
  assert.equal(resStFail.status, 'FAILED');
  assert.equal(resStFail.failureCode, 'CONSOLE_START_FAILED');

  // 2.3 AWAITING_USER legal exits: CANCELLED, EXPIRED, FAILED
  const auCancel = createPendingRelogin();
  loginRepo.markStarting(auCancel.id);
  loginRepo.markAwaitingUser(auCancel.id);
  const resAuCancel = loginRepo.markCancelled(auCancel.id);
  assert.equal(resAuCancel.status, 'CANCELLED');
  assert.ok(resAuCancel.cancelledAt);

  const auExpire = createPendingRelogin();
  loginRepo.markStarting(auExpire.id);
  loginRepo.markAwaitingUser(auExpire.id);
  assert.equal(loginRepo.markExpired(auExpire.id).status, 'EXPIRED');

  const auFail = createPendingRelogin();
  loginRepo.markStarting(auFail.id);
  loginRepo.markAwaitingUser(auFail.id);
  const resAuFail = loginRepo.markFailed(auFail.id, 'READY_TIMEOUT');
  assert.equal(resAuFail.status, 'FAILED');
  assert.equal(resAuFail.failureCode, 'READY_TIMEOUT');

  // 2.4 READY_DETECTED legal exits: COMPLETING, FAILED
  const rdFail = createPendingRelogin();
  loginRepo.markStarting(rdFail.id);
  loginRepo.markAwaitingUser(rdFail.id);
  loginRepo.markReadyDetected(rdFail.id);
  const resRdFail = loginRepo.markFailed(rdFail.id, 'PROFILE_IDENTITY_UNAVAILABLE');
  assert.equal(resRdFail.status, 'FAILED');
  assert.equal(resRdFail.failureCode, 'PROFILE_IDENTITY_UNAVAILABLE');

  // 2.5 COMPLETING legal exits: COMPLETED, FAILED
  const cmpFail = createPendingRelogin();
  loginRepo.markStarting(cmpFail.id);
  loginRepo.markAwaitingUser(cmpFail.id);
  loginRepo.markReadyDetected(cmpFail.id);
  loginRepo.markCompleting(cmpFail.id);
  const resCmpFail = loginRepo.markFailed(cmpFail.id, 'PROFILE_LEASE_CONFLICT');
  assert.equal(resCmpFail.status, 'FAILED');
  assert.equal(resCmpFail.failureCode, 'PROFILE_LEASE_CONFLICT');

  // 3. Negative Tests: Explicitly removed edges
  // 3.1 STARTING -> READY_DETECTED is rejected (cannot skip AWAITING_USER)
  const stSkipRD = createPendingRelogin();
  loginRepo.markStarting(stSkipRD.id);
  assert.throws(
    () => loginRepo.markReadyDetected(stSkipRD.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  loginRepo.markCancelled(stSkipRD.id);

  // 3.2 READY_DETECTED -> CANCELLED / EXPIRED is rejected
  const rdIllegal = createPendingRelogin();
  loginRepo.markStarting(rdIllegal.id);
  loginRepo.markAwaitingUser(rdIllegal.id);
  loginRepo.markReadyDetected(rdIllegal.id);

  assert.throws(
    () => loginRepo.markCancelled(rdIllegal.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markExpired(rdIllegal.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  // 3.3 COMPLETING -> CANCELLED / EXPIRED is rejected
  loginRepo.markCompleting(rdIllegal.id);

  assert.throws(
    () => loginRepo.markCancelled(rdIllegal.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markExpired(rdIllegal.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  loginRepo.markCompleted(rdIllegal.id);

  // 4. Negative Tests: Arbitrary skipping, backward transitions, and invalid failure code
  const negSession = createPendingRelogin();
  // PENDING skips
  assert.throws(
    () => loginRepo.markAwaitingUser(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markReadyDetected(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markCompleting(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markCompleted(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  loginRepo.markStarting(negSession.id);
  // STARTING skips
  assert.throws(
    () => loginRepo.markCompleting(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markCompleted(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  loginRepo.markAwaitingUser(negSession.id);
  // AWAITING_USER backward & skips
  assert.throws(
    () => loginRepo.markStarting(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markCompleting(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markCompleted(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  loginRepo.markReadyDetected(negSession.id);
  // READY_DETECTED backward & skips
  assert.throws(
    () => loginRepo.markStarting(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markAwaitingUser(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markCompleted(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  loginRepo.markCompleting(negSession.id);
  // COMPLETING backward
  assert.throws(
    () => loginRepo.markStarting(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markAwaitingUser(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );
  assert.throws(
    () => loginRepo.markReadyDetected(negSession.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  // Invalid failure code validation
  assert.throws(
    // @ts-expect-error test invalid failure code
    () => loginRepo.markFailed(negSession.id, 'UNKNOWN_INVALID_CODE'),
    (err: unknown) => err instanceof RepositoryError && err.code === 'VALIDATION_ERROR',
  );
  loginRepo.markCompleted(negSession.id);

  // 5. Terminal State Immutability: (COMPLETED, CANCELLED, EXPIRED, FAILED cannot leave)
  for (const terminalSessionId of [pCancel.id, pExpire.id, pFail.id, session1.id]) {
    assert.throws(
      () => loginRepo.markStarting(terminalSessionId),
      (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
    );
    assert.throws(
      () => loginRepo.markAwaitingUser(terminalSessionId),
      (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
    );
    assert.throws(
      () => loginRepo.markReadyDetected(terminalSessionId),
      (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
    );
    assert.throws(
      () => loginRepo.markCompleting(terminalSessionId),
      (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
    );
    assert.throws(
      () => loginRepo.markCompleted(terminalSessionId),
      (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
    );
    assert.throws(
      () => loginRepo.markCancelled(terminalSessionId),
      (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
    );
    assert.throws(
      () => loginRepo.markExpired(terminalSessionId),
      (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
    );
    assert.throws(
      () => loginRepo.markFailed(terminalSessionId, 'PROCESS_EXITED'),
      (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
    );
  }

  // 6. Global Concurrency = 1 Matrix Tests (All Conflict Combinations)
  // A. Same Account + Same Purpose -> CONFLICT
  const activeSessionA = createPendingRelogin(account1.id);
  assert.throws(
    () => createPendingRelogin(account1.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );

  // B. Different Account -> CONFLICT
  assert.throws(
    () => createPendingRelogin(account2.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );

  // C. Different pendingAccountId (ADD_ACCOUNT vs ADD_ACCOUNT) -> CONFLICT
  assert.throws(
    () => createPendingAddAccount('pending-acc-2'),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );

  // D. RELOGIN vs ADD_ACCOUNT -> CONFLICT
  assert.throws(
    () => createPendingAddAccount('pending-acc-3'),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );

  loginRepo.markCancelled(activeSessionA.id);

  // E. ADD_ACCOUNT vs RELOGIN -> CONFLICT
  const activeAddSession = createPendingAddAccount('pending-acc-4');
  assert.throws(
    () => createPendingRelogin(account1.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );
  assert.throws(
    () => createPendingAddAccount('pending-acc-5'),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );

  loginRepo.markCancelled(activeAddSession.id);

  // F. Real concurrent race test: Exactly 1 success, 1 conflict, active count = 1
  let firstResult: AccountLoginSession | Error | undefined;
  let secondResult: AccountLoginSession | Error | undefined;

  try {
    firstResult = createPendingRelogin(account1.id);
  } catch (e) {
    firstResult = e as Error;
  }

  try {
    secondResult = createPendingRelogin(account2.id);
  } catch (e) {
    secondResult = e as Error;
  }

  const successCount = [firstResult, secondResult].filter(
    (r) => !(r instanceof Error) && (r as AccountLoginSession)?.id,
  ).length;
  const conflictCount = [firstResult, secondResult].filter(
    (r) => r instanceof RepositoryError && r.code === 'CONFLICT',
  ).length;

  assert.equal(successCount, 1);
  assert.equal(conflictCount, 1);
  assert.ok(loginRepo.findActive());

  // G. After session becomes terminal, new creation succeeds
  if (!(firstResult instanceof Error) && firstResult?.id) {
    const sSt = loginRepo.markStarting(firstResult.id);
    const sAu = loginRepo.markAwaitingUser(sSt.id);
    const sRd = loginRepo.markReadyDetected(sAu.id);
    const sCm = loginRepo.markCompleting(sRd.id);
    loginRepo.markCompleted(sCm.id);
  } else if (!(secondResult instanceof Error) && secondResult?.id) {
    loginRepo.markCancelled(secondResult.id);
  }

  const afterTerminalSession = createPendingRelogin(account1.id);
  assert.equal(afterTerminalSession.status, 'PENDING');
  loginRepo.markCancelled(afterTerminalSession.id);
});

test('V4Repositories: AvatarAssetRepository operations', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = new AccountRepository(client).create({ name: 'Douyin Account' });
  const avatarRepo = new AvatarAssetRepository(client);

  // Path traversal rejection in cacheKey
  assert.throws(
    () =>
      avatarRepo.create({
        accountId: account.id,
        cacheKey: '../evil/avatar.jpg',
        mediaType: 'image/jpeg',
        byteSize: 1024,
        contentDigest: 'sha256-bad',
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'VALIDATION_ERROR',
  );
  assert.throws(
    () =>
      avatarRepo.create({
        accountId: account.id,
        cacheKey: '/root/avatar.jpg',
        mediaType: 'image/jpeg',
        byteSize: 1024,
        contentDigest: 'sha256-bad',
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'VALIDATION_ERROR',
  );

  const asset = avatarRepo.create({
    accountId: account.id,
    cacheKey: 'avatar-sha256-abcdef',
    mediaType: 'image/jpeg',
    byteSize: 10240,
    contentDigest: 'sha256-abcdef',
    expiresAt: new Date(Date.now() - 1000),
  });

  // Duplicate cacheKey throws CONFLICT
  assert.throws(
    () =>
      avatarRepo.create({
        accountId: account.id,
        cacheKey: 'avatar-sha256-abcdef',
        mediaType: 'image/jpeg',
        byteSize: 10240,
        contentDigest: 'sha256-abcdef',
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );

  assert.equal(avatarRepo.findByCacheKey('avatar-sha256-abcdef')?.id, asset.id);
  const touchedAsset = avatarRepo.touch(asset.id);
  assert.ok(touchedAsset);
  assert.equal(avatarRepo.listByAccountId(account.id).length, 1);

  // findExpiryCandidates
  const candidates = avatarRepo.findExpiryCandidates({
    beforeDate: new Date(Date.now() + 1000),
    limit: 10,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.id, asset.id);

  assert.equal(avatarRepo.deleteById(asset.id), true);
});

test('V4Repositories: Contact, ContactIdentity, and ContactSyncRun operations', (context) => {
  const { client } = createTemporaryDatabase(context);
  const admin = new AdminUserRepository(client).create({ username: 'admin', passwordHash: 'hash' });
  const account1 = new AccountRepository(client).create({ name: 'Account 1' });
  const account2 = new AccountRepository(client).create({ name: 'Account 2' });

  // Sync Run
  const syncRepo = new ContactSyncRunRepository(client);
  const syncRun = syncRepo.create({ accountId: account1.id, requestedByAdminUserId: admin.id });
  assert.equal(syncRun.status, 'PENDING');
  assert.equal(syncRepo.findLatestByAccountId(account1.id)?.id, syncRun.id);

  syncRepo.markRunning(syncRun.id);
  const completedSync = syncRepo.markComplete(syncRun.id, {
    candidateCount: 10,
    createdCount: 8,
    updatedCount: 2,
    finishedAt: new Date(),
  });
  assert.equal(completedSync.status, 'COMPLETE');

  const contactRepo = new ContactRepository(client);
  const identRepo = new ContactIdentityRepository(client);

  // 1. Atomic Contact + Initial Preferred Identity Creation
  const { contact: pContact, identity: pIdent } = contactRepo.createWithPreferredIdentity({
    accountId: account1.id,
    type: 'PERSON',
    displayName: 'Alice',
    lastFullSyncId: syncRun.id,
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'MS4wLjABAAAA_alice',
      source: 'PAGE_DATA',
    },
  });

  assert.equal(pContact.displayName, 'Alice');
  assert.equal(pContact.lastFullSyncId, syncRun.id);
  assert.equal(pIdent.kind, 'SEC_UID');
  assert.equal(pIdent.isPreferred, true);
  assert.equal(pIdent.state, 'ACTIVE');
  assert.equal(pIdent.accountId, account1.id);
  assert.equal(pIdent.contactId, pContact.id);

  // 2. GROUP Contact with CONVERSATION_ID
  const { contact: gContact, identity: gIdent } = contactRepo.createWithPreferredIdentity({
    accountId: account1.id,
    type: 'GROUP',
    displayName: 'Work Group',
    initialIdentity: {
      kind: 'CONVERSATION_ID',
      value: 'conv_12345',
      source: 'DOM',
    },
  });
  assert.equal(gContact.type, 'GROUP');
  assert.equal(gIdent.kind, 'CONVERSATION_ID');
  assert.equal(gIdent.isPreferred, true);

  // 3. Validation: PERSON cannot have CONVERSATION_ID as preferred identity
  assert.throws(
    () =>
      contactRepo.createWithPreferredIdentity({
        accountId: account1.id,
        type: 'PERSON',
        displayName: 'Invalid Person',
        initialIdentity: {
          kind: 'CONVERSATION_ID',
          value: 'conv_bad',
          source: 'DOM',
        },
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'UNSUPPORTED_TARGET_TYPE',
  );

  // 4. Validation: Cross-account identity rejected in ContactIdentityRepository
  assert.throws(
    () =>
      identRepo.create({
        accountId: account2.id, // mismatch with pContact.accountId (account1)
        contactId: pContact.id,
        kind: 'UNIQUE_ID',
        value: 'unique_alice_2',
        source: 'PAGE_DATA',
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'ACCOUNT_MISMATCH',
  );

  // 5. Switching preferred identity
  const secUid2 = identRepo.create({
    accountId: account1.id,
    contactId: pContact.id,
    kind: 'UNIQUE_ID',
    value: 'unique_alice_1',
    source: 'PAGE_DATA',
    isPreferred: false,
  });

  const switchRes = identRepo.setPreferred(pContact.id, secUid2.id);
  assert.equal(switchRes.previousPreferred?.id, pIdent.id);
  assert.equal(switchRes.newPreferred.id, secUid2.id);
  assert.equal(identRepo.findPreferredActiveByContactId(pContact.id)?.id, secUid2.id);

  // 6. Supersede identity
  const superseded = identRepo.supersede(pIdent.id);
  assert.equal(superseded?.state, 'SUPERSEDED');
  assert.equal(superseded?.isPreferred, false);
});

test('V4Repositories: SendTask target admission and enable restriction', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account1 = new AccountRepository(client).create({ name: 'Account 1' });
  const account2 = new AccountRepository(client).create({ name: 'Account 2' });
  const template = new MessageTemplateRepository(client).create({
    name: 'Tpl',
    providerType: 'STATIC',
    messages: ['Hi!'],
  });

  const contactRepo = new ContactRepository(client);
  const taskRepo = new SendTaskRepository(client);

  const { contact: cPerson } = contactRepo.createWithPreferredIdentity({
    accountId: account1.id,
    type: 'PERSON',
    displayName: 'Person A',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_person_a',
      source: 'LEGACY_MANUAL',
    },
  });
  const { contact: cGroup } = contactRepo.createWithPreferredIdentity({
    accountId: account1.id,
    type: 'GROUP',
    displayName: 'Group B',
    initialIdentity: {
      kind: 'CONVERSATION_ID',
      value: 'conv_group_b',
      source: 'LEGACY_MANUAL',
    },
  });
  const cSystem = contactRepo.create({
    accountId: account1.id,
    type: 'SYSTEM',
    displayName: 'System C',
  });
  const cUnknown = contactRepo.create({
    accountId: account1.id,
    type: 'UNKNOWN',
    displayName: 'Unknown D',
  });
  const { contact: cCrossAccount } = contactRepo.createWithPreferredIdentity({
    accountId: account2.id,
    type: 'PERSON',
    displayName: 'Cross Person',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_cross_person',
      source: 'LEGACY_MANUAL',
    },
  });

  // 1. PERSON and GROUP targets accepted; Task is always enabled=false on creation
  const { task } = taskRepo.create({
    name: 'Valid Task',
    accountId: account1.id,
    templateId: template.id,
    startTime: '08:00',
    endTime: '09:00',
    timezone: 'Asia/Shanghai',
    targetContactIds: [cPerson.id, cGroup.id],
  });
  assert.equal(task.enabled, false);
  assert.deepEqual(taskRepo.getTargetContactIds(task.id).sort(), [cPerson.id, cGroup.id].sort());

  // 2. SYSTEM target rejected
  assert.throws(
    () =>
      taskRepo.create({
        name: 'Task System',
        accountId: account1.id,
        templateId: template.id,
        startTime: '08:00',
        endTime: '09:00',
        timezone: 'Asia/Shanghai',
        targetContactIds: [cSystem.id],
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'UNSUPPORTED_TARGET_TYPE',
  );

  // 3. UNKNOWN target rejected
  assert.throws(
    () =>
      taskRepo.create({
        name: 'Task Unknown',
        accountId: account1.id,
        templateId: template.id,
        startTime: '08:00',
        endTime: '09:00',
        timezone: 'Asia/Shanghai',
        targetContactIds: [cUnknown.id],
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'UNSUPPORTED_TARGET_TYPE',
  );

  // 4. Cross-account target rejected
  assert.throws(
    () =>
      taskRepo.create({
        name: 'Task Cross',
        accountId: account1.id,
        templateId: template.id,
        startTime: '08:00',
        endTime: '09:00',
        timezone: 'Asia/Shanghai',
        targetContactIds: [cCrossAccount.id],
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'ACCOUNT_MISMATCH',
  );

  // 5. Mixed valid + invalid rollback: Task is NOT created
  assert.throws(() =>
    taskRepo.create({
      name: 'Task Mixed Rollback',
      accountId: account1.id,
      templateId: template.id,
      startTime: '08:00',
      endTime: '09:00',
      timezone: 'Asia/Shanghai',
      targetContactIds: [cPerson.id, cCrossAccount.id],
    }),
  );
  assert.equal(taskRepo.listByAccountId(account1.id).length, 1); // only the first valid task exists

  // 6. setTargets: invalid target rolls back and PRESERVES previous target set
  assert.throws(
    () => taskRepo.setTargets(task.id, [cPerson.id, cSystem.id]),
    (err: unknown) => err instanceof RepositoryError && err.code === 'UNSUPPORTED_TARGET_TYPE',
  );
  assert.deepEqual(taskRepo.getTargetContactIds(task.id).sort(), [cPerson.id, cGroup.id].sort());

  // 7. Post-Admission Target Safety: Mutating targeted contact to SYSTEM is rejected
  assert.throws(
    () => contactRepo.update(cPerson.id, { type: 'SYSTEM' }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'UNSUPPORTED_TARGET_TYPE',
  );

  // 8. Max 100 targets validation
  const manyTargetIds = Array.from({ length: 101 }, (_, i) => `target-${i}`);
  assert.throws(
    () =>
      taskRepo.create({
        name: 'Task Too Many Targets',
        accountId: account1.id,
        templateId: template.id,
        startTime: '08:00',
        endTime: '09:00',
        timezone: 'Asia/Shanghai',
        targetContactIds: manyTargetIds,
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'VALIDATION_ERROR',
  );
  assert.throws(
    () => taskRepo.setTargets(task.id, manyTargetIds),
    (err: unknown) => err instanceof RepositoryError && err.code === 'VALIDATION_ERROR',
  );
});

test('V4Repositories: ExecutionRun, TargetSendRecord, and DeliveryResolution machine truth and human resolution', (context) => {
  const { client } = createTemporaryDatabase(context);
  const admin = new AdminUserRepository(client).create({ username: 'admin', passwordHash: 'hash' });
  const account = new AccountRepository(client).create({ name: 'Douyin Account' });
  const template = new MessageTemplateRepository(client).create({
    name: 'Tpl',
    providerType: 'STATIC',
    messages: ['Good morning!'],
  });
  const { contact } = new ContactRepository(client).createWithPreferredIdentity({
    accountId: account.id,
    type: 'PERSON',
    displayName: 'Friend B',
    initialIdentity: {
      kind: 'SEC_UID',
      value: 'sec_friend_b',
      source: 'LEGACY_MANUAL',
    },
  });

  const task = new SendTaskRepository(client).create({
    name: 'Morning Greeting',
    accountId: account.id,
    templateId: template.id,
    startTime: '08:30',
    endTime: '09:30',
    timezone: 'Asia/Shanghai',
    targetContactIds: [contact.id],
  }).task;

  // 1. ExecutionRun state transitions and terminal immutability
  const runRepo = new ExecutionRunRepository(client);
  const run = runRepo.create({
    kind: 'SCHEDULED_TASK',
    accountId: account.id,
    taskId: task.id,
    templateId: template.id,
    businessDate: '2026-08-31',
    idempotencyKey: `scheduled:${task.id}:2026-08-31`,
  });

  assert.equal(run.status, 'PENDING');
  const runningRun = runRepo.markRunning(run.id);
  assert.equal(runningRun.status, 'RUNNING');

  const completedRun = runRepo.markCompleted(run.id, 'SUCCESS');
  assert.equal(completedRun.status, 'SUCCESS');

  // Terminal run cannot be modified
  assert.throws(
    () => runRepo.markRunning(run.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
  );
  assert.throws(
    () => runRepo.markCancelled(run.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
  );

  // 2. TargetSendRecord machine truth
  const recordRepo = new TargetSendRecordRepository(client);
  const record = recordRepo.create({
    runId: run.id,
    taskId: task.id,
    contactId: contact.id,
    businessDate: '2026-08-31',
    templateId: template.id,
    messageText: 'Good morning!',
    targetIdentityKindSnapshot: 'SEC_UID',
    targetIdentityValueDigest: 'sha256-ident',
  });

  assert.equal(record.machineStatus, 'READY');

  // Pre-action markDeliveryUnknown is REJECTED
  assert.throws(
    () => recordRepo.markDeliveryUnknown(record.id),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  const resRepo = new DeliveryResolutionRepository(client);

  // Delivery resolution on READY record is REJECTED
  assert.throws(
    () =>
      resRepo.create({
        targetSendRecordId: record.id,
        resolution: 'CONFIRMED_DELIVERED',
        resolvedByAdminUserId: admin.id,
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  // Claim for execution
  const claim1 = recordRepo.claimForExecution(record.id);
  assert.equal(claim1.type, 'CLAIMED');

  // Record send action started
  recordRepo.recordSendActionStarted(record.id);

  // Post-action markFailed is REJECTED (must use markDeliveryUnknown)
  assert.throws(
    () => recordRepo.markFailed(record.id, { failureCode: 'SEND_ACTION_NOT_TRIGGERED' }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  // Cannot schedule retry after send action started
  assert.throws(
    () =>
      recordRepo.scheduleRetry(record.id, {
        nextRetryAt: new Date(Date.now() + 60_000),
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'INVALID_TRANSITION',
  );

  // Mark DELIVERY_UNKNOWN
  const unknownRecord = recordRepo.markDeliveryUnknown(record.id, {
    failureCode: 'DELIVERY_VERIFICATION_TIMEOUT',
    finishedAt: new Date(),
  });
  assert.equal(unknownRecord.machineStatus, 'DELIVERY_UNKNOWN');

  // DELIVERY_UNKNOWN is machine-terminal: cannot mark SUCCESS afterwards
  assert.throws(
    () =>
      recordRepo.markSuccess(record.id, {
        sentAt: new Date(),
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'TERMINAL_STATE',
  );

  // 3. DeliveryResolution: Initial resolution on DELIVERY_UNKNOWN
  const r1 = resRepo.create({
    targetSendRecordId: record.id,
    resolution: 'CONFIRMED_DELIVERED',
    resolvedByAdminUserId: admin.id,
    note: 'Initial human check.',
  });
  assert.equal(r1.resolution, 'CONFIRMED_DELIVERED');
  assert.equal(r1.originalMachineStatus, 'DELIVERY_UNKNOWN');

  // Machine record status remains DELIVERY_UNKNOWN (not modified to SUCCESS)
  const freshRecord = recordRepo.findById(record.id);
  assert.equal(freshRecord?.machineStatus, 'DELIVERY_UNKNOWN');

  // Non-tail supersession rejected (attempting to create another resolution without superseding r1)
  assert.throws(
    () =>
      resRepo.create({
        targetSendRecordId: record.id,
        resolution: 'CONFIRMED_NOT_DELIVERED',
        resolvedByAdminUserId: admin.id,
      }),
    (err: unknown) => err instanceof RepositoryError && err.code === 'CONFLICT',
  );

  // Linear supersession chain (r2 supersedes r1)
  const r2 = resRepo.create({
    targetSendRecordId: record.id,
    supersedesResolutionId: r1.id,
    resolution: 'CONFIRMED_NOT_DELIVERED',
    resolvedByAdminUserId: admin.id,
    note: 'Followup corrected.',
  });
  assert.equal(r2.supersedesResolutionId, r1.id);
  assert.equal(resRepo.findLatestForTargetSendRecord(record.id)?.id, r2.id);

  // Audit event
  const auditRepo = new AuditEventRepository(client);
  const audit = auditRepo.create({
    actorAdminUserId: admin.id,
    action: 'DELIVERY_RESOLVED',
    entityType: 'DELIVERY_RESOLUTION',
    entityId: r2.id,
    outcome: 'SUCCESS',
  });
  assert.equal(audit.action, 'DELIVERY_RESOLVED');
});
