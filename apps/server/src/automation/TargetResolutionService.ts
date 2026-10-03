import { inspect } from 'node:util';
import { performance } from 'node:perf_hooks';
import {
  StableTargetResolver,
  type ResolutionWitness,
  type ResolverDirectoryPort,
  type ResolverRuntimeOwner,
  type TargetResolutionResult,
} from '@sparkkeeper/automation';
import {
  sameResolverRequest,
  targetResolutionFailure,
  type TargetResolutionFailure,
} from '@sparkkeeper/shared';
import type { TargetResolverSnapshot, TargetResolverSnapshotSource } from '@sparkkeeper/database';
import type { AccountProfileStore } from '../onboarding/AccountProfileStore.js';
import type {
  BrowserOperationCoordinator,
  BrowserOperationLease,
} from '../onboarding/BrowserOperationCoordinator.js';

declare const preparedBrand: unique symbol;
declare const runtimeBrand: unique symbol;
export interface PreparedResolverRequest {
  readonly [preparedBrand]: true;
}
export interface ExistingTargetResolverRuntime {
  readonly [runtimeBrand]: true;
}
export interface RecoveredResolverProcessOwner {
  readonly accountId: string;
  readonly operationId: string;
  readonly generation: object;
  /** Trusted supervisor must await recovery and prove its current owned process groups. */
  assertRecoveredOwnership(): Promise<void>;
}
type ReadySnapshot = Extract<TargetResolverSnapshot, { status: 'READY' }>;
const runtimes = new WeakMap<
  ExistingTargetResolverRuntime,
  { port: ResolverDirectoryPort; owner: ResolverRuntimeOwner }
>();
function opaque<T>(label: string): T {
  return Object.freeze(
    Object.create(null, {
      toJSON: { value: () => undefined },
      [inspect.custom]: { value: () => `[${label}]` },
    }),
  ) as T;
}

/** Internal only. No launch/admission/release and no caller-provided profile path. */
export function bindExistingTargetResolverRuntime(options: {
  readonly accountId: string;
  readonly coordinator: BrowserOperationCoordinator;
  readonly lease: BrowserOperationLease;
  readonly profiles: AccountProfileStore;
  readonly supervision: RecoveredResolverProcessOwner;
  readonly directory: ResolverDirectoryPort;
}): ExistingTargetResolverRuntime {
  const { accountId, coordinator, lease, profiles, supervision, directory } = options;
  const generation = supervision.generation;
  const owner: ResolverRuntimeOwner = Object.freeze({
    accountId,
    generation,
    async assertOwned() {
      if (
        !coordinator.isLeaseCurrent(lease) ||
        lease.profileKey !== accountId ||
        supervision.accountId !== accountId ||
        supervision.operationId !== lease.operationId ||
        supervision.generation !== generation
      )
        throw new Error('RUNTIME_OWNERSHIP_LOST');
      profiles.requireFinal(accountId);
      await supervision.assertRecoveredOwnership();
      if (!coordinator.isLeaseCurrent(lease) || supervision.generation !== generation)
        throw new Error('RUNTIME_OWNERSHIP_LOST');
      profiles.requireFinal(accountId);
    },
  });
  const runtime = opaque<ExistingTargetResolverRuntime>('ExistingTargetResolverRuntime');
  runtimes.set(runtime, { port: directory, owner });
  return runtime;
}

