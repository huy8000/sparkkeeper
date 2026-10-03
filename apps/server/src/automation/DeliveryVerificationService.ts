import {
  DeliveryVerifier,
  type ResolutionWitness,
  type DeliveryObservationPort,
  type DeliveryActionBoundary,
  type DeliveryVerifierOptions,
} from '@sparkkeeper/automation';
import type { DeliveryVerificationResult } from '@sparkkeeper/shared';
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
  }): Promise<DeliveryVerificationResult> {
    const { witness, runtime, observation, message, boundary, limits } = options;
    return new DeliveryVerifier(observation, {
      check: () => this.targets.revalidateCurrentChat(witness, runtime),
    }).verify(witness, message, boundary, limits);
  }
}
