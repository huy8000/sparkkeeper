import { targetResolutionFailure, type TargetResolutionFailure } from '@sparkkeeper/shared';
import { inspect } from 'node:util';

declare const witnessBrand: unique symbol;
export interface ResolutionWitness {
  readonly [witnessBrand]: true;
}
const registry = new WeakMap<
  object,
  { brand: object; check: () => Promise<TargetResolutionFailure | null> }
>();

/** Package-internal issuer. Backing state is never a property of the opaque result. */
export function issueResolutionWitness(
  brand: object,
  check: () => Promise<TargetResolutionFailure | null>,
): ResolutionWitness {
  const witness = Object.freeze(
    Object.create(null, {
      toJSON: { value: () => undefined },
      [inspect.custom]: { value: () => '[ResolutionWitness]' },
    }),
  ) as ResolutionWitness;
  registry.set(witness, { brand, check });
  return witness;
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
