import type {
  AccountOnboardingRepository,
  AccountOnboardingSession,
  StartAccountOnboardingInput,
  StartAccountOnboardingResult,
} from '@sparkkeeper/database';
import type { AccountLoginSessionSummary, DouyinAccountIdentity } from '@sparkkeeper/shared';

import type { BrowserOperationLease } from './BrowserOperationCoordinator.js';
import { BrowserOperationCoordinator } from './BrowserOperationCoordinator.js';
import { AccountProfileReconciler } from './AccountProfileReconciler.js';
import { AccountProfileStore } from './AccountProfileStore.js';
import type {
  AccountLoginWorkerEvent,
  AccountLoginWorkerStart,
} from './AccountLoginWorkerProtocol.js';
import type { AccountLoginWorkerSupervisor } from './AccountLoginWorkerSupervisor.js';

export type StartManagedOnboardingResult =
  | (StartAccountOnboardingResult & { readonly summary?: AccountLoginSessionSummary })
  | { readonly outcome: 'RELEASE_GATE_CLOSED' };

interface SupervisorContract {
  start(
    start: AccountLoginWorkerStart,
    onEvent: (event: AccountLoginWorkerEvent) => void | Promise<void>,
  ): void;
  stop(sessionId: string): Promise<void>;
  stopAll(): Promise<void>;
  owns(sessionId: string): boolean;
  getConsoleEndpoint(sessionId: string): unknown;
}

interface ManagerOptions {
  readonly repository: AccountOnboardingRepository;
  readonly profiles: AccountProfileStore;
  readonly supervisor: SupervisorContract;
  readonly coordinator?: BrowserOperationCoordinator;
  readonly clock?: (() => Date) | undefined;
  readonly setTimer?: ((callback: () => void, delayMs: number) => NodeJS.Timeout) | undefined;
  readonly clearTimer?: ((timer: NodeJS.Timeout) => void) | undefined;
  readonly invalidateConsole?: ((sessionId: string) => void) | undefined;
  readonly releaseGateOpen?: (() => boolean) | undefined;
}

interface LiveSession {
  readonly lease: BrowserOperationLease;
  timer: NodeJS.Timeout | undefined;
  completing: boolean;
}

export class AccountOnboardingManager {
  private readonly repository: AccountOnboardingRepository;
  private readonly profiles: AccountProfileStore;
  private readonly supervisor: SupervisorContract;
  private readonly coordinator: BrowserOperationCoordinator;
  private readonly reconciler: AccountProfileReconciler;
  private readonly clock: () => Date;
  private readonly setTimer: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  private readonly clearTimer: (timer: NodeJS.Timeout) => void;
  private readonly invalidateConsole: (sessionId: string) => void;
  private readonly releaseGateOpen: () => boolean;
  private readonly live = new Map<string, LiveSession>();

  public constructor(options: ManagerOptions) {
    this.repository = options.repository;
    this.profiles = options.profiles;
    this.supervisor = options.supervisor;
    this.coordinator = options.coordinator ?? new BrowserOperationCoordinator();
    this.reconciler = new AccountProfileReconciler(options.repository, options.profiles);
    this.clock = options.clock ?? (() => new Date());
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.invalidateConsole = options.invalidateConsole ?? (() => undefined);
    this.releaseGateOpen = options.releaseGateOpen ?? (() => true);
  }

  public async start(input: StartAccountOnboardingInput): Promise<StartManagedOnboardingResult> {
    if (!this.releaseGateOpen()) return { outcome: 'RELEASE_GATE_CLOSED' };
    const result = this.repository.start({ ...input, now: input.now ?? this.clock() });
    if (result.outcome !== 'CREATED' && result.outcome !== 'REPLAY') return result;
    if (result.session.status === 'COMPLETING') {
      this.reconciler.reconcileCompleting(result.session, this.clock());
    } else if (
      ['PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED'].includes(result.session.status) &&
      !this.supervisor.owns(result.session.id)
    ) {
      await this.launch(result.session);
    }
    const latest = this.repository.findByIdForAdmin(
      result.session.id,
      result.session.createdByAdminUserId,
    );
    return { ...result, summary: this.summary(latest ?? result.session) };
  }