/** Not wired into ApiApplication, discovery, legacy automation or any browser trigger. */
export class TargetResolutionService {
  private readonly prepared = new WeakMap<PreparedResolverRequest, ReadySnapshot>();
  private readonly verified = new WeakMap<
    ResolutionWitness,
    {
      snapshot: ReadySnapshot;
      runtime: ExistingTargetResolverRuntime;
      resolver: StableTargetResolver;
      deadline: number;
      monotonicDeadline: number;
    }
  >();
  constructor(private readonly snapshots: TargetResolverSnapshotSource) {}
  prepare(
    accountId: string,
    contactId: string,
  ):
    | { readonly status: 'PREPARED'; readonly request: PreparedResolverRequest }
    | TargetResolutionFailure {
    const snapshot = this.load(accountId, contactId);
    if (snapshot.status !== 'READY') return snapshot;
    const request = opaque<PreparedResolverRequest>('PreparedResolverRequest');
    this.prepared.set(request, snapshot);
    return Object.freeze({ status: 'PREPARED', request });
  }
  async resolveCurrentChat(
    prepared: PreparedResolverRequest,
    runtime: ExistingTargetResolverRuntime,
    deadline = Date.now() + 60_000,
  ): Promise<TargetResolutionResult> {
    const overallDeadline = Math.min(deadline, Date.now() + 60_000);
    const monotonicDeadline = performance.now() + Math.max(0, overallDeadline - Date.now());
    const snapshot = this.prepared.get(prepared);
    this.prepared.delete(prepared); // Single invocation, not a long-lived request token.
    const owned = runtimes.get(runtime);
    if (!snapshot || !owned || owned.owner.accountId !== snapshot.request.accountId)
      return targetResolutionFailure('RUNTIME_OWNERSHIP_LOST');
    const preflight = this.check(snapshot);
    if (preflight) return preflight;
    const resolver = new StableTargetResolver(owned.port, owned.owner, snapshot.accountBinding);
    const resolved = await resolver.resolve(snapshot.request, overallDeadline);
    if (resolved.status !== 'FOUND') return resolved;
    const beforeOpen = this.check(snapshot);
    if (beforeOpen) {
      resolver.discard(resolved.candidate);
      return beforeOpen;
    }
    const result = await resolver.openAndVerify(resolved.candidate, snapshot.request);
    if (result.status !== 'VERIFIED') return result;
    const final = this.check(snapshot);
    if (final) {
      resolver.invalidate(result.witness);
      return final;
    }
    const live = await resolver.revalidate(result.witness);
    if (live) return live;
    const last = this.check(snapshot);
    if (last || Date.now() >= overallDeadline || performance.now() >= monotonicDeadline) {
      resolver.invalidate(result.witness);
      return last ?? targetResolutionFailure('RESOLUTION_TIMEOUT');
    }
    this.verified.set(result.witness, {
      snapshot,
      runtime,
      resolver,
      deadline: overallDeadline,
      monotonicDeadline,
    });
    return result;
  }
  async revalidateCurrentChat(
    witness: ResolutionWitness,
    runtime: ExistingTargetResolverRuntime,
  ): Promise<TargetResolutionFailure | null> {
    const entry = this.verified.get(witness);
    if (!entry || entry.runtime !== runtime)
      return targetResolutionFailure('RUNTIME_OWNERSHIP_LOST');
    const failure =
      this.check(entry.snapshot) ??
      (await entry.resolver.revalidate(witness)) ??
      this.check(entry.snapshot) ??
      (Date.now() >= entry.deadline || performance.now() >= entry.monotonicDeadline
        ? targetResolutionFailure('RESOLUTION_TIMEOUT')
        : null);
    if (failure) {
      entry.resolver.invalidate(witness);
      this.verified.delete(witness);
    }
    return failure;
  }
  private check(snapshot: ReadySnapshot): TargetResolutionFailure | null {
    const current = this.load(snapshot.request.accountId, snapshot.request.contactId);
    if (current.status !== 'READY') return current;
    return sameResolverRequest(current.request, snapshot.request)
      ? null
      : targetResolutionFailure('METADATA_VERSION_CHANGED');
  }
  private load(accountId: string, contactId: string): TargetResolverSnapshot {
    try {
      const snapshot = this.snapshots.load(accountId, contactId);
      return snapshot.status === 'NOT_FOUND'
        ? targetResolutionFailure('PERSISTENCE_FAILURE')
        : snapshot;
    } catch {
      return targetResolutionFailure('PERSISTENCE_FAILURE');
    }
  }
}
