import { performance } from 'node:perf_hooks';
import type { DeliveryVerificationReason, TargetResolutionFailure } from '@sparkkeeper/shared';
import type { ResolutionWitnessBinding } from '../resolver/ResolutionWitness.js';

export class DeliveryGuardError extends Error {
  constructor(readonly reason: DeliveryVerificationReason) {
    super(reason);
  }
}
export function stopDelivery(reason: DeliveryVerificationReason): never {
  throw new DeliveryGuardError(reason);
}
export type DeliveryEvidence = 'PENDING' | 'VERIFIED' | 'AMBIGUOUS';
/** Narrow trusted adapter; no arbitrary page action callback, composer preparation or retry. */
export interface DeliveryObservationPort {
  readonly page: object;
  readonly context: object;
  arm(binding: ResolutionWitnessBinding, knownText: string, budget: DeliveryBudget): Promise<void>;
  ready(budget: DeliveryBudget): Promise<void>;
  beginBoundary(budget: DeliveryBudget): Promise<void>;
  invokeOnce(budget: DeliveryBudget): Promise<void>;
  observe(budget: DeliveryBudget): Promise<DeliveryEvidence>;
  reconcile(budget: DeliveryBudget): Promise<DeliveryEvidence>;
  dispose(): Promise<void>;
}
/** Future trusted caller must resolve only after durable boundary/CAS commit. No Page/text input. */
export interface DeliveryActionBoundary {
  record(): Promise<void>;
}
export interface DeliveryTargetGuard {
  check(): Promise<TargetResolutionFailure | null>;
}
export interface DeliveryVerifierOptions {
  readonly deadline?: number;
  readonly verificationTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}
export class DeliveryBudget {
  private wall: number;
  private monotonic: number;
  private cancelled = false;
  constructor(deadline = Date.now() + 60_000) {
    const remaining = Math.min(60_000, deadline - Date.now());
    this.wall = Date.now() + remaining;
    this.monotonic = performance.now() + remaining;
  }
  beginVerification(timeout: number): void {
    this.wall = Math.min(this.wall, Date.now() + timeout);
    this.monotonic = Math.min(this.monotonic, performance.now() + timeout);
    this.assertActive();
  }
  remaining(): number {
    return Math.min(this.wall - Date.now(), this.monotonic - performance.now());
  }
  assertActive(): void {
    if (this.cancelled || !Number.isFinite(this.remaining()) || this.remaining() <= 0)
      stopDelivery('DELIVERY_TIMEOUT');
  }
  cancel(): void {
    this.cancelled = true;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.assertActive();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            this.cancel();
            reject(new DeliveryGuardError('DELIVERY_TIMEOUT'));
          },
          Math.max(1, Math.ceil(this.remaining())),
        );
      });
      const value = await Promise.race([Promise.resolve().then(fn), timeout]);
      this.assertActive();
      return value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