  public getForAdmin(
    sessionId: string,
    adminUserId: string,
  ): AccountLoginSessionSummary | undefined {
    const session = this.repository.findByIdForAdmin(sessionId, adminUserId);
    return session === undefined ? undefined : this.summary(session);
  }

  public getActiveForAdmin(adminUserId: string): AccountLoginSessionSummary | null {
    const session = this.repository.findActiveForAdmin(adminUserId);
    return session === undefined ? null : this.summary(session);
  }

  public async cancel(
    sessionId: string,
    adminUserId: string,
    expectedUpdatedAt: Date,
  ): Promise<ReturnType<AccountOnboardingRepository['cancel']>> {
    const result = this.repository.cancel(sessionId, adminUserId, expectedUpdatedAt, this.clock());
    if (result.outcome === 'CANCELLED' || result.outcome === 'EXPIRED') {
      await this.teardown(result.session, true);
    }
    return result;
  }

  public async recover(): Promise<void> {
    for (const terminal of this.repository.findTerminalStagingCleanupCandidates()) {
      this.cleanupOwnedStaging(terminal);
    }
    const active = this.repository.findActiveGlobal();
    if (active === undefined) return;
    if (!this.releaseGateOpen()) {
      throw new Error('Cannot recover an active login flow while browser release gates are open.');
    }
    if (active.status === 'COMPLETING') {
      this.reconciler.reconcileCompleting(active, this.clock());
      return;
    }
    if (
      ['PENDING', 'STARTING', 'AWAITING_USER'].includes(active.status) &&
      this.clock().getTime() >= active.expiresAt.getTime()
    ) {
      const expired = this.repository.expire(active.id, this.clock());
      if (expired.outcome === 'EXPIRED') this.cleanupOwnedStaging(expired.session);
      return;
    }
    await this.launch(active);
  }

  /** Stops runtime processes but deliberately leaves durable active state for startup recovery. */
  public async stop(): Promise<void> {
    await this.supervisor.stopAll();
    for (const sessionId of this.live.keys()) this.invalidateConsole(sessionId);
    for (const state of this.live.values()) {
      if (state.timer !== undefined) this.clearTimer(state.timer);
      state.lease.release();
    }
    this.live.clear();
  }

  public summary(session: AccountOnboardingSession): AccountLoginSessionSummary {
    const interactive = ['PENDING', 'STARTING', 'AWAITING_USER'].includes(session.status);
    const completedAccountId =
      session.status === 'COMPLETED' ? (session.accountId ?? session.pendingAccountId) : null;
    return {
      id: session.id,
      purpose: session.purpose,
      accountId: session.accountId,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
      startedAt: session.startedAt?.toISOString() ?? null,
      readyDetectedAt: session.readyDetectedAt?.toISOString() ?? null,
      completedAt: session.completedAt?.toISOString() ?? null,
      updatedAt: session.updatedAt.toISOString(),
      consoleAvailable:
        (session.status === 'STARTING' || session.status === 'AWAITING_USER') &&
        this.clock().getTime() < session.expiresAt.getTime() &&
        this.ownsRuntimeLease(session.id) &&
        this.supervisor.owns(session.id) &&
        this.supervisor.getConsoleEndpoint(session.id) !== undefined,
      cancellable: interactive && this.clock().getTime() < session.expiresAt.getTime(),
      failureCode: session.failureCode,
      resultAccountId: completedAccountId,
    };
  }

  public ownsRuntimeLease(sessionId: string): boolean {
    return this.live.has(sessionId) && this.coordinator.isHeldBy(sessionId);
  }

