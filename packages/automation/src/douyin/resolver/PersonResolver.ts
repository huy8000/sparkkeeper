import { targetResolutionFailure, type ResolverRequest } from '@sparkkeeper/shared';
import type { StableTargetResolver, StableResolveResult } from './StableTargetResolver.js';
export class PersonResolver {
  constructor(private readonly resolver: StableTargetResolver) {}
  async resolve(request: ResolverRequest, deadline: number): Promise<StableResolveResult> {
    return request.contactType === 'PERSON'
      ? this.resolver.resolve(request, deadline)
      : targetResolutionFailure('UNSUPPORTED_TARGET_TYPE');
  }
}
