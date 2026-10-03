import type {
  DeliveryBudget,
  DeliveryEvidence,
  DeliveryObservationPort,
} from '../src/douyin/delivery/types.js';
import type { ResolutionWitnessBinding } from '../src/douyin/resolver/ResolutionWitness.js';
import { FixtureDirectory, request } from './resolverFixture.js';

export class FakeDeliveryPort implements DeliveryObservationPort {
  readonly context: object;
  armed = 0;
  clicks = 0;
  disposed = 0;
  reconciliations = 0;
  boundaryStarted = 0;
  evidence: DeliveryEvidence = 'VERIFIED';
  afterArm: (() => void) | undefined;
  afterClick: (() => void) | undefined;
  constructor(
    readonly page: object,
    context: object,
  ) {
    this.context = context;
  }
  async arm(_binding: ResolutionWitnessBinding, _text: string, budget: DeliveryBudget) {
    budget.assertActive();
    this.armed++;
    this.afterArm?.();
  }
  async ready(budget: DeliveryBudget) {
    budget.assertActive();
  }
  async beginBoundary(budget: DeliveryBudget) {
    budget.assertActive();
    this.boundaryStarted++;
  }
  async invokeOnce(budget: DeliveryBudget) {
    budget.assertActive();
    this.clicks++;
    this.afterClick?.();
  }
  async observe(budget: DeliveryBudget) {
    budget.assertActive();
    return this.evidence;
  }
  async reconcile(budget: DeliveryBudget) {
    budget.assertActive();
    this.reconciliations++;
    return this.evidence;
  }
  async dispose() {
    this.disposed++;
  }
}
export async function verifiedFixture() {
  const directory = new FixtureDirectory(),
    resolver = directory.resolver();
  const found = await resolver.resolve(request(), Date.now() + 5000);
  if (found.status !== 'FOUND') throw new Error('synthetic fixture not found');
  const result = await resolver.openAndVerify(found.candidate, request());
  if (result.status !== 'VERIFIED') throw new Error('synthetic fixture not verified');
  return {
    directory,
    resolver,
    witness: result.witness,
    port: new FakeDeliveryPort(directory.state.page, directory.state.context),
  };
}
