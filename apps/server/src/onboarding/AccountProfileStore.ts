import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MARKER_FILE = '.sparkkeeper-profile.json';
const MARKER_MAX_BYTES = 4_096;

export interface AccountProfileMarker {
  readonly version: 1;
  readonly accountId: string;
  readonly createdByLoginSessionId: string;
}

export interface ProfileReconciliationState {
  readonly staging: 'ABSENT' | 'OWNED' | 'INVALID';
  readonly final: 'ABSENT' | 'OWNED' | 'INVALID';
}

export interface AtomicDirectoryRenamer {
  createOwned(source: string, marker: AccountProfileMarker): void;
  renameNoReplace(
    source: string,
    destination: string,
    marker: AccountProfileMarker,
  ): void;
  removeEmptyOwned(source: string, marker: AccountProfileMarker): boolean;
}

export interface AccountProfileStoreOptions {
  readonly renamer?: AtomicDirectoryRenamer;
}

export class AccountProfileStoreError extends Error {
  readonly code:
    | 'INVALID_IDENTIFIER'
    | 'BOUNDARY_VIOLATION'
    | 'SYMLINK_REJECTED'
    | 'PROFILE_EXISTS'
    | 'PROFILE_MISSING'
    | 'MARKER_INVALID'
    | 'OWNERSHIP_MISMATCH'
    | 'CROSS_DEVICE_RENAME'
    | 'FILESYSTEM_ERROR';

  constructor(code: AccountProfileStoreError['code'], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AccountProfileStoreError';
    this.code = code;
  }
}

export class AccountProfileStore {
  readonly root: string;
  readonly onboardingRoot: string;
  readonly quarantineRoot: string;
  private readonly renamer: AtomicDirectoryRenamer;

  constructor(dataDirectory: string, options: AccountProfileStoreOptions = {}) {
    const resolvedDataDirectory = path.resolve(dataDirectory);
    this.ensureBaseDirectory(resolvedDataDirectory);
    const canonicalDataDirectory = realpathSync(resolvedDataDirectory);
    this.root = path.join(canonicalDataDirectory, 'browser-profiles');
    this.onboardingRoot = path.join(this.root, '.onboarding');
    this.quarantineRoot = path.join(this.root, '.quarantine');
    this.renamer = options.renamer ?? new NativeAtomicDirectoryRenamer();
    this.ensurePrivateDirectory(this.root);
    this.ensurePrivateDirectory(this.onboardingRoot);
    this.ensurePrivateDirectory(this.quarantineRoot);
    this.assertManagedRoots();
  }

  finalPath(accountId: string): string {
    return this.ownedPath(this.root, this.uuid(accountId, 'accountId'));
  }

  stagingPath(loginSessionId: string): string {
    return this.ownedPath(this.onboardingRoot, this.uuid(loginSessionId, 'loginSessionId'));
  }

