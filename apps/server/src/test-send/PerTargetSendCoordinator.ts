import type { DeliveryObservationPort, DeliveryVerifierOptions } from '@sparkkeeper/automation';
import { DeliveryBudget } from '@sparkkeeper/automation';
import type { TargetResolutionFailure, TargetSendFailureCode } from '@sparkkeeper/shared';
import { DeliveryVerificationService } from '../automation/DeliveryVerificationService.js';
import type {
  ExistingTargetResolverRuntime,
  TargetResolutionService,
} from '../automation/TargetResolutionService.js';

/** Shared single-target core. No scheduler, retry, browser launch or caller-selected text. */
export interface PerTargetPersistence {
  claim(key: string): boolean;
  assertCurrent(key: string): {
    run: { accountId: string };
    record: { contactId: string; messageText: string };
  };
  execution(key: string): {
    run: { accountId: string };
    record: { contactId: string; sendActionStartedAt: Date | null };
  };
  boundary(key: string): void;
  finish(
    key: string,
    outcome: 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN',
    failure: TargetSendFailureCode,
  ): unknown;
}
function resolutionFailureCode(result: TargetResolutionFailure): TargetSendFailureCode {
  switch (result.reason) {
    case 'AUTH_EXPIRED':
      return 'AUTH_EXPIRED';
    case 'AUTH_UNKNOWN':
    case 'ACCOUNT_IDENTITY_MISMATCH':
      return 'AUTH_UNKNOWN';
    case 'ACCOUNT_NOT_READY':
    case 'RUNTIME_OWNERSHIP_LOST':
    case 'PERSISTENCE_FAILURE':
      return 'PROFILE_UNAVAILABLE';
    case 'PAGE_CLOSED':
    case 'BROWSER_FAILURE':
      return 'BROWSER_FAILURE';
    case 'TARGET_NOT_FOUND':
      return 'TARGET_NOT_FOUND';
    case 'TARGET_AMBIGUOUS':
      return 'TARGET_AMBIGUOUS';
    case 'IDENTITY_CHANGED':
    case 'METADATA_VERSION_CHANGED':
      return 'IDENTITY_CHANGED';
    default:
      return 'CONVERSATION_VERIFICATION_FAILED';
  }
}
export class PerTargetSendCoordinator {
  constructor(
    private readonly repository: PerTargetPersistence,
    private readonly targets: TargetResolutionService,
  ) {}
  async execute(
    runId: string,
    runtime: ExistingTargetResolverRuntime,
    observation: DeliveryObservationPort,
    owned: () => Promise<void>,
    limits: DeliveryVerifierOptions = {},
  ) {
    let failure: TargetSendFailureCode = 'CONFIG_INVALID';
    const deadline = Math.min(limits.deadline ?? Date.now() + 60_000, Date.now() + 60_000);
    const budget = new DeliveryBudget(deadline);
    const checkOwned = async () => {
      try {
        await budget.run(owned);
      } catch (error) {
        failure = 'PROFILE_UNAVAILABLE';
        throw error;
      }
    };
    try {
      await checkOwned();
      if (!this.repository.claim(runId)) return;
      const e = this.repository.assertCurrent(runId);
      const prepared = this.targets.prepare(e.run.accountId, e.record.contactId);
      if (prepared.status !== 'PREPARED') {
        failure = resolutionFailureCode(prepared);
        throw new Error('TARGET_REJECTED');
      }
      const resolved = await budget.run(() =>
        this.targets.resolveCurrentChat(prepared.request, runtime, deadline),
      );
      if (resolved.status !== 'VERIFIED') {
        failure = resolutionFailureCode(resolved);
        throw new Error('TARGET_REJECTED');
      }
      await checkOwned();
      this.repository.assertCurrent(runId);
      const result = await new DeliveryVerificationService(this.targets).verify({
        witness: resolved.witness,
        runtime,
        observation,
        message: e.record.messageText,
        onTargetFailure: (result) => {
          failure = resolutionFailureCode(result);
        },
        boundary: {
          record: async () => {
            await checkOwned();
            budget.assertActive();
            this.repository.boundary(runId);
          },
        },
        limits: { ...limits, deadline },
      });
      await checkOwned();
      this.repository.finish(
        runId,
        result.status,
        result.reason === 'DELIVERY_TIMEOUT'
          ? 'DELIVERY_VERIFICATION_TIMEOUT'
          : result.reason === 'PAGE_UNAVAILABLE'
            ? 'BROWSER_FAILURE'
            : failure,
      );
      return;
    } catch {
      const e = this.repository.execution(runId);
      if (!e.record.sendActionStartedAt && failure === 'CONFIG_INVALID') {
        // Claim/current-snapshot rejection can be account-wide (e.g. DB AUTH_EXPIRED),
        // not merely a local target failure. Re-read safe typed metadata, never guess from an exception.
        const current = this.targets.prepare(e.run.accountId, e.record.contactId);
        if (current.status !== 'PREPARED') failure = resolutionFailureCode(current);
      }
      this.repository.finish(
        runId,
        e.record.sendActionStartedAt ? 'DELIVERY_UNKNOWN' : 'FAILED',
        e.record.sendActionStartedAt ? 'DELIVERY_EVIDENCE_INSUFFICIENT' : failure,
      );
    } finally {
      budget.cancel();
    }
  }
}
