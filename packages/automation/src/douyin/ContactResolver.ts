import type {
  ContactResolveResult,
  ConversationCandidate,
  ConversationListScrollResult,
  TargetContactIdentity,
} from './types.js';

const DEFAULT_MAX_SCROLL_ATTEMPTS = 20;
const DEFAULT_MAX_DURATION_MS = 30_000;
const DEFAULT_NO_PROGRESS_LIMIT = 2;

export interface ContactConversationSource {
  resetConversationList(): Promise<void>;
  getConversationCandidates(): Promise<ConversationCandidate[]>;
  scrollConversationList(): Promise<ConversationListScrollResult>;
}

export interface ContactResolverOptions {
  readonly maxScrollAttempts?: number;
  readonly maxDurationMs?: number;
  readonly noProgressLimit?: number;
  readonly now?: () => number;
}

export class ContactResolver {
  private readonly maxScrollAttempts: number;
  private readonly maxDurationMs: number;
  private readonly noProgressLimit: number;
  private readonly now: () => number;

  public constructor(
    private readonly source: ContactConversationSource,
    options: ContactResolverOptions = {},
  ) {
    this.maxScrollAttempts = validatePositiveInteger(
      options.maxScrollAttempts ?? DEFAULT_MAX_SCROLL_ATTEMPTS,
      'Maximum scroll attempts',
    );
    this.maxDurationMs = validatePositiveInteger(
      options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
      'Maximum resolve duration',
    );
    this.noProgressLimit = validatePositiveInteger(
      options.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT,
      'No-progress limit',
    );
    this.now = options.now ?? Date.now;
  }

  public async resolve(target: TargetContactIdentity): Promise<ContactResolveResult> {
    const normalizedTarget = normalizeDisplayName(target.displayName);
    if (normalizedTarget === '') {
      throw new Error('Target display name must be non-empty after normalization.');
    }

    await this.source.resetConversationList();

    const startedAt = this.now();
    const observedCandidates = new Map<number, ConversationCandidate>();
    let scrollAttempts = 0;
    let consecutiveNoProgress = 0;

    while (true) {
      const observedBeforeBatch = observedCandidates.size;
      const batch = await this.source.getConversationCandidates();
      for (const candidate of batch) {
        if (!observedCandidates.has(candidate.listIndex)) {
          observedCandidates.set(candidate.listIndex, candidate);
        }
      }

      const matches = [...observedCandidates.values()].filter(
        (candidate) => normalizeDisplayName(candidate.displayName) === normalizedTarget,
      );

      if (matches.length > 1) {
        return {
          type: 'AMBIGUOUS',
          matchCount: matches.length,
          scrollAttempts,
        };
      }

      const match = matches[0];
      if (match !== undefined) {
        return {
          type: 'FOUND',
          contact: {
            identity: { displayName: target.displayName },
            listIndex: match.listIndex,
          },
          matchCount: 1,
          scrollAttempts,
        };
      }

      if (
        scrollAttempts >= this.maxScrollAttempts ||
        this.now() - startedAt >= this.maxDurationMs ||
        consecutiveNoProgress >= this.noProgressLimit
      ) {
        return { type: 'NOT_FOUND', matchCount: 0, scrollAttempts };
      }

      const scroll = await this.source.scrollConversationList();
      scrollAttempts += 1;
      if (scroll.atEnd && !scroll.moved) {
        return { type: 'NOT_FOUND', matchCount: 0, scrollAttempts };
      }

      const addedCandidates = observedCandidates.size - observedBeforeBatch;
      consecutiveNoProgress =
        !scroll.moved || addedCandidates === 0 ? consecutiveNoProgress + 1 : 0;
    }
  }
}

export function normalizeDisplayName(displayName: string): string {
  return displayName.trim();
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}