  prepareStaging(loginSessionId: string, accountId: string): string {
    const sessionId = this.uuid(loginSessionId, 'loginSessionId');
    const normalizedAccountId = this.uuid(accountId, 'accountId');
    const profilePath = this.stagingPath(sessionId);
    this.assertManagedRoots();
    if (this.entryExists(profilePath)) {
      throw new AccountProfileStoreError('PROFILE_EXISTS', 'Staging profile already exists.');
    }
    try {
      const marker: AccountProfileMarker = {
        version: 1,
        accountId: normalizedAccountId,
        createdByLoginSessionId: sessionId,
      };
      this.renamer.createOwned(profilePath, marker);
      this.requireOwnedProfile(profilePath, marker);
      return profilePath;
    } catch (error) {
      if (error instanceof AccountProfileStoreError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new AccountProfileStoreError(
          'PROFILE_EXISTS',
          'Staging profile already exists.',
          error,
        );
      }
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Failed to prepare staging profile.',
        error,
      );
    }
  }

  requireFinal(accountId: string): string {
    const normalizedAccountId = this.uuid(accountId, 'accountId');
    const profilePath = this.finalPath(normalizedAccountId);
    this.assertDirectory(profilePath);
    const marker = this.readMarker(profilePath);
    if (marker.accountId !== normalizedAccountId) {
      throw new AccountProfileStoreError(
        'OWNERSHIP_MISMATCH',
        'Final profile ownership does not match the Account.',
      );
    }
    return profilePath;
  }

  finalizeStaging(loginSessionId: string, accountId: string): string {
    const sessionId = this.uuid(loginSessionId, 'loginSessionId');
    const normalizedAccountId = this.uuid(accountId, 'accountId');
    const staging = this.stagingPath(sessionId);
    const final = this.finalPath(normalizedAccountId);
    this.assertManagedRoots();
    const marker = this.requireOwnedStaging(staging, sessionId, normalizedAccountId);
    this.assertDestinationEntrySafe(final);
    try {
      this.renamer.renameNoReplace(staging, final, marker);
      this.requireOwnedProfile(final, marker);
      return final;
    } catch (error) {
      if (error instanceof AccountProfileStoreError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        throw new AccountProfileStoreError(
          'CROSS_DEVICE_RENAME',
          'Account profile finalization requires one filesystem.',
          error,
        );
      }
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Failed to finalize Account profile.',
        error,
      );
    }
  }

  quarantineStaging(
    loginSessionId: string,
    accountId: string,
    now = new Date(),
  ): string | undefined {
    const sessionId = this.uuid(loginSessionId, 'loginSessionId');
    const normalizedAccountId = this.uuid(accountId, 'accountId');
    const staging = this.stagingPath(sessionId);
    this.assertManagedRoots();
    if (!this.entryExists(staging)) return undefined;
    this.requireOwnedStaging(staging, sessionId, normalizedAccountId);
    return this.moveToQuarantine(staging, normalizedAccountId, now);
  }

  quarantineFinal(accountId: string, now = new Date()): string | undefined {
    const normalizedAccountId = this.uuid(accountId, 'accountId');
    const final = this.finalPath(normalizedAccountId);
    this.assertManagedRoots();
    if (!this.entryExists(final)) return undefined;
    this.requireFinal(normalizedAccountId);
    return this.moveToQuarantine(final, normalizedAccountId, now);
  }

  removeEmptyStaging(loginSessionId: string, accountId: string): boolean {
    const sessionId = this.uuid(loginSessionId, 'loginSessionId');
    const normalizedAccountId = this.uuid(accountId, 'accountId');
    const staging = this.stagingPath(sessionId);
    this.assertManagedRoots();
    if (!this.entryExists(staging)) return false;
    const marker = this.requireOwnedStaging(staging, sessionId, normalizedAccountId);
    const removed = this.renamer.removeEmptyOwned(staging, marker);
    if (!removed) return false;
    this.assertManagedRoots();
    if (this.entryExists(staging)) {
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Removed staging profile is still present.',
      );
    }
    return removed;
  }

  inspectReconciliation(loginSessionId: string, accountId: string): ProfileReconciliationState {
    const sessionId = this.uuid(loginSessionId, 'loginSessionId');
    const normalizedAccountId = this.uuid(accountId, 'accountId');
    return {
      staging: this.classify(this.stagingPath(sessionId), normalizedAccountId, sessionId),
      final: this.classify(this.finalPath(normalizedAccountId), normalizedAccountId),
    };
  }

  private classify(
    profilePath: string,
    accountId: string,
    loginSessionId?: string,
  ): 'ABSENT' | 'OWNED' | 'INVALID' {
    this.assertManagedRoots();
    if (!this.entryExists(profilePath)) return 'ABSENT';
    try {
      this.assertDirectory(profilePath);
      const marker = this.readMarker(profilePath);
      if (marker.accountId !== accountId) return 'INVALID';
      if (loginSessionId !== undefined && marker.createdByLoginSessionId !== loginSessionId) {
        return 'INVALID';
      }
      return 'OWNED';
    } catch {
      return 'INVALID';
    }
  }

  private requireOwnedStaging(
    staging: string,
    sessionId: string,
    accountId: string,
  ): AccountProfileMarker {
    this.assertDirectory(staging);
    const marker = this.readMarker(staging);
    if (marker.accountId !== accountId || marker.createdByLoginSessionId !== sessionId) {
      throw new AccountProfileStoreError(
        'OWNERSHIP_MISMATCH',
        'Staging profile ownership does not match the LoginSession.',
      );
    }
    return marker;
  }

  private requireOwnedProfile(profilePath: string, expected: AccountProfileMarker): void {
    this.assertDirectory(profilePath);
    const marker = this.readMarker(profilePath);
    if (
      marker.accountId !== expected.accountId ||
      marker.createdByLoginSessionId !== expected.createdByLoginSessionId
    ) {
      throw new AccountProfileStoreError(
        'OWNERSHIP_MISMATCH',
        'Profile ownership changed during the filesystem operation.',
      );
    }
  }

  private moveToQuarantine(source: string, accountId: string, now: Date): string {
    this.assertManagedRoots();
    this.assertSafeDirectory(source);
    const marker = this.readMarker(source);
    if (marker.accountId !== accountId) {
      throw new AccountProfileStoreError(
        'OWNERSHIP_MISMATCH',
        'Profile ownership does not match the Account.',
      );
    }
    const timestamp = now.toISOString().replace(/[-:.]/g, '');
    const suffix = randomBytes(6).toString('hex');
    const destination = this.ownedPath(this.quarantineRoot, `${accountId}-${timestamp}-${suffix}`);
    this.assertDestinationEntrySafe(destination);
    try {
      this.renamer.renameNoReplace(source, destination, marker);
      this.requireOwnedProfile(destination, marker);
      return destination;
    } catch (error) {
      if (error instanceof AccountProfileStoreError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        throw new AccountProfileStoreError(
          'CROSS_DEVICE_RENAME',
          'Profile quarantine requires one filesystem.',
          error,
        );
      }
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Failed to quarantine Account profile.',
        error,
      );
    }
  }

  private readMarker(profilePath: string): AccountProfileMarker {
    this.assertSafeDirectory(profilePath);
    const markerPath = this.ownedPath(profilePath, MARKER_FILE);
    if (!this.entryExists(markerPath)) {
      throw new AccountProfileStoreError('MARKER_INVALID', 'Profile marker is missing.');
    }
    const markerStat = lstatSync(markerPath);
    if (markerStat.isSymbolicLink()) {
      throw new AccountProfileStoreError('SYMLINK_REJECTED', 'Profile marker symlink rejected.');
    }
    if (!markerStat.isFile() || markerStat.size > MARKER_MAX_BYTES) {
      throw new AccountProfileStoreError('MARKER_INVALID', 'Profile marker is invalid.');
    }
    if (process.platform !== 'win32') chmodSync(markerPath, 0o600);
    try {
      const parsed = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<AccountProfileMarker>;
      if (
        parsed.version !== 1 ||
        typeof parsed.accountId !== 'string' ||
        typeof parsed.createdByLoginSessionId !== 'string'
      ) {
        throw new Error('Invalid marker fields.');
      }
      return {
        version: 1,
        accountId: this.uuid(parsed.accountId, 'marker accountId'),
        createdByLoginSessionId: this.uuid(parsed.createdByLoginSessionId, 'marker loginSessionId'),
      };
    } catch (error) {
      if (error instanceof AccountProfileStoreError) throw error;
      throw new AccountProfileStoreError('MARKER_INVALID', 'Profile marker is invalid.', error);
    }
  }

  private ensurePrivateDirectory(directory: string): void {
    try {
      if (this.entryExists(directory)) {
        const state = lstatSync(directory);
        if (state.isSymbolicLink()) {
          throw new AccountProfileStoreError(
            'SYMLINK_REJECTED',
            'Profile directory symlink rejected.',
          );
        }
        if (!state.isDirectory()) {
          throw new AccountProfileStoreError(
            'FILESYSTEM_ERROR',
            'Profile root is not a directory.',
          );
        }
        if (process.platform !== 'win32') chmodSync(directory, 0o700);
        return;
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') chmodSync(directory, 0o700);
    } catch (error) {
      if (error instanceof AccountProfileStoreError) throw error;
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Failed to prepare profile root.',
        error,
      );
    }
  }

  private assertDirectory(directory: string): void {
    this.assertSafeDirectory(directory);
    if (!this.entryExists(directory)) {
      throw new AccountProfileStoreError('PROFILE_MISSING', 'Account profile is missing.');
    }
    const state = lstatSync(directory);
    if (state.isSymbolicLink()) {
      throw new AccountProfileStoreError('SYMLINK_REJECTED', 'Profile symlink rejected.');
    }
    if (!state.isDirectory()) {
      throw new AccountProfileStoreError('PROFILE_MISSING', 'Account profile is unavailable.');
    }
    if (process.platform !== 'win32') chmodSync(directory, 0o700);
  }

  private ownedPath(parent: string, child: string): string {
    const candidate = path.resolve(parent, child);
    const boundary = `${path.resolve(parent)}${path.sep}`;
    if (!candidate.startsWith(boundary)) {
      throw new AccountProfileStoreError(
        'BOUNDARY_VIOLATION',
        'Profile path escaped its fixed root.',
      );
    }
    return candidate;
  }

  private uuid(value: string, fieldName: string): string {
    const normalized = value.trim().toLowerCase();
    if (!UUID_REGEX.test(normalized)) {
      throw new AccountProfileStoreError(
        'INVALID_IDENTIFIER',
        `${fieldName} must be a canonical UUID.`,
      );
    }
    return normalized;
  }

  private ensureBaseDirectory(directory: string): void {
    try {
      if (!this.entryExists(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
      const state = lstatSync(directory);
      if (state.isSymbolicLink()) {
        throw new AccountProfileStoreError(
          'SYMLINK_REJECTED',
          'Profile data directory symlink rejected.',
        );
      }
      if (!state.isDirectory()) {
        throw new AccountProfileStoreError(
          'FILESYSTEM_ERROR',
          'Profile data directory is not a directory.',
        );
      }
    } catch (error) {
      if (error instanceof AccountProfileStoreError) throw error;
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Failed to prepare profile data directory.',
        error,
      );
    }
  }

  private assertManagedRoots(): void {
    this.assertCanonicalDirectory(this.root, this.root);
    this.assertCanonicalDirectory(this.onboardingRoot, this.onboardingRoot);
    this.assertCanonicalDirectory(this.quarantineRoot, this.quarantineRoot);
  }

  private assertSafeDirectory(directory: string): void {
    const resolved = path.resolve(directory);
    const relative = path.relative(this.root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AccountProfileStoreError(
        'BOUNDARY_VIOLATION',
        'Profile directory escaped its canonical root.',
      );
    }
    this.assertCanonicalDirectory(this.root, this.root);
    let current = this.root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if (!this.entryExists(current)) return;
      const state = lstatSync(current);
      if (state.isSymbolicLink()) {
        throw new AccountProfileStoreError(
          'SYMLINK_REJECTED',
          'Profile directory ancestor symlink rejected.',
        );
      }
      if (!state.isDirectory()) {
        throw new AccountProfileStoreError(
          'FILESYSTEM_ERROR',
          'Profile directory ancestor is not a directory.',
        );
      }
      const canonical = realpathSync(current);
      const boundary = `${this.root}${path.sep}`;
      if (canonical !== this.root && !canonical.startsWith(boundary)) {
        throw new AccountProfileStoreError(
          'BOUNDARY_VIOLATION',
          'Profile directory ancestor escaped its canonical root.',
        );
      }
      if (process.platform !== 'win32') chmodSync(current, 0o700);
    }
  }

  private assertCanonicalDirectory(directory: string, expectedCanonical: string): void {
    if (!this.entryExists(directory)) {
      throw new AccountProfileStoreError('PROFILE_MISSING', 'Managed profile root is missing.');
    }
    const state = lstatSync(directory);
    if (state.isSymbolicLink()) {
      throw new AccountProfileStoreError(
        'SYMLINK_REJECTED',
        'Managed profile root symlink rejected.',
      );
    }
    if (!state.isDirectory() || realpathSync(directory) !== expectedCanonical) {
      throw new AccountProfileStoreError(
        'BOUNDARY_VIOLATION',
        'Managed profile root no longer matches its canonical directory.',
      );
    }
    if (process.platform !== 'win32') chmodSync(directory, 0o700);
  }

  private assertDestinationEntrySafe(destination: string): void {
    this.assertSafeDirectory(path.dirname(destination));
    if (!this.entryExists(destination)) return;
    if (lstatSync(destination).isSymbolicLink()) {
      throw new AccountProfileStoreError(
        'SYMLINK_REJECTED',
        'Profile destination symlink rejected.',
      );
    }
  }

  private entryExists(entry: string): boolean {
    try {
      lstatSync(entry);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}

export class NativeAtomicDirectoryRenamer implements AtomicDirectoryRenamer {
  private readonly executable = fileURLToPath(
    new URL('../../dist/native/rename-noreplace', import.meta.url),
  );

  createOwned(source: string, marker: AccountProfileMarker): void {
    this.execute('create', [
      path.dirname(source),
      path.basename(source),
      marker.accountId,
      marker.createdByLoginSessionId,
    ]);
  }

  renameNoReplace(
    source: string,
    destination: string,
    marker: AccountProfileMarker,
  ): void {
    this.execute('rename', [
      path.dirname(source),
      path.basename(source),
      path.dirname(destination),
      path.basename(destination),
      marker.accountId,
      marker.createdByLoginSessionId,
    ]);
  }

  removeEmptyOwned(source: string, marker: AccountProfileMarker): boolean {
    return this.execute(
      'remove-empty',
      [
        path.dirname(source),
        path.basename(source),
        marker.accountId,
        marker.createdByLoginSessionId,
      ],
      true,
    );
  }

  private execute(
    operation: 'create' | 'rename' | 'remove-empty',
    args: readonly string[],
    allowNotEmpty = false,
  ): boolean {
    if (process.platform === 'win32') {
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Anchored profile filesystem operations are unavailable on this platform.',
      );
    }
    const result = spawnSync(this.executable, [operation, ...args], {
      stdio: 'ignore',
      timeout: 5_000,
    });
    if (result.error !== undefined) {
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Atomic no-replace rename capability is unavailable.',
        result.error,
      );
    }
    if (result.status === 0) return true;
    if (result.status === 2) {
      throw new AccountProfileStoreError('PROFILE_EXISTS', 'Profile destination already exists.');
    }
    if (allowNotEmpty && result.status === 5) return false;
    if (result.status === 3) {
      throw new AccountProfileStoreError(
        'FILESYSTEM_ERROR',
        'Filesystem does not support the required anchored profile operation.',
      );
    }
    if (result.status === 6) {
      throw new AccountProfileStoreError(
        'SYMLINK_REJECTED',
        'Anchored profile filesystem operation rejected an unsafe path.',
      );
    }
    if (result.status === 7) {
      throw new AccountProfileStoreError(
        'OWNERSHIP_MISMATCH',
        'Profile marker ownership changed during the filesystem operation.',
      );
    }
    if (result.status === 8) {
      throw new AccountProfileStoreError('PROFILE_MISSING', 'Account profile is missing.');
    }
    if (result.status === 9) {
      throw new AccountProfileStoreError(
        'CROSS_DEVICE_RENAME',
        'Profile operation requires one filesystem.',
      );
    }
    throw new AccountProfileStoreError(
      'FILESYSTEM_ERROR',
      'Anchored profile filesystem operation failed.',
    );
  }
}