  private async launch(session: AccountOnboardingSession): Promise<void> {
    if (this.live.has(session.id)) return;
    const snapshot = this.repository.getRecoverySnapshot(session.id);
    const accountId = session.accountId ?? session.pendingAccountId;
    if (snapshot === undefined || accountId === null) {
      this.repository.markFailed(session.id, 'INTEGRITY_ERROR', this.clock());
      return;
    }
    const lease = this.coordinator.acquire(session.id, accountId);
    if (lease === undefined) {
      this.repository.markFailed(session.id, 'PROFILE_LEASE_CONFLICT', this.clock());
      return;
    }

    try {
      const profile = this.resolveProfile(
        session,
        snapshot.account?.profileState ?? null,
        accountId,
      );
      let current = session;
      if (session.status === 'PENDING') {
        const transition = this.repository.markStarting(session.id, this.clock());
        if (transition.outcome !== 'UPDATED') {
          if (transition.outcome === 'EXPIRED') this.cleanupOwnedStaging(transition.session);
          lease.release();
          return;
        }
        current = transition.session;
      }
      const live: LiveSession = { lease, timer: undefined, completing: false };
      if (['PENDING', 'STARTING', 'AWAITING_USER'].includes(current.status)) {
        const delayMs = Math.max(0, current.expiresAt.getTime() - this.clock().getTime());
        live.timer = this.setTimer(() => void this.expire(current.id), delayMs);
        live.timer.unref?.();
      }
      this.live.set(current.id, live);
      await this.supervisor.start(
        {
          type: 'START',
          runtimeMode: current.status === 'READY_DETECTED' ? 'COMPLETION_RECOVERY' : 'INTERACTIVE',
          sessionId: current.id,
          purpose: current.purpose,
          accountId,
          profilePath: profile.path,
          profileKind: profile.kind,
          expiresAt: current.expiresAt.toISOString(),
        },
        (event) => this.handleWorkerEvent(event),
      );
    } catch {
      const active = this.live.get(session.id);
      if (active?.timer !== undefined) this.clearTimer(active.timer);
      this.live.delete(session.id);
      lease.release();
      const failed = this.repository.markFailed(session.id, 'PROFILE_PREPARE_FAILED', this.clock());
      if (failed !== undefined) this.cleanupOwnedStaging(failed);
    }
  }

  private resolveProfile(
    session: AccountOnboardingSession,
    profileState: string | null,
    accountId: string,
  ): { readonly path: string; readonly kind: 'ACCOUNT' | 'STAGING' } {
    if (session.purpose === 'RELOGIN' && profileState === 'READY') {
      return { path: this.profiles.requireFinal(accountId), kind: 'ACCOUNT' };
    }
    const state = this.profiles.inspectReconciliation(session.id, accountId);
    if (state.staging === 'OWNED') {
      return { path: this.profiles.stagingPath(session.id), kind: 'STAGING' };
    }
    if (state.staging !== 'ABSENT') throw new Error('Staging profile integrity failure.');
    if (session.status === 'READY_DETECTED') {
      throw new Error('READY recovery requires the original owned staging profile.');
    }
    return { path: this.profiles.prepareStaging(session.id, accountId), kind: 'STAGING' };
  }

  private async handleWorkerEvent(event: AccountLoginWorkerEvent): Promise<void> {
    const state = this.live.get(event.sessionId);
    if (state === undefined) return;
    if (event.type === 'AWAITING_USER') {
      const session = this.repository.getRecoverySnapshot(event.sessionId)?.session;
      if (session?.status === 'STARTING') {
        const transition = this.repository.markAwaitingUser(event.sessionId, this.clock());
        if (transition.outcome === 'EXPIRED') await this.teardown(transition.session, true);
      }
      return;
    }
    if (event.type === 'INTERACTIVE_EXPIRED') {
      await this.expire(event.sessionId);
      return;
    }
    if (event.type === 'READY_DETECTED') {
      const result = this.repository.markReadyDetected(event.sessionId, this.clock());
      if (result.outcome === 'READY') {
        this.invalidateConsole(event.sessionId);
      } else if (result.outcome === 'EXPIRED') {
        await this.teardown(result.session, true);
      }
      return;
    }
    if (event.type === 'IDENTITY_EXTRACTED') {
      state.completing = true;
      await this.complete(event.sessionId, event.identity);
      return;
    }
    if (event.type === 'WORKER_FAILED') {
      this.invalidateConsole(event.sessionId);
      this.repository.markFailed(event.sessionId, event.failureCode, this.clock());
      await this.teardownById(event.sessionId, true);
      return;
    }
    if (event.type === 'WORKER_EXITED' && !state.completing) {
      this.invalidateConsole(event.sessionId);
      this.repository.markFailed(event.sessionId, 'PROCESS_EXITED', this.clock());
      await this.teardownById(event.sessionId, true);
    }
  }

