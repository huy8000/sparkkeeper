import {
  ContactDiscoveryError,
  type ContactDiscoveryRepository,
  type DiscoveryPublication,
} from '@sparkkeeper/database';
import type {
  BrowserOperationCoordinator,
  BrowserOperationLease,
} from '../onboarding/BrowserOperationCoordinator.js';
import type { AccountProfileStore } from '../onboarding/AccountProfileStore.js';
import type { DiscoverySupervisor } from './ContactDiscoveryWorkerSupervisor.js';
import type { AvatarCacheStore } from './AvatarCacheStore.js';
export class DiscoveryManagerError extends Error {
  constructor(readonly code: 'RELEASE_GATE_CLOSED' | 'RUNTIME_UNAVAILABLE' | 'PROFILE_BUSY') {
    super(code);
  }
}
export class ContactDiscoveryManager {
  private recovered = false;
  private stopping = false;
  private blocked = false;
  private readonly live = new Map<
    string,
    { lease: BrowserOperationLease; completion: Promise<void> }
  >();
  constructor(
    readonly repository: ContactDiscoveryRepository,
    private readonly options: {
      coordinator: BrowserOperationCoordinator;
      profiles: AccountProfileStore;
      supervisor: DiscoverySupervisor;
      runtimeRoot: string;
      releaseGateOpen: () => boolean;
      avatars: AvatarCacheStore;
      clock?: () => Date;
    },
  ) {}
  async recover(): Promise<void> {
    this.recovered = false;
    const ids = new Set([
      ...this.options.supervisor.inventory(),
      ...this.repository.findActive().map((r) => r.id),
    ]);
    if (ids.size && (!this.options.releaseGateOpen() || this.repository.executionBusy()))
      throw new DiscoveryManagerError('RELEASE_GATE_CLOSED');
    for (const id of ids) {
      const run = this.repository.find(id);
      if (!run) throw new Error('Unassociated discovery runtime ownership.');
      const lease = this.options.coordinator.acquire(id, run.accountId);
      if (!lease) throw new DiscoveryManagerError('PROFILE_BUSY');
      try {
        await this.options.supervisor.recover(id);
        this.repository.interrupt(id, this.now());
        lease.release();
      } catch (e) {
        this.blocked = true;
        throw e;
      }
    }
    this.options.avatars.cleanup(this.now());
    this.recovered = true;
  }
  start(accountId: string, adminId: string, key: string) {
    if (!this.recovered || this.stopping || this.blocked)
      throw new DiscoveryManagerError('RUNTIME_UNAVAILABLE');
    const replay = this.repository.replay(accountId, adminId, key);
    if (replay) return replay;
    if (!this.options.releaseGateOpen() || this.repository.executionBusy())
      throw new DiscoveryManagerError('RELEASE_GATE_CLOSED');
    // Read replay through the aggregate even when the supported runtime is unavailable.
    if (!this.options.supervisor.runtimeAvailable)
      throw new DiscoveryManagerError('RUNTIME_UNAVAILABLE');
    const result = this.repository.start(accountId, adminId, key, this.now());
    if (result.replay) return result.run;
    const lease = this.options.coordinator.acquire(result.run.id, accountId);
    if (!lease) {
      this.repository.publish(
        result.run.id,
        {
          status: 'FAILED',
          failureCode: 'PROFILE_BUSY',
          observations: [],
          issueCount: 0,
          authChecked: false,
        },
        this.now(),
      );
      throw new DiscoveryManagerError('PROFILE_BUSY');
    }
    const completion = Promise.resolve().then(() => this.run(result.run.id, accountId, lease));
    this.live.set(result.run.id, { lease, completion });
    void completion.catch(() => {
      this.blocked = true;
    });
    return result.run;
  }
  private async run(id: string, accountId: string, lease: BrowserOperationLease) {
    let publication: DiscoveryPublication = {
      status: 'FAILED',
      failureCode: 'PROFILE_UNAVAILABLE',
      observations: [],
      issueCount: 0,
      authChecked: false,
    };
    try {
      const account = this.repository.account(accountId);
      if (!account) throw new ContactDiscoveryError('ACCOUNT_NOT_FOUND');
      const profilePath = this.options.profiles.requireFinal(accountId);
      if (!this.repository.running(id, this.now())) throw new Error('Discovery state conflict.');
      publication = {
        status: 'FAILED',
        failureCode: 'BROWSER_FAILURE',
        observations: [],
        issueCount: 0,
        authChecked: false,
      };
      publication = await this.options.supervisor.start({
        type: 'START',
        runId: id,
        accountId,
        profilePath,
        runtimeRoot: this.options.runtimeRoot,
        deadline: Date.now() + 90000,
        expected: { secUid: account.douyinSecUid, uniqueId: account.douyinUniqueId },
      });
    } catch {
      /* Safe phase-specific default; no raw browser/profile errors escape. */
    }
    try {
      await this.options.supervisor.stop(id);
      if (this.stopping)
        publication = {
          status: 'FAILED',
          failureCode: 'PROCESS_INTERRUPTED',
          observations: [],
          issueCount: 0,
          authChecked: false,
        };
      if (!this.options.releaseGateOpen())
        publication = {
          status: 'FAILED',
          failureCode: 'BROWSER_FAILURE',
          observations: [],
          issueCount: 0,
          authChecked: false,
        };
      try {
        this.repository.publish(id, publication, this.now());
      } catch {
        this.repository.publish(
          id,
          {
            status: 'FAILED',
            failureCode: 'PERSISTENCE_FAILURE',
            observations: [],
            issueCount: 0,
            authChecked: false,
          },
          this.now(),
        );
      }
      lease.release();
      this.live.delete(id);
      this.options.avatars.cleanup(this.now(), this.live.size > 0);
    } catch (e) {
      this.blocked = true;
      throw e;
    }
  }
  async stop() {
    this.stopping = true;
    await this.options.supervisor.stopAll();
    await Promise.all([...this.live.values()].map((r) => r.completion));
  }
  owns(id: string) {
    return this.options.coordinator.isHeldBy(id);
  }
  private now() {
    return this.options.clock?.() ?? new Date();
  }
}
