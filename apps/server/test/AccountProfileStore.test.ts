import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountProfileStore,
  AccountProfileStoreError,
  NativeAtomicDirectoryRenamer,
} from '../src/onboarding/AccountProfileStore.js';
import { BrowserOperationCoordinator } from '../src/onboarding/BrowserOperationCoordinator.js';

function createStore(context: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-profile-store-test-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new AccountProfileStore(directory) };
}

test('AccountProfileStore prepares an Account-owned staging marker and atomically finalizes it', (context) => {
  const { store } = createStore(context);
  const sessionId = randomUUID();
  const accountId = randomUUID();
  const staging = store.prepareStaging(sessionId, accountId);
  assert.equal(staging, store.stagingPath(sessionId));
  assert.deepEqual(store.inspectReconciliation(sessionId, accountId), {
    staging: 'OWNED',
    final: 'ABSENT',
  });

  const markerPath = path.join(staging, '.sparkkeeper-profile.json');
  assert.deepEqual(JSON.parse(readFileSync(markerPath, 'utf8')), {
    version: 1,
    accountId,
    createdByLoginSessionId: sessionId,
  });
  if (process.platform !== 'win32') {
    assert.equal(statSync(staging).mode & 0o777, 0o700);
    assert.equal(statSync(markerPath).mode & 0o777, 0o600);
  }

  const final = store.finalizeStaging(sessionId, accountId);
  assert.equal(final, store.finalPath(accountId));
  assert.equal(store.requireFinal(accountId), final);
  assert.deepEqual(store.inspectReconciliation(sessionId, accountId), {
    staging: 'ABSENT',
    final: 'OWNED',
  });
});

test('AccountProfileStore never overwrites a final profile and reports both-path recovery', (context) => {
  const { store } = createStore(context);
  const accountId = randomUUID();
  const firstSessionId = randomUUID();
  store.prepareStaging(firstSessionId, accountId);
  store.finalizeStaging(firstSessionId, accountId);

  const replacementSessionId = randomUUID();
  store.prepareStaging(replacementSessionId, accountId);
  assert.deepEqual(store.inspectReconciliation(replacementSessionId, accountId), {
    staging: 'OWNED',
    final: 'OWNED',
  });
  assert.throws(
    () => store.finalizeStaging(replacementSessionId, accountId),
    (error: unknown) =>
      error instanceof AccountProfileStoreError && error.code === 'PROFILE_EXISTS',
  );
});

test('AccountProfileStore quarantines only a profile with matching ownership', (context) => {
  const { store } = createStore(context);
  const sessionId = randomUUID();
  const accountId = randomUUID();
  const staging = store.prepareStaging(sessionId, accountId);
  writeFileSync(path.join(staging, 'Browser State'), 'fixture', 'utf8');

  assert.throws(
    () => store.quarantineStaging(sessionId, randomUUID()),
    (error: unknown) =>
      error instanceof AccountProfileStoreError && error.code === 'OWNERSHIP_MISMATCH',
  );
  const quarantined = store.quarantineStaging(
    sessionId,
    accountId,
    new Date('2026-09-21T10:00:00.000Z'),
  );
  assert.ok(quarantined?.startsWith(store.quarantineRoot));
  assert.equal(store.inspectReconciliation(sessionId, accountId).staging, 'ABSENT');
  assert.equal(readFileSync(path.join(quarantined!, 'Browser State'), 'utf8'), 'fixture');
});

test('AccountProfileStore rejects non-UUID paths, symlinks, and invalid ownership markers', (context) => {
  const { directory, store } = createStore(context);
  assert.throws(
    () => store.stagingPath('../escape'),
    (error: unknown) =>
      error instanceof AccountProfileStoreError && error.code === 'INVALID_IDENTIFIER',
  );

  const accountId = randomUUID();
  const external = path.join(directory, 'external-profile');
  mkdirSync(external);
  symlinkSync(external, store.finalPath(accountId));
  assert.throws(
    () => store.requireFinal(accountId),
    (error: unknown) =>
      error instanceof AccountProfileStoreError && error.code === 'SYMLINK_REJECTED',
  );

  const sessionId = randomUUID();
  const otherAccountId = randomUUID();
  store.prepareStaging(sessionId, accountId);
  assert.throws(
    () => store.finalizeStaging(sessionId, otherAccountId),
    (error: unknown) =>
      error instanceof AccountProfileStoreError && error.code === 'OWNERSHIP_MISMATCH',
  );
});

