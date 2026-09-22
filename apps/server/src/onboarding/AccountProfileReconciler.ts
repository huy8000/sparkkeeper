import type {
  AccountOnboardingRepository,
  AccountOnboardingSession,
  FinishCompletionResult,
} from '@sparkkeeper/database';

import { AccountProfileStore } from './AccountProfileStore.js';

export type AccountProfileReconciliationResult =
  | { readonly outcome: 'COMPLETED'; readonly result: FinishCompletionResult }
  | { readonly outcome: 'FAILED_MISSING' | 'FAILED_INTEGRITY' };

export class AccountProfileReconciler {
  constructor(
    private readonly repository: AccountOnboardingRepository,
    private readonly profiles: AccountProfileStore,
  ) {}

  reconcileCompleting(
    session: AccountOnboardingSession,
    now = new Date(),
  ): AccountProfileReconciliationResult {
    if (session.status !== 'COMPLETING') {
      throw new Error('Profile reconciliation requires a COMPLETING LoginSession.');
    }
    const accountId = session.accountId ?? session.pendingAccountId;
    if (!accountId) {
      this.repository.markFailed(session.id, 'INTEGRITY_ERROR', now);
      return { outcome: 'FAILED_INTEGRITY' };
    }

    const state = this.profiles.inspectReconciliation(session.id, accountId);
    if (state.staging === 'OWNED' && state.final === 'ABSENT') {
      this.profiles.finalizeStaging(session.id, accountId);
      return this.finish(session, now);
    }
    if (state.staging === 'ABSENT' && state.final === 'OWNED') {
      return this.finish(session, now);
    }
    if (state.staging === 'ABSENT' && state.final === 'ABSENT') {
      this.repository.failCompleting(session.id, 'MISSING', 'FINALIZE_FAILED', now);
      return { outcome: 'FAILED_MISSING' };
    }

    let quarantined = false;
    if (state.staging === 'OWNED') {
      quarantined = this.profiles.quarantineStaging(session.id, accountId, now) !== undefined;
    }
    if (state.final === 'OWNED') {
      quarantined = this.profiles.quarantineFinal(accountId, now) !== undefined || quarantined;
    }
    this.repository.failCompleting(
      session.id,
      quarantined ? 'QUARANTINED' : 'MISSING',
      'INTEGRITY_ERROR',
      now,
    );
    return { outcome: 'FAILED_INTEGRITY' };
  }

  private finish(session: AccountOnboardingSession, now: Date): AccountProfileReconciliationResult {
    const result =
      session.purpose === 'ADD_ACCOUNT'
        ? this.repository.finishAddCompletion(session.id, now)
        : this.repository.finishReloginReplacement(session.id, now);
    if (result.outcome !== 'COMPLETED') {
      this.repository.failCompleting(session.id, 'MISSING', 'INTEGRITY_ERROR', now);
      return { outcome: 'FAILED_INTEGRITY' };
    }
    return { outcome: 'COMPLETED', result };
  }
}
