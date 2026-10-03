import {
  isDeliveryMessage,
  normalizeDeliveryText,
  type DeliveryVerificationResult,
} from '@sparkkeeper/shared';
import { createHash } from 'node:crypto';
import {
  resolutionWitnessBinding,
  revalidateResolutionWitness,
  type ResolutionWitness,
} from '../resolver/ResolutionWitness.js';
import {
  DeliveryBudget,
  DeliveryGuardError,
  stopDelivery,
  type DeliveryObservationPort,
  type DeliveryActionBoundary,
  type DeliveryTargetGuard,
  type DeliveryVerifierOptions,
} from './types.js';

const consumed = new WeakMap<ResolutionWitness, DeliveryVerificationResult | 'RUNNING'>();
const messages = new WeakMap<ResolutionWitness, string>();
const activePages = new WeakSet<object>();
export class DeliveryVerifier {
  constructor(
    private readonly port: DeliveryObservationPort,
    private readonly target: DeliveryTargetGuard,
  ) {}
  async verify(
    witness: ResolutionWitness,
    message: string,
    action: DeliveryActionBoundary,
    options: DeliveryVerifierOptions = {},
  ): Promise<DeliveryVerificationResult> {
    let boundary: 'NOT_STARTED' | 'UNCERTAIN' | 'RECORDED' = 'NOT_STARTED';
    let invocations: 0 | 1 = 0;
    const failure = (reason: DeliveryGuardError['reason']): DeliveryVerificationResult => {
      const result: DeliveryVerificationResult = Object.freeze(
        boundary === 'NOT_STARTED'
          ? { status: 'FAILED', reason, boundary, actionInvocations: 0 }
          : { status: 'DELIVERY_UNKNOWN', reason, boundary, actionInvocations: invocations },
      );
      return result;
    };
    const binding = resolutionWitnessBinding(witness);
    if (!binding || binding.page !== this.port.page || binding.context !== this.port.context)
      return failure('WITNESS_INVALID');
    const previous = consumed.get(witness);
    const messageVersion = isDeliveryMessage(message)
      ? createHash('sha256').update(message).digest('hex')
      : '';
    if (previous && previous !== 'RUNNING' && messages.get(witness) === messageVersion)
      return previous;
    if (previous || activePages.has(binding.page))
      return Object.freeze({
        status: 'DELIVERY_UNKNOWN',
        reason: 'ALREADY_CONSUMED',
        boundary: 'UNCERTAIN',
        actionInvocations: 0,
      });
    consumed.set(witness, 'RUNNING');
    messages.set(witness, messageVersion); // No plaintext remains in the terminal replay registry.
    activePages.add(binding.page);
    const budget = new DeliveryBudget(options.deadline);
    const timeout = options.verificationTimeoutMs ?? 15_000;
    const poll = options.pollIntervalMs ?? 50;
    const guard = async () => {
      if (await budget.run(() => revalidateResolutionWitness(witness)))
        stopDelivery('WITNESS_INVALID');
      if (await budget.run(() => this.target.check())) stopDelivery('TARGET_CHANGED');
    };
    let result: DeliveryVerificationResult = failure('OBSERVATION_FAILED');
    try {
      if (!isDeliveryMessage(message)) stopDelivery('MESSAGE_INVALID');
      if (
        !Number.isInteger(timeout) ||
        timeout < 1 ||
        timeout > 30_000 ||
        !Number.isInteger(poll) ||
        poll < 1 ||
        poll > 1000
      )
        stopDelivery('MESSAGE_INVALID');
      const knownText = normalizeDeliveryText(message);
      await guard();
      await budget.run(() => this.port.arm(binding, knownText, budget));
      if (this.port.prepare) await budget.run(() => this.port.prepare!(budget));
      await budget.run(() => this.port.ready(budget));
      await guard();
      await budget.run(() => this.port.ready(budget));
      budget.beginVerification(timeout);
      await budget.run(() => this.port.beginBoundary(budget));
      boundary = 'UNCERTAIN'; // Commit may succeed even if its acknowledgement rejects/times out.
      try {
        await budget.run(() => action.record());
      } catch (error) {
        if (error instanceof DeliveryGuardError) throw error;
        stopDelivery('ACTION_BOUNDARY_UNCERTAIN');
      }
      boundary = 'RECORDED';
      await guard();
      await budget.run(() => {
        invocations = 1;
        return this.port.invokeOnce(budget);
      });
      let reconciled = false;
      while (true) {
        await guard();
        let evidence = await budget.run(() => this.port.observe(budget));
        if (evidence === 'AMBIGUOUS') stopDelivery('EVIDENCE_AMBIGUOUS');
        if (evidence === 'VERIFIED') {
          await guard();
          evidence = await budget.run(() => this.port.observe(budget));
          if (evidence === 'AMBIGUOUS') stopDelivery('EVIDENCE_AMBIGUOUS');
          if (evidence !== 'VERIFIED') stopDelivery('EVIDENCE_INSUFFICIENT');
          result = Object.freeze({
            status: 'SUCCESS',
            reason: 'DELIVERY_VERIFIED',
            boundary: 'RECORDED',
            actionInvocations: 1,
          } as const);
          break;
        }
        if (!reconciled && budget.remaining() <= Math.max(poll * 2, 100)) {
          reconciled = true;
          evidence = await budget.run(() => this.port.reconcile(budget));
          if (evidence === 'AMBIGUOUS') stopDelivery('EVIDENCE_AMBIGUOUS');
          if (evidence === 'VERIFIED') continue;
        }
        await budget.run(
          () =>
            new Promise<void>((resolve) =>
              setTimeout(resolve, Math.min(poll, Math.max(1, budget.remaining()))),
            ),
        );
      }
    } catch (error) {
      result = failure(
        error instanceof DeliveryGuardError
          ? error.reason
          : invocations
            ? 'ACTION_UNCERTAIN'
            : 'OBSERVATION_FAILED',
      );
    } finally {
      if (result.status !== 'SUCCESS') budget.cancel();
      const cleaned = await new DeliveryBudget(Date.now() + 500)
        .run(() => this.port.dispose())
        .then(
          () => {
            activePages.delete(binding.page);
            return true;
          },
          () => false,
        ); // Failed teardown keeps this page fail-closed.
      if (!cleaned && result.status === 'SUCCESS') result = failure('OBSERVATION_FAILED');
    }
    if (result.status === 'SUCCESS') {
      try {
        await guard();
      } catch (error) {
        result = failure(error instanceof DeliveryGuardError ? error.reason : 'OBSERVATION_FAILED');
      }
    }
    budget.cancel();
    consumed.set(witness, result);
    return result;
  }
}