  private async complete(sessionId: string, identity: DouyinAccountIdentity): Promise<void> {
    const snapshot = this.repository.getRecoverySnapshot(sessionId);
    if (snapshot === undefined) return;
    await this.supervisor.stop(sessionId);
    const accountId = snapshot.session.accountId ?? snapshot.session.pendingAccountId;
    try {
      if (snapshot.session.purpose === 'RELOGIN' && snapshot.account?.profileState === 'READY') {
        const result = this.repository.completeReloginInPlace(sessionId, identity, this.clock());
        if (result.outcome === 'IDENTITY_CONFLICT') {
          this.repository.markFailed(sessionId, 'PROFILE_IDENTITY_CONFLICT', this.clock());
        } else if (result.outcome !== 'COMPLETED') {
          this.repository.markFailed(sessionId, 'FINALIZE_FAILED', this.clock());
        }
      } else {
        const beginning =
          snapshot.session.purpose === 'ADD_ACCOUNT'
            ? this.repository.beginAddCompletion(sessionId, identity, this.clock())
            : this.repository.beginReloginReplacement(sessionId, identity, this.clock());
        if (beginning.outcome === 'IDENTITY_CONFLICT') {
          if (accountId !== null)
            this.profiles.quarantineStaging(sessionId, accountId, this.clock());
          this.repository.markFailed(sessionId, 'PROFILE_IDENTITY_CONFLICT', this.clock());
        } else if (beginning.outcome === 'COMPLETING' && accountId !== null) {
          this.profiles.finalizeStaging(sessionId, accountId);
          const finished =
            snapshot.session.purpose === 'ADD_ACCOUNT'
              ? this.repository.finishAddCompletion(sessionId, this.clock())
              : this.repository.finishReloginReplacement(sessionId, this.clock());
          if (finished.outcome !== 'COMPLETED') {
            this.repository.failCompleting(sessionId, 'MISSING', 'FINALIZE_FAILED', this.clock());
          }
        } else {
          this.repository.markFailed(sessionId, 'FINALIZE_FAILED', this.clock());
        }
      }
    } catch {
      const current = this.repository.getRecoverySnapshot(sessionId)?.session;
      if (current?.status === 'COMPLETING') {
        this.reconciler.reconcileCompleting(current, this.clock());
      } else {
        this.repository.markFailed(sessionId, 'FINALIZE_FAILED', this.clock());
      }
    } finally {
      await this.teardownById(sessionId, false);
    }
  }

  private async expire(sessionId: string): Promise<void> {
    const result = this.repository.expire(sessionId, this.clock());
    if (result.outcome === 'EXPIRED') await this.teardown(result.session, true);
  }

  private async teardown(
    session: AccountOnboardingSession,
    cleanupStaging: boolean,
  ): Promise<void> {
    await this.teardownById(session.id, cleanupStaging);
  }

  private async teardownById(sessionId: string, cleanupStaging: boolean): Promise<void> {
    const state = this.live.get(sessionId);
    this.invalidateConsole(sessionId);
    if (state?.timer !== undefined) this.clearTimer(state.timer);
    await this.supervisor.stop(sessionId);
    if (cleanupStaging) {
      const session = this.repository.getRecoverySnapshot(sessionId)?.session;
      if (session !== undefined) this.cleanupOwnedStaging(session);
    }
    state?.lease.release();
    this.live.delete(sessionId);
  }

  private cleanupOwnedStaging(session: AccountOnboardingSession): void {
    const accountId = session.accountId ?? session.pendingAccountId;
    if (accountId === null) return;
    const profile = this.profiles.inspectReconciliation(session.id, accountId);
    if (profile.staging !== 'OWNED') return;
    if (!this.profiles.removeEmptyStaging(session.id, accountId)) {
      this.profiles.quarantineStaging(session.id, accountId, this.clock());
    }
  }
}

export type AccountLoginWorkerSupervisorContract = Pick<
  AccountLoginWorkerSupervisor,
  'start' | 'stop' | 'stopAll' | 'owns' | 'getConsoleEndpoint'
>;
