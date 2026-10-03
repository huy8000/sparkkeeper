import type {
  ResolverAccountBinding,
  ResolverRequest,
  TargetResolutionFailure,
} from '@sparkkeeper/shared';
import { StableTargetResolver } from '../src/douyin/resolver/StableTargetResolver.js';
import type {
  ResolverBudget,
  ResolverCandidate,
  ResolverDirectoryPort,
  ResolverDirectoryWindow,
  ResolverPageState,
  ResolverRuntimeOwner,
} from '../src/douyin/resolver/types.js';

export function request(extra: Partial<ResolverRequest> = {}): ResolverRequest {
  return {
    accountId: 'synthetic-account',
    contactId: 'synthetic-contact',
    contactType: 'PERSON',
    preferredIdentity: {
      id: 'synthetic-identity',
      kind: 'SEC_UID',
      normalizedValue: 'Fixture-001',
      observedAt: 1000,
    },
    expectedMetadataVersion: 'synthetic-private-version',
    ...extra,
  };
}
export function row(
  anchor = 'synthetic-chat-1',
  value = 'Fixture-001',
  type: ResolverCandidate['type'] = 'PERSON',
): ResolverCandidate {
  return {
    anchor,
    type,
    identities:
      type === 'GROUP' ? { CONVERSATION_ID: anchor } : { SEC_UID: value, CONVERSATION_ID: anchor },
  };
}
export function window(
  candidates: readonly ResolverCandidate[],
  extra: Partial<ResolverDirectoryWindow> = {},
): ResolverDirectoryWindow {
  return {
    candidates,
    epoch: 'fixture-epoch',
    coverage: 'VERSIONED',
    beginning: true,
    end: true,
    empty: candidates.length === 0,
    contiguous: true,
    loading: false,
    ...extra,
  };
}
export class FixtureDirectory implements ResolverDirectoryPort {
  state: ResolverPageState = {
    page: {},
    context: {},
    navigation: {},
    selectionRevision: 0,
    directoryEpoch: 'fixture-epoch',
  };
  index = 0;
  opens = 0;
  reads = 0;
  resets = 0;
  ownerChecks = 0;
  owned = true;
  certified = true;
  authFailure: TargetResolutionFailure | null = null;
  current = row();
  afterRead: (() => void) | undefined;
  beforeOpen: (() => void) | undefined;
  constructor(public views: ResolverDirectoryWindow[] = [window([row()])]) {}
  readonly owner: ResolverRuntimeOwner = {
    accountId: 'synthetic-account',
    generation: {},
    assertOwned: async () => {
      this.ownerChecks++;
      if (!this.owned) throw new Error('synthetic ownership loss');
    },
  };
  readonly binding: ResolverAccountBinding = {
    accountId: 'synthetic-account',
    kind: 'SEC_UID',
    normalizedValue: 'synthetic-self',
  };
  async pageState(budget: ResolverBudget) {
    budget.assertActive();
    return {
      ...this.state,
      directoryEpoch: this.certified
        ? (this.views[this.index]?.epoch ?? null)
        : 'uncertified-epoch',
    };
  }
  async auth(binding: ResolverAccountBinding, budget: ResolverBudget) {
    budget.assertActive();
    void binding;
    return this.authFailure;
  }
  async reset(budget: ResolverBudget) {
    budget.assertActive();
    this.index = 0;
    this.resets++;
  }
  async readWindow(budget: ResolverBudget) {
    budget.assertActive();
    this.reads++;
    const view = this.views[this.index]!;
    this.afterRead?.();
    return view;
  }
  async advance(budget: ResolverBudget) {
    budget.assertActive();
    if (this.index + 1 >= this.views.length) return false;
    this.index++;
    return true;
  }
  async certifyCoverage(epoch: string, budget: ResolverBudget) {
    budget.assertActive();
    return this.certified && this.views[this.index]?.epoch === epoch;
  }
  async openCandidate(candidate: ResolverCandidate, epoch: string, budget: ResolverBudget) {
    budget.assertActive();
    if (this.views[this.index]?.epoch !== epoch) throw new Error('fixture epoch changed');
    this.beforeOpen?.();
    this.opens++;
    this.current = candidate;
    this.state = { ...this.state, selectionRevision: this.state.selectionRevision + 1 };
  }
  async currentConversation(budget: ResolverBudget) {
    budget.assertActive();
    return this.current;
  }
  resolver() {
    return new StableTargetResolver(this, this.owner, this.binding);
  }
}