test('AccountProfileStore rejects a managed-parent symlink swap before destructive cleanup', (context) => {
  const { directory, store } = createStore(context);
  const sessionId = randomUUID();
  const accountId = randomUUID();
  store.prepareStaging(sessionId, accountId);
  const originalOnboarding = `${store.onboardingRoot}-original`;
  const external = path.join(directory, 'external-onboarding');
  mkdirSync(external, { mode: 0o700 });
  writeFileSync(path.join(external, sessionId), 'must-survive', 'utf8');
  renameSync(store.onboardingRoot, originalOnboarding);
  symlinkSync(external, store.onboardingRoot, 'dir');

  assert.throws(
    () => store.removeEmptyStaging(sessionId, accountId),
    (error: unknown) =>
      error instanceof AccountProfileStoreError && error.code === 'SYMLINK_REJECTED',
  );
  assert.equal(readFileSync(path.join(external, sessionId), 'utf8'), 'must-survive');
});

test('AccountProfileStore rejects a parent symlink swap between validation and rename syscall', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-profile-swap-race-test-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const nativeRenamer = new NativeAtomicDirectoryRenamer();
  let store!: AccountProfileStore;
  const sessionId = randomUUID();
  const accountId = randomUUID();
  const originalOnboarding = path.join(directory, 'original-onboarding');
  const external = path.join(directory, 'external-onboarding');
  const externalSession = path.join(external, sessionId);
  store = new AccountProfileStore(directory, {
    renamer: {
      createOwned(source, marker) {
        nativeRenamer.createOwned(source, marker);
      },
      renameNoReplace(source, destination, marker) {
        mkdirSync(externalSession, { recursive: true, mode: 0o700 });
        writeFileSync(path.join(externalSession, 'must-survive'), 'external', 'utf8');
        renameSync(store.onboardingRoot, originalOnboarding);
        symlinkSync(external, store.onboardingRoot, 'dir');
        nativeRenamer.renameNoReplace(source, destination, marker);
      },
      removeEmptyOwned(source, marker) {
        return nativeRenamer.removeEmptyOwned(source, marker);
      },
    },
  });
  store.prepareStaging(sessionId, accountId);

  assert.throws(
    () => store.finalizeStaging(sessionId, accountId),
    (error: unknown) =>
      error instanceof AccountProfileStoreError &&
      (error.code === 'SYMLINK_REJECTED' || error.code === 'BOUNDARY_VIOLATION'),
  );
  assert.equal(readFileSync(path.join(externalSession, 'must-survive'), 'utf8'), 'external');
});

test('AccountProfileStore atomic no-replace rejects a destination created at rename time', (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-profile-race-test-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const nativeRenamer = new NativeAtomicDirectoryRenamer();
  const store = new AccountProfileStore(directory, {
    renamer: {
      createOwned(source, marker) {
        nativeRenamer.createOwned(source, marker);
      },
      renameNoReplace(source, destination, marker) {
        mkdirSync(destination, { mode: 0o700 });
        writeFileSync(path.join(destination, 'race-owner'), 'must-survive', 'utf8');
        nativeRenamer.renameNoReplace(source, destination, marker);
      },
      removeEmptyOwned(source, marker) {
        return nativeRenamer.removeEmptyOwned(source, marker);
      },
    },
  });
  const sessionId = randomUUID();
  const accountId = randomUUID();
  const staging = store.prepareStaging(sessionId, accountId);

  assert.throws(
    () => store.finalizeStaging(sessionId, accountId),
    (error: unknown) =>
      error instanceof AccountProfileStoreError && error.code === 'PROFILE_EXISTS',
  );
  assert.equal(store.inspectReconciliation(sessionId, accountId).staging, 'OWNED');
  assert.equal(
    readFileSync(path.join(store.finalPath(accountId), 'race-owner'), 'utf8'),
    'must-survive',
  );
  assert.equal(staging, store.stagingPath(sessionId));
});

test('AccountProfileStore removes only empty owned staging profiles', (context) => {
  const { store } = createStore(context);
  const sessionId = randomUUID();
  const accountId = randomUUID();
  store.prepareStaging(sessionId, accountId);
  assert.equal(store.removeEmptyStaging(sessionId, accountId), true);
  assert.equal(store.removeEmptyStaging(sessionId, accountId), false);

  const nonEmptySession = randomUUID();
  const nonEmpty = store.prepareStaging(nonEmptySession, accountId);
  writeFileSync(path.join(nonEmpty, 'state'), 'fixture', 'utf8');
  assert.equal(store.removeEmptyStaging(nonEmptySession, accountId), false);
});

test('BrowserOperationCoordinator grants one token-owned global lease', () => {
  const coordinator = new BrowserOperationCoordinator();
  const first = coordinator.acquire('login-session-a', 'staging:a');
  assert.ok(first);
  assert.equal(coordinator.acquire('login-session-b', 'staging:b'), undefined);
  assert.equal(coordinator.isHeldBy('login-session-a'), true);
  first.release();
  first.release();
  const second = coordinator.acquire('login-session-b', 'staging:b');
  assert.ok(second);
  assert.deepEqual(coordinator.current(), {
    operationId: 'login-session-b',
    profileKey: 'staging:b',
  });
  second.release();
  assert.equal(coordinator.current(), undefined);
});
