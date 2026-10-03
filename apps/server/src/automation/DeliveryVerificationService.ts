import {
  DeliveryVerifier,
  type ResolutionWitness,
  type DeliveryObservationPort,
  type DeliveryActionBoundary,
  type DeliveryVerifierOptions,
} from '@sparkkeeper/automation';
import type { DeliveryVerificationResult, TargetResolutionFailure } from '@sparkkeeper/shared';
import type {
  ExistingTargetResolverRuntime,
  TargetResolutionService,
} from './TargetResolutionService.js';

/** Internal only; future coordinator supplies persisted immutable message + durable boundary. */
export class DeliveryVerificationService {
  constructor(private readonly targets: TargetResolutionService) {}
  verify(options: {
    readonly witness: ResolutionWitness;
    readonly runtime: ExistingTargetResolverRuntime;
    readonly observation: DeliveryObservationPort;
    readonly message: string;
    readonly boundary: DeliveryActionBoundary;
    readonly limits?: DeliveryVerifierOptions;
    readonly onTargetFailure?: (failure: TargetResolutionFailure) => void;
  }): Promise<DeliveryVerificationResult> {
    const { witness, runtime, observation, message, boundary, limits } = options;
    return new DeliveryVerifier(observation, {
      check: async () => {
        const failure = await this.targets.revalidateCurrentChat(witness, runtime);
        if (failure) options.onTargetFailure?.(failure);
        return failure;
      },
    }).verify(witness, message, boundary, limits);
  }
}
