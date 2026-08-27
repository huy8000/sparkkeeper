import { inject, type ComputedRef, type InjectionKey } from 'vue';

import type { RequestState } from './composables/useRequest';
import type { Account } from './types/api';

export interface AccountWorkspaceContext {
  readonly accountId: ComputedRef<string>;
  readonly account: RequestState<Account>;
}

export const accountWorkspaceContextKey: InjectionKey<AccountWorkspaceContext> = Symbol(
  'SparkKeeperAccountWorkspaceContext',
);

export function useAccountWorkspace(): AccountWorkspaceContext {
  const context = inject(accountWorkspaceContextKey);
  if (context === undefined) throw new Error('Account workspace context is unavailable.');
  return context;
}
