import { randomUUID } from 'node:crypto';
import { MessageEngine } from '@sparkkeeper/message-engine';
import { ScheduledSendRepository, TaskError, TestSendError } from '@sparkkeeper/database';
import { taskWindow, type TaskConfiguration } from '@sparkkeeper/shared';
import { DeliveryBudget, type DeliveryVerifierOptions } from '@sparkkeeper/automation';
import type { TestSendRuntimeFactory } from '../test-send/TestSendManager.js';
import { PerTargetSendCoordinator } from '../test-send/PerTargetSendCoordinator.js';
import type { TargetResolutionService } from '../automation/TargetResolutionService.js';
import type { BrowserOperationCoordinator } from '../onboarding/BrowserOperationCoordinator.js';
import type { AccountProfileStore } from '../onboarding/AccountProfileStore.js';

export class SendTaskScheduler {
  private recovered = false;
  private blocked = false;
  private stopping = false;
  private recovery: Promise<void> | undefined;
  private pending: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly token = randomUUID();
  private readonly core: PerTargetSendCoordinator;
  constructor(
    readonly repository: ScheduledSendRepository,
    private readonly options: {
      coordinator: BrowserOperationCoordinator;
      profiles: AccountProfileStore;
      targets: TargetResolutionService;
      isolated: () => boolean;
      runtime?: TestSendRuntimeFactory;
      master?: () => boolean;
      released?: () => boolean;
      clock?: (() => Date) | undefined;
      limits?: DeliveryVerifierOptions;
    },
  ) {
    this.core = new PerTargetSendCoordinator(repository, options.targets);
  }
  private now() {
    return this.options.clock?.() ?? new Date();
  }
  released() {
    return (
      !!this.options.runtime &&
      this.options.runtime.kind === 'CONTROLLED_LOCAL' &&
      this.options.released?.() === true &&
      this.options.isolated() &&
      !this.blocked &&
      !this.stopping
    );
  }
  masterOpen() {
    return this.options.master?.() === true;
  }
  private open() {
    return this.recovered && this.released() && this.masterOpen();
  }
  enable(id: string, expected: string, actor: string) {
    if (!this.recovered || !this.released()) throw new TaskError('RELEASE_GATE_CLOSED');
    this.options.profiles.requireFinal(this.repository.tasks.row(id).accountId);
    return this.repository.tasks.mutate(id, expected, actor, 'enable', undefined, true, this.now());
  }
  create(input: TaskConfiguration, actor: string) {
    return this.repository.tasks.create(input, actor, this.now());
  }
  recover(): Promise<void> {
    return (this.recovery ??= this.doRecover());
  }
  private async doRecover() {
    const pending = new Map(this.repository.unfinished().map((e) => [e.runId, e.accountId]));
    try {
      for (const id of this.options.runtime?.inventory() ?? [])
        pending.set(id, this.repository.run(id).run.accountId);
      for (const [id, account] of pending) {
        const lease = this.options.coordinator.acquire(id, account);
        if (!lease) throw new TaskError('PROFILE_BUSY');
        // Never release on unproven cleanup or uncertain persistence.
        if (!this.options.runtime || !this.options.isolated())
          throw new Error('RECOVERY_UNAVAILABLE');
        await new DeliveryBudget(Date.now() + 5000).run(() =>
          this.options.runtime!.recover(id, account),
        );
        this.repository.reconcile(id, this.now());
        this.repository.recoveredRun(id);
        lease.release();
      }
      this.recovered = true;
    } catch (error) {
      this.blocked = true;
      throw error;
    }
  }
  start(): 'DISABLED' | 'BLOCKED' | 'STARTED' {
    if (!this.masterOpen()) return 'DISABLED';
    if (!this.open()) return 'BLOCKED';
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.tick().catch(() => {
          this.blocked = true;
        });
      }, 1000);
      this.timer.unref();
    }
    return 'STARTED';
  }
  tick(): Promise<void> {
    if (this.pending) return this.pending;
    const pending = this.dispatch();
    this.pending = pending;
    void pending.then(
      () => {
        this.pending = undefined;
      },
      () => {
        this.pending = undefined;
        this.blocked = true;
      },
    );
    return pending;
  }
  private async dispatch() {
    if (!this.open()) return;
    const active = this.repository.unfinished()[0];
    if (active) {
      await this.execute(active.runId, active.accountId);
      return;
    }
    // Bounded reads, not a hard total-task cap: completed/blocked Tasks in an
    // earlier page must not permanently starve later enabled Tasks.
    for (let offset = 0; this.open(); offset += 100) {
      const tasks = this.repository.tasks.list({ enabled: true, limit: 100, offset }, true);
      for (const task of tasks) {
        if (!this.open()) return;
        const window = taskWindow(this.now(), task.schedule);
        if (!window.open || task.state !== 'ENABLED') continue;
        const canonical = this.repository.canonical(task.id, window.businessDate);
        if (canonical) {
          if (['PENDING', 'RUNNING'].includes(canonical.status))
            await this.execute(canonical.id, task.accountId);
          continue;
        }
        const lease = this.options.coordinator.acquire(randomUUID(), task.accountId);
        if (!lease) return;
        let transferred = false;
        try {
          this.options.profiles.requireFinal(task.accountId);
          const prepared = this.repository.prepare(task.id);
          const engine = new MessageEngine();
          const snapshots = this.repository.tasks.eligibility(task.id);
          const messages = await Promise.all(snapshots.map((s) => engine.build(s.template)));
          if (!this.open()) return;
          const run = this.repository.publish(task.id, prepared, messages, this.now());
          if (!['PENDING', 'RUNNING'].includes(run.status)) continue;
          transferred = true;
          await this.execute(run.id, task.accountId, lease);
          return;
        } catch (error) {
          if (error instanceof TaskError || error instanceof TestSendError) continue;
          transferred = true;
          this.blocked = true;
          throw error;
        } finally {
          if (!transferred) lease.release();
        }
      }
      if (tasks.length < 100) return;
    }
  }
  private async execute(
    runId: string,
    accountId: string,
    supplied?: ReturnType<BrowserOperationCoordinator['acquire']>,
  ) {
    const lease = supplied ?? this.options.coordinator.acquire(runId, accountId);
    if (!lease) return;
    if (!this.repository.acquireRun(runId, this.token)) {
      lease.release();
      return;
    }
    let safe = true;
    const factory = this.options.runtime!;
    try {
      this.repository.expireOrDisabled(runId, this.now());
      for (const record of this.repository.run(runId).records) {
        if (!this.open()) {
          this.repository.abort(runId, this.now());
          break;
        }
        const current = this.repository.execution(record.id).record;
        if (
          !['READY', 'RETRY_WAIT'].includes(current.machineStatus) ||
          (current.nextRetryAt && current.nextRetryAt > this.now())
        )
          continue;
        this.repository.expireOrDisabled(runId, this.now());
        if (
          !['READY', 'RETRY_WAIT'].includes(
            this.repository.execution(record.id).record.machineStatus,
          )
        )
          continue;
        const owned = async () => {
          if (!this.open() || !this.options.coordinator.isLeaseCurrent(lease))
            throw new Error('OWNERSHIP_LOST');
          this.options.profiles.requireFinal(accountId);
        };
        try {
          await owned();
          const runtime = await new DeliveryBudget(Date.now() + 5000).run(() =>
            factory.open({
              runId,
              accountId,
              lease,
              coordinator: this.options.coordinator,
              profiles: this.options.profiles,
            }),
          );
          await this.core.execute(
            record.id,
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
          this.repository.finish(record.id, 'FAILED', 'BROWSER_FAILURE', this.now());
        } finally {
          await new DeliveryBudget(Date.now() + 5000).run(() => factory.close(runId));
        }
      }
    } catch (error) {
      safe = false;
      this.blocked = true;
      throw error;
    } finally {
      if (safe) {
        this.repository.releaseRun(runId, this.token);
        lease.release();
      }
    }
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.pending;
  }
}
