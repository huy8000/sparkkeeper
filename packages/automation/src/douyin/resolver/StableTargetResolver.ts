import {
  freezeResolverRequest,
  normalizeResolverIdentifier,
  sameResolverRequest,
  supportedResolverKind,
  targetResolutionFailure,
  type ResolverAccountBinding,
  type ResolverRequest,
  type TargetResolutionFailure,
} from '@sparkkeeper/shared';
import {
  checkResolutionWitness,
  invalidateResolutionWitness,
  issueResolutionWitness,
  type ResolutionWitness,
} from './ResolutionWitness.js';
import {
  ResolverBudget,
  ResolverGuardError,
  stopResolution,
  type ResolverCandidate,
  type ResolverDirectoryPort,
  type ResolverDirectoryWindow,
  type ResolverPageState,
  type ResolverRuntimeOwner,
} from './types.js';

declare const candidateBrand: unique symbol;
export interface CandidateWitness {
  readonly [candidateBrand]: true;
}
export type StableResolveResult =
  { readonly status: 'FOUND'; readonly candidate: CandidateWitness } | TargetResolutionFailure;
export type TargetResolutionResult =
  { readonly status: 'VERIFIED'; readonly witness: ResolutionWitness } | TargetResolutionFailure;
interface Invocation {
  request: ResolverRequest;
  budget: ResolverBudget;
  state: ResolverPageState;
  token: object;
  epoch: string;
  candidate: ResolverCandidate;
  generation: object;
}
const pageOwners = new WeakMap<object, { token: object; active: boolean }>();

export class StableTargetResolver {
  private readonly brand = {};
  private readonly candidates = new WeakMap<CandidateWitness, Invocation>();
  constructor(
    private readonly port: ResolverDirectoryPort,
    private readonly owner: ResolverRuntimeOwner,
    private readonly binding: ResolverAccountBinding,
  ) {}

  async resolve(input: ResolverRequest, callerDeadline: number): Promise<StableResolveResult> {
    const request = freezeResolverRequest(input);
    if (request.contactType !== 'PERSON' && request.contactType !== 'GROUP')
      return targetResolutionFailure('UNSUPPORTED_TARGET_TYPE');
    if (
      !supportedResolverKind(request.contactType, request.preferredIdentity.kind) ||
      normalizeResolverIdentifier(request.preferredIdentity.normalizedValue) !==
        request.preferredIdentity.normalizedValue
    )
      return targetResolutionFailure('TARGET_IDENTITY_UNAVAILABLE');
    if (request.accountId !== this.owner.accountId || request.accountId !== this.binding.accountId)
      return targetResolutionFailure('RUNTIME_OWNERSHIP_LOST');
    const budget = new ResolverBudget(callerDeadline);
    let invocation: Invocation | undefined;
    try {
      await this.assertOwner(budget);
      const state = await budget.run(() => this.port.pageState(budget));
      if (pageOwners.get(state.page)?.active) stopResolution('RUNTIME_OWNERSHIP_LOST');
      const token = {};
      pageOwners.set(state.page, { token, active: true });
      invocation = {
        request,
        budget,
        state,
        token,
        epoch: '',
        candidate: { anchor: null, type: 'UNKNOWN', identities: {} },
        generation: this.owner.generation,
      };
      await this.guard(invocation);
      await budget.run(() => this.port.reset(budget));
      const matches = new Map<string, ResolverCandidate>();
      const seen = new Map<string, ResolverCandidate>();
      for (let index = 0; ; index++) {
        await this.guard(invocation);
        const view = await this.window(invocation, index === 0);
        for (const candidate of view.candidates) {
          this.validateCandidate(candidate, request);
          // A stable anchor cannot change type, even when one observation is a non-target row.
          if (candidate.anchor) {
            const old = seen.get(candidate.anchor);
            if (old && !sameCandidate(old, candidate)) stopResolution('IDENTITY_CHANGED');
            seen.set(candidate.anchor, immutableCandidate(candidate));
          }
          if (candidate.type !== request.contactType) continue;
          const key = candidate.anchor!;
          if (
            candidate.identities[
              request.preferredIdentity.kind as keyof typeof candidate.identities
            ] === request.preferredIdentity.normalizedValue
          )
            matches.set(key, immutableCandidate(candidate));
          if (matches.size > 1) stopResolution('TARGET_AMBIGUOUS');
        }
        if (view.end || view.empty) {
          await this.guard(invocation);
          if (!(await budget.run(() => this.port.certifyCoverage(invocation!.epoch, budget))))
            stopResolution('DIRECTORY_INCOMPLETE');
          if (!matches.size) {
            this.finish(invocation, true);
            return targetResolutionFailure('TARGET_NOT_FOUND');
          }
          invocation.candidate = immutableCandidate([...matches.values()][0]!);
          const witness = Object.freeze(Object.create(null)) as CandidateWitness;
          this.candidates.set(witness, invocation);
          return Object.freeze({ status: 'FOUND', candidate: witness });
        }
        if (!(await budget.run(() => this.port.advance(budget))))
          stopResolution('DIRECTORY_INCOMPLETE');
      }
    } catch (error) {
      if (invocation) this.finish(invocation, true);
      return this.failure(error);
    }
  }

