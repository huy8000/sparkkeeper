import type { DeliveryObservationPort, DeliveryVerifierOptions } from '@sparkkeeper/automation';
import { DeliveryBudget } from '@sparkkeeper/automation';
import type { TestSendRepository } from '@sparkkeeper/database';
import type { TargetSendFailureCode } from '@sparkkeeper/shared';
import { DeliveryVerificationService } from '../automation/DeliveryVerificationService.js';
import type {
  ExistingTargetResolverRuntime,
  TargetResolutionService,
} from '../automation/TargetResolutionService.js';

/** Shared single-target core. No scheduler, retry, browser launch or caller-selected text. */
export class PerTargetSendCoordinator {
  constructor(
    private readonly repository: TestSendRepository,
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
    try {
      await budget.run(owned);
      if (!this.repository.claim(runId)) return;
      const e = this.repository.assertCurrent(runId);
      const prepared = this.targets.prepare(e.run.accountId, e.record.contactId);
      if (prepared.status !== 'PREPARED') {
        failure = 'TARGET_IDENTITY_UNAVAILABLE';
        throw new Error('TARGET_REJECTED');
      }
      const resolved = await budget.run(() =>
        this.targets.resolveCurrentChat(prepared.request, runtime, deadline),
      );
      if (resolved.status !== 'VERIFIED') {
        failure =
          resolved.status === 'NOT_FOUND'
            ? 'TARGET_NOT_FOUND'
            : resolved.status === 'AMBIGUOUS'
              ? 'TARGET_AMBIGUOUS'
              : resolved.status === 'AUTH_EXPIRED'
                ? 'AUTH_EXPIRED'
                : 'CONVERSATION_VERIFICATION_FAILED';
        throw new Error('TARGET_REJECTED');
      }
      await budget.run(owned);
      this.repository.assertCurrent(runId);
      const result = await new DeliveryVerificationService(this.targets).verify({
        witness: resolved.witness,
        runtime,
        observation,
        message: e.record.messageText,
        boundary: {
          record: async () => {
            await budget.run(owned);
            budget.assertActive();
            this.repository.boundary(runId);
          },
        },
        limits: { ...limits, deadline },
      });
      await budget.run(owned);
      this.repository.finish(
        runId,
        result.status,
        result.reason === 'DELIVERY_TIMEOUT' ? 'DELIVERY_VERIFICATION_TIMEOUT' : 'CONFIG_INVALID',
      );
      return;
    } catch {
      const e = this.repository.execution(runId);
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
