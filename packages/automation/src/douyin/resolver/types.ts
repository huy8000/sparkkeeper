import {
  targetResolutionFailure,
  type ContactType,
  type ResolverAccountBinding,
  type ResolverIdentityKind,
  type TargetResolutionFailure,
  type TargetResolutionReason,
} from '@sparkkeeper/shared';
import { performance } from 'node:perf_hooks';

export interface ResolverCandidate {
  readonly anchor: string | null;
  readonly type: ContactType;
  readonly identities: Readonly<Partial<Record<ResolverIdentityKind, string>>>;
  readonly conflict?: boolean;
}
export interface ResolverDirectoryWindow {
  readonly candidates: readonly ResolverCandidate[];
  readonly epoch: string;
  readonly coverage: 'STATIC' | 'VERSIONED' | 'UNPROVEN';
  readonly beginning: boolean;
  readonly end: boolean;
  readonly empty: boolean;
  readonly contiguous: boolean;
  readonly loading: boolean;
}
export interface ResolverPageState {
  readonly page: object;
  readonly context: object;
  readonly navigation: object;
  readonly selectionRevision: number;
  readonly directoryEpoch: string | null;
}
/** Supplied by an existing trusted runtime owner, never by HTTP or a hasLease boolean. */
export interface ResolverRuntimeOwner {
  readonly accountId: string;
  readonly generation: object;
  assertOwned(): Promise<void>;
}
export interface ResolverDirectoryPort {
  pageState(budget: ResolverBudget): Promise<ResolverPageState>;
  auth(
    binding: ResolverAccountBinding,
    budget: ResolverBudget,
  ): Promise<TargetResolutionFailure | null>;
  reset(budget: ResolverBudget): Promise<void>;
  readWindow(budget: ResolverBudget): Promise<ResolverDirectoryWindow>;
  advance(budget: ResolverBudget): Promise<boolean>;
  certifyCoverage(epoch: string, budget: ResolverBudget): Promise<boolean>;
  openCandidate(candidate: ResolverCandidate, epoch: string, budget: ResolverBudget): Promise<void>;
  currentConversation(budget: ResolverBudget): Promise<ResolverCandidate>;
}

export class ResolverGuardError extends Error {
  constructor(readonly failure: TargetResolutionFailure) {
    super(failure.reason);
    this.name = 'ResolverGuardError';
  }
}
export function stopResolution(reason: TargetResolutionReason): never {
  throw new ResolverGuardError(targetResolutionFailure(reason));
}

/** One budget for auth, scans, reacquisition and verification; abort never releases ownership. */
export class ResolverBudget {
  readonly deadline: number;
  private readonly started = performance.now();
  private cancelled = false;
  private opening = false;
  private observations = 0;
  private windows = 0;
  constructor(callerDeadline: number) {
    this.deadline = Math.min(callerDeadline, Date.now() + 60_000);
  }
  remainingMs(): number {
    return Math.min(this.deadline - Date.now(), 60_000 - (performance.now() - this.started));
  }
  assertActive(): void {
    if (this.cancelled || !Number.isFinite(this.deadline) || this.remainingMs() <= 0)
      stopResolution(this.opening ? 'RESOLUTION_TIMEOUT' : 'RESOLUTION_LIMIT_REACHED');
  }
  cancel(): void {
    this.cancelled = true;
  }
  markOpening(): void {
    this.assertActive();
    this.opening = true;
  }
  observe(count: number, window = false): void {
    this.assertActive();
    if (!Number.isSafeInteger(count) || count < 0) stopResolution('DIRECTORY_INCOMPLETE');
    this.observations += count;
    if (window) this.windows++;
    if (this.observations > 500 || this.windows > 50) stopResolution('RESOLUTION_LIMIT_REACHED');
  }
  async run<T>(action: () => Promise<T>): Promise<T> {
    this.assertActive();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          this.cancelled = true;
          reject(
            new ResolverGuardError(
              targetResolutionFailure(
                this.opening ? 'RESOLUTION_TIMEOUT' : 'RESOLUTION_LIMIT_REACHED',
              ),
            ),
          );
        },
        Math.max(1, Math.ceil(this.remainingMs())),
      );
    });
    try {
      const value = await Promise.race([Promise.resolve().then(action), timeout]);
      this.assertActive();
      return value;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
