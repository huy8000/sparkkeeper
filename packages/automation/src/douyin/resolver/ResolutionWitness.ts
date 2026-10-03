import { targetResolutionFailure, type TargetResolutionFailure } from '@sparkkeeper/shared';
import { inspect } from 'node:util';
import type { ResolverRequest, ResolverAccountBinding } from '@sparkkeeper/shared';
import type { ResolverCandidate } from './types.js';

/** Package-private backing projection, never an exported DTO or caller-created authority. */
export interface ResolutionWitnessBinding {
  readonly page: object;
  readonly context: object;
  readonly request: ResolverRequest;
  readonly candidate: ResolverCandidate;
  readonly self: ResolverAccountBinding;
}

declare const witnessBrand: unique symbol;
export interface ResolutionWitness {
  readonly [witnessBrand]: true;
}
const registry = new WeakMap<
  object,
  {
    brand: object;
    check: () => Promise<TargetResolutionFailure | null>;
    binding: ResolutionWitnessBinding;
  }
>();

/** Package-internal issuer. Backing state is never a property of the opaque result. */
export function issueResolutionWitness(
  brand: object,
  check: () => Promise<TargetResolutionFailure | null>,
  binding: ResolutionWitnessBinding,
): ResolutionWitness {
  const witness = Object.freeze(
    Object.create(null, {
      toJSON: { value: () => undefined },
      [inspect.custom]: { value: () => '[ResolutionWitness]' },
    }),
  ) as ResolutionWitness;
  registry.set(witness, { brand, check, binding });
  return witness;
}
export function resolutionWitnessBinding(
  witness: ResolutionWitness,
): ResolutionWitnessBinding | undefined {
  return registry.get(witness)?.binding;
}
export async function revalidateResolutionWitness(
  witness: ResolutionWitness,
): Promise<TargetResolutionFailure | null> {
  const entry = registry.get(witness);
  return entry
    ? checkResolutionWitness(entry.brand, witness)
    : targetResolutionFailure('RUNTIME_OWNERSHIP_LOST');
}
export function invalidateResolutionWitness(witness: ResolutionWitness): void {
  registry.delete(witness);
}
export async function checkResolutionWitness(
  brand: object,
  witness: ResolutionWitness,
): Promise<TargetResolutionFailure | null> {
  const entry = registry.get(witness);
  if (!entry || entry.brand !== brand) return targetResolutionFailure('RUNTIME_OWNERSHIP_LOST');
  let failure: TargetResolutionFailure | null;
  try {
    failure = await entry.check();
  } catch {
    failure = targetResolutionFailure('BROWSER_FAILURE');
  }
  if (failure) registry.delete(witness);
  return failure;
}