  discard(candidate: CandidateWitness): void {
    const invocation = this.candidates.get(candidate);
    if (invocation) this.finish(invocation, true);
    this.candidates.delete(candidate);
  }

  async openAndVerify(
    candidate: CandidateWitness,
    request: ResolverRequest,
  ): Promise<TargetResolutionResult> {
    const invocation = this.candidates.get(candidate);
    this.candidates.delete(candidate); // A navigation attempt cannot be replayed.
    if (!invocation) return targetResolutionFailure('RUNTIME_OWNERSHIP_LOST');
    const { budget } = invocation;
    try {
      if (!sameResolverRequest(request, invocation.request))
        stopResolution('METADATA_VERSION_CHANGED');
      await this.guard(invocation);
      if (!(await budget.run(() => this.port.certifyCoverage(invocation.epoch, budget))))
        stopResolution('DIRECTORY_CHANGED');
      await budget.run(() => this.port.reset(budget));
      let reacquired = false;
      for (let index = 0; !reacquired; index++) {
        await this.guard(invocation);
        const view = await this.window(invocation, index === 0);
        const controls = view.candidates.filter(
          (row) => row.anchor === invocation.candidate.anchor,
        );
        if (controls.length > 1) stopResolution('DIRECTORY_INCOMPLETE');
        if (controls.length === 1) {
          if (!sameCandidate(controls[0]!, invocation.candidate))
            stopResolution('IDENTITY_CHANGED');
          reacquired = true;
        } else if (view.end || view.empty || !(await budget.run(() => this.port.advance(budget))))
          stopResolution('TARGET_DISAPPEARED');
      }
      await this.guard(invocation);
      if (!(await budget.run(() => this.port.certifyCoverage(invocation.epoch, budget))))
        stopResolution('DIRECTORY_CHANGED');
      budget.markOpening();
      await budget.run(() =>
        this.port.openCandidate(invocation.candidate, invocation.epoch, budget),
      );
      await this.guard(invocation);
      if (!(await budget.run(() => this.port.certifyCoverage(invocation.epoch, budget))))
        stopResolution('DIRECTORY_CHANGED');
      const beforeCurrent = await budget.run(() => this.port.pageState(budget));
      const current = await budget.run(() => this.port.currentConversation(budget));
      this.verifyCurrent(invocation, current);
      const selectedState = await budget.run(() => this.port.pageState(budget));
      if (
        selectedState.selectionRevision !== beforeCurrent.selectionRevision ||
        selectedState.navigation !== beforeCurrent.navigation ||
        selectedState.page !== beforeCurrent.page ||
        selectedState.context !== beforeCurrent.context
      )
        stopResolution('IDENTITY_CHANGED');
      if (selectedState.directoryEpoch !== invocation.epoch) stopResolution('DIRECTORY_CHANGED');
      const frozenRequest = invocation.request;
      const witness = issueResolutionWitness(
        this.brand,
        async () => {
          try {
            await this.guard(invocation);
            const state = await budget.run(() => this.port.pageState(budget));
            if (state.selectionRevision !== selectedState.selectionRevision)
              stopResolution('IDENTITY_CHANGED');
            if (!(await budget.run(() => this.port.certifyCoverage(invocation.epoch, budget))))
              stopResolution('DIRECTORY_CHANGED');
            this.verifyCurrent(
              invocation,
              await budget.run(() => this.port.currentConversation(budget)),
            );
            await this.assertOwner(budget);
            const after = await budget.run(() => this.port.pageState(budget));
            if (
              after.selectionRevision !== selectedState.selectionRevision ||
              after.navigation !== selectedState.navigation ||
              after.page !== selectedState.page ||
              after.context !== selectedState.context
            )
              stopResolution('IDENTITY_CHANGED');
            if (after.directoryEpoch !== invocation.epoch) stopResolution('DIRECTORY_CHANGED');
            if (
              this.owner.generation !== invocation.generation ||
              pageOwners.get(invocation.state.page)?.token !== invocation.token
            )
              stopResolution('RUNTIME_OWNERSHIP_LOST');
            return null;
          } catch (error) {
            return this.failure(error);
          }
        },
        Object.freeze({
          page: selectedState.page,
          context: selectedState.context,
          request: frozenRequest,
          candidate: invocation.candidate,
          self: Object.freeze({ ...this.binding }),
        }),
      );
      // The owner token remains as the current observation epoch; new resolution invalidates it.
      this.finish(invocation, false);
      if (!sameResolverRequest(frozenRequest, request)) {
        invalidateResolutionWitness(witness);
        stopResolution('METADATA_VERSION_CHANGED');
      }
      return Object.freeze({ status: 'VERIFIED', witness });
    } catch (error) {
      this.finish(invocation, true);
      return this.failure(error);
    }
  }

  async revalidate(witness: ResolutionWitness): Promise<TargetResolutionFailure | null> {
    return checkResolutionWitness(this.brand, witness);
  }
  invalidate(witness: ResolutionWitness): void {
    invalidateResolutionWitness(witness);
  }

