import { randomUUID, createHash } from 'node:crypto';
import { MessageEngine } from '@sparkkeeper/message-engine';
import { TestSendError, type TestSendRepository } from '@sparkkeeper/database';
import type { TestSendAccepted } from '@sparkkeeper/shared';
import {
  DeliveryBudget,
  type DeliveryObservationPort,
  type DeliveryVerifierOptions,
} from '@sparkkeeper/automation';
import type {
  BrowserOperationCoordinator,
  BrowserOperationLease,
} from '../onboarding/BrowserOperationCoordinator.js';
import type { AccountProfileStore } from '../onboarding/AccountProfileStore.js';
import type {
  ExistingTargetResolverRuntime,
  TargetResolutionService,
} from '../automation/TargetResolutionService.js';
import { PerTargetSendCoordinator } from './PerTargetSendCoordinator.js';

/** Internal trusted ownership port; never exposed via environment/HTTP paths or callbacks. */
export interface TestSendRuntimeFactory {
  readonly kind: 'CONTROLLED_LOCAL';
  /** Include terminal runs with leftover ownership; unknown IDs fail closed. */
  inventory(): readonly string[];
  open(options: {
    runId: string;
    accountId: string;
    lease: BrowserOperationLease;
    coordinator: BrowserOperationCoordinator;
    profiles: AccountProfileStore;
  }): Promise<{
    runtime: ExistingTargetResolverRuntime;
    observation: DeliveryObservationPort;
    assertOwned(): Promise<void>;
  }>;
  /** Resolve only after all browser/worker resources are proven stopped, including late launch. */
  close(runId: string): Promise<void>;
  recover(runId: string, accountId: string): Promise<void>;
}
export class TestSendManagerError extends Error {
  constructor(readonly code: 'RELEASE_GATE_CLOSED' | 'RUNTIME_UNAVAILABLE' | 'PROFILE_BUSY') {
    super(code);
  }
}
export class TestSendManager {
  private recovered = false;
  private stopping = false;
  private blocked = false;
  private readonly live = new Set<Promise<void>>();
  private readonly confirmations = new Map<
    string,
    { binding: string; pending: Promise<TestSendAccepted> }
  >();
  private readonly core: PerTargetSendCoordinator;
  constructor(
    readonly repository: TestSendRepository,
    private readonly options: {
      coordinator: BrowserOperationCoordinator;
      profiles: AccountProfileStore;
      targets: TargetResolutionService;
      isolated: () => boolean;
      runtime?: TestSendRuntimeFactory | undefined;
      limits?: DeliveryVerifierOptions;
      clock?: (() => Date) | undefined;
    },
  ) {
    this.core = new PerTargetSendCoordinator(repository, options.targets);
  }
  private now() {
    return this.options.clock?.() ?? new Date();
  }
  preview(accountId: string, contactId: string, templateId: string, adminId: string, key: string) {
    return this.repository.preview(accountId, contactId, templateId, adminId, key, this.now());
  }
  async recover(): Promise<void> {
    if (this.recovered) return;
    if (this.blocked || this.stopping) throw new TestSendManagerError('RUNTIME_UNAVAILABLE');
    const pending = new Map(this.repository.unfinished().map((e) => [e.runId, e]));
    for (const id of this.options.runtime?.inventory() ?? []) {
      const e = this.repository.execution(id);
      pending.set(id, { runId: id, accountId: e.run.accountId });
    }
    for (const e of pending.values()) {
      const lease = this.options.coordinator.acquire(e.runId, e.accountId);
      if (!lease) throw new TestSendManagerError('PROFILE_BUSY');
      try {
        if (!this.options.runtime || !this.options.isolated())
          throw new TestSendManagerError('RUNTIME_UNAVAILABLE');
        await new DeliveryBudget(Date.now() + 5000).run(() =>
          this.options.runtime!.recover(e.runId, e.accountId),
        );
        this.repository.finish(e.runId, 'FAILED', 'PROCESS_INTERRUPTED_AFTER_ACTION', this.now());
        lease.release();
      } catch (error) {
        this.blocked = true;
        throw error;
      }
    }
    this.recovered = true;
  }
  async confirm(accountId: string, adminId: string, intentId: string, digest: string, key: string) {
    const replay = this.repository.replay(accountId, adminId, intentId, digest, key);
    if (replay) return replay;
    const hash = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const scope = hash([adminId, key]),
      binding = hash([accountId, intentId, digest]);
    const existing = this.confirmations.get(scope);
    if (existing) {
      if (existing.binding !== binding) throw new TestSendError('IDEMPOTENCY_CONFLICT');
      return existing.pending;
    }
    const pending = this.beginConfirm(accountId, adminId, intentId, digest, key);
    this.confirmations.set(scope, { binding, pending });
    try {
      return await pending;
    } finally {
      this.confirmations.delete(scope);
    }
  }
  private async beginConfirm(
    accountId: string,
    adminId: string,
    intentId: string,
    digest: string,
    key: string,
  ) {
    if (!this.recovered || this.blocked || this.stopping)
      throw new TestSendManagerError('RUNTIME_UNAVAILABLE');
    const factory = this.options.runtime;
    if (!factory || factory.kind !== 'CONTROLLED_LOCAL' || !this.options.isolated())
      throw new TestSendManagerError('RELEASE_GATE_CLOSED');
    const lease = this.options.coordinator.acquire(randomUUID(), accountId);
    if (!lease) throw new TestSendManagerError('PROFILE_BUSY');
    let transferred = false;
    try {
      this.options.profiles.requireFinal(accountId);
      const template = this.repository.confirmationTemplate(
        accountId,
        adminId,
        intentId,
        digest,
        this.now(),
      );
      const message = await new MessageEngine().build(template);
      if (this.stopping || !this.options.isolated())
        throw new TestSendManagerError('RELEASE_GATE_CLOSED');
      const admitted = this.repository.consume(
        accountId,
        adminId,
        intentId,
        digest,
        key,
        message,
        this.now(),
      );
      if (admitted.replay) return { runId: admitted.runId, status: admitted.status };
      transferred = true;
      const completion = Promise.resolve().then(async () => {
        try {
          const owned = async () => {
            if (
              this.stopping ||
              !this.options.isolated() ||
              !this.options.coordinator.isLeaseCurrent(lease)
            )
              throw new Error('OWNERSHIP_LOST');
            this.options.profiles.requireFinal(accountId);
          };
          await owned();
          const runtime = await new DeliveryBudget(Date.now() + 5000).run(() =>
            factory.open({
              runId: admitted.runId,
              accountId,
              lease,
              coordinator: this.options.coordinator,
              profiles: this.options.profiles,
            }),
          );
          await this.core.execute(
            admitted.runId,
            runtime.runtime,
            runtime.observation,
            async () => {
              await owned();
              await runtime.assertOwned();
              await owned();
            },
            this.options.limits,
          );
        } catch {
          this.repository.finish(admitted.runId, 'FAILED', 'BROWSER_FAILURE', this.now());
        }
        // An uncertain open/late resource acquisition must be reconciled by close before release.
        await new DeliveryBudget(Date.now() + 5000).run(() => factory.close(admitted.runId));
        lease.release();
      });
      this.live.add(completion);
      void completion.then(
        () => this.live.delete(completion),
        () => {
          this.blocked = true;
          this.live.delete(completion);
        },
      );
      return { runId: admitted.runId, status: admitted.status };
    } finally {
      if (!transferred) lease.release();
    }
  }
  async stop() {
    this.stopping = true;
    await Promise.all([...this.live]);
  }
  async idle() {
    await Promise.all([...this.live]);
  }
}
