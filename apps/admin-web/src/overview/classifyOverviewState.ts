import type { Account, DailyRun } from '../types/api';

export type OverviewState =
  'SUCCESS' | 'RUNNING' | 'FAILED' | 'AUTH_EXPIRED' | 'DELIVERY_UNKNOWN' | 'EMPTY';

export type OverviewAttentionKind = 'AUTH_EXPIRED' | 'DELIVERY_UNKNOWN' | 'FAILED';

export interface OverviewAttentionItem {
  readonly kind: OverviewAttentionKind;
  readonly accountId: string;
  readonly runId?: string;
  readonly detailUnavailable?: boolean;
}

export interface OverviewCounts {
  readonly accounts: number;
  readonly success: number;
  readonly failed: number;
  readonly pending: number;
}

export interface OverviewClassification {
  readonly state: OverviewState;
  readonly counts: OverviewCounts;
  readonly attentionItems: readonly OverviewAttentionItem[];
}

export interface OverviewClassificationInput {
  readonly accounts: readonly Account[];
  readonly runs: readonly DailyRun[];
  readonly deliveryUnknownRunIds?: ReadonlySet<string>;
  readonly detailUnavailableRunIds?: ReadonlySet<string>;
}

const MAX_ATTENTION_ITEMS = 3;

/**
 * Deterministic Overview business-state aggregation. DailyRun and SendRecord
 * semantics stay separate: delivery uncertainty is supplied only after the
 * caller has observed a real DELIVERY_UNKNOWN SendRecord for a FAILED run.
 */
export function classifyOverviewState(input: OverviewClassificationInput): OverviewClassification {
  const deliveryUnknownRunIds = input.deliveryUnknownRunIds ?? new Set<string>();
  const detailUnavailableRunIds = input.detailUnavailableRunIds ?? new Set<string>();
  const authExpiredAccountIds = new Set(
    input.accounts
      .filter((account) => account.enabled && account.loginStatus === 'AUTH_EXPIRED')
      .map((account) => account.id),
  );

  const authAttention: OverviewAttentionItem[] = [...authExpiredAccountIds].map((accountId) => ({
    kind: 'AUTH_EXPIRED',
    accountId,
  }));
  for (const run of input.runs) {
    if (run.status !== 'AUTH_EXPIRED' || authExpiredAccountIds.has(run.accountId)) continue;
    authExpiredAccountIds.add(run.accountId);
    authAttention.push({ kind: 'AUTH_EXPIRED', accountId: run.accountId, runId: run.id });
  }

  const uncertainRuns = input.runs.filter(
    (run) => run.status === 'FAILED' && deliveryUnknownRunIds.has(run.id),
  );
  const deliveryAttention: OverviewAttentionItem[] = uncertainRuns.map((run) => ({
    kind: 'DELIVERY_UNKNOWN',
    accountId: run.accountId,
    runId: run.id,
  }));
  const failedAttention: OverviewAttentionItem[] = input.runs
    .filter((run) => run.status === 'FAILED' && !deliveryUnknownRunIds.has(run.id))
    .map((run) => ({
      kind: 'FAILED' as const,
      accountId: run.accountId,
      runId: run.id,
      ...(detailUnavailableRunIds.has(run.id) ? { detailUnavailable: true } : {}),
    }));

  const hasAuthExpired = authAttention.length > 0;
  const hasDeliveryUnknown = deliveryAttention.length > 0;
  const hasFailed = failedAttention.length > 0;
  const hasRunning = input.runs.some((run) => run.status === 'RUNNING' || run.status === 'READY');
  const hasSuccess = input.runs.some((run) => run.status === 'SUCCESS');

  const state: OverviewState = hasAuthExpired
    ? 'AUTH_EXPIRED'
    : hasDeliveryUnknown
      ? 'DELIVERY_UNKNOWN'
      : hasFailed
        ? 'FAILED'
        : hasRunning
          ? 'RUNNING'
          : hasSuccess
            ? 'SUCCESS'
            : 'EMPTY';

  return {
    state,
    counts: {
      accounts: input.accounts.length,
      success: input.runs.filter((run) => run.status === 'SUCCESS').length,
      failed: input.runs.filter((run) => run.status === 'FAILED' || run.status === 'AUTH_EXPIRED')
        .length,
      pending: input.runs.filter((run) => run.status === 'READY' || run.status === 'RUNNING')
        .length,
    },
    attentionItems: [...authAttention, ...deliveryAttention, ...failedAttention].slice(
      0,
      MAX_ATTENTION_ITEMS,
    ),
  };
}