  private async assertOwner(budget: ResolverBudget): Promise<void> {
    try {
      await budget.run(() => this.owner.assertOwned());
    } catch (error) {
      if (error instanceof ResolverGuardError) throw error;
      stopResolution('RUNTIME_OWNERSHIP_LOST');
    }
  }
  private async guard(invocation: Invocation): Promise<void> {
    await this.assertOwner(invocation.budget);
    if (
      this.owner.generation !== invocation.generation ||
      pageOwners.get(invocation.state.page)?.token !== invocation.token
    )
      stopResolution('RUNTIME_OWNERSHIP_LOST');
    const state = await invocation.budget.run(() => this.port.pageState(invocation.budget));
    if (
      state.page !== invocation.state.page ||
      state.context !== invocation.state.context ||
      state.navigation !== invocation.state.navigation
    )
      stopResolution('PAGE_CLOSED');
    if (invocation.epoch && state.directoryEpoch !== invocation.epoch)
      stopResolution('DIRECTORY_CHANGED');
    const auth = await invocation.budget.run(() => this.port.auth(this.binding, invocation.budget));
    if (auth) throw new ResolverGuardError(auth);
  }
  private async window(invocation: Invocation, first: boolean): Promise<ResolverDirectoryWindow> {
    const view = await invocation.budget.run(() => this.port.readWindow(invocation.budget));
    invocation.budget.observe(view.candidates.length, true);
    if (
      (view.coverage !== 'STATIC' && view.coverage !== 'VERSIONED') ||
      !normalizeResolverIdentifier(view.epoch) ||
      view.loading !== false ||
      view.contiguous !== true ||
      typeof view.end !== 'boolean' ||
      typeof view.empty !== 'boolean' ||
      (first && view.beginning !== true) ||
      (view.empty && view.candidates.length)
    )
      stopResolution('DIRECTORY_INCOMPLETE');
    if (invocation.epoch && invocation.epoch !== view.epoch) stopResolution('DIRECTORY_CHANGED');
    invocation.epoch = view.epoch;
    return view;
  }
  private validateCandidate(candidate: ResolverCandidate, request: ResolverRequest): void {
    if (candidate.conflict) stopResolution('IDENTITY_CHANGED');
    if (
      !['PERSON', 'GROUP', 'SYSTEM', 'UNKNOWN'].includes(candidate.type) ||
      candidate.type === 'UNKNOWN'
    )
      stopResolution('DIRECTORY_INCOMPLETE');
    if (candidate.type !== request.contactType) return;
    if (!candidate.anchor || normalizeResolverIdentifier(candidate.anchor) !== candidate.anchor)
      stopResolution('CANDIDATE_ANCHOR_UNAVAILABLE');
    for (const value of Object.values(candidate.identities))
      if (normalizeResolverIdentifier(value) !== value)
        stopResolution('TARGET_IDENTITY_UNAVAILABLE');
    const preferred =
      candidate.identities[request.preferredIdentity.kind as keyof typeof candidate.identities];
    if (!preferred) stopResolution('TARGET_IDENTITY_UNAVAILABLE');
    if (
      candidate.identities.CONVERSATION_ID &&
      candidate.identities.CONVERSATION_ID !== candidate.anchor
    )
      stopResolution('IDENTITY_CHANGED');
  }
  private verifyCurrent(invocation: Invocation, current: ResolverCandidate): void {
    this.validateCandidate(current, invocation.request);
    if (
      current.type !== invocation.request.contactType ||
      current.anchor !== invocation.candidate.anchor
    )
      stopResolution('IDENTITY_CHANGED');
    if (
      current.identities[
        invocation.request.preferredIdentity.kind as keyof typeof current.identities
      ] !== invocation.request.preferredIdentity.normalizedValue
    )
      stopResolution('IDENTITY_CHANGED');
  }
  private finish(invocation: Invocation, cancel: boolean): void {
    if (cancel) invocation.budget.cancel();
    const entry = pageOwners.get(invocation.state.page);
    if (entry?.token === invocation.token) entry.active = false;
  }
  private failure(error: unknown): TargetResolutionFailure {
    // NOT_FOUND is issued only by the certified empty-match branch, never by a port/exception.
    return error instanceof ResolverGuardError &&
      error.failure.status !== 'NOT_FOUND' &&
      error.failure.reason !== 'TARGET_NOT_FOUND'
      ? error.failure
      : targetResolutionFailure('BROWSER_FAILURE');
  }
}
function immutableCandidate(candidate: ResolverCandidate): ResolverCandidate {
  return Object.freeze({ ...candidate, identities: Object.freeze({ ...candidate.identities }) });
}
function sameCandidate(a: ResolverCandidate, b: ResolverCandidate): boolean {
  return (
    a.anchor === b.anchor &&
    a.type === b.type &&
    (['SEC_UID', 'UNIQUE_ID', 'SHORT_ID', 'CONVERSATION_ID'] as const).every(
      (kind) => a.identities[kind] === b.identities[kind],
    ) &&
    !a.conflict &&
    !b.conflict
  );
}
