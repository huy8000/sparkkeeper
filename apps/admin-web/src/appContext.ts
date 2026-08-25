import { inject, type InjectionKey, type Ref } from 'vue';

import type { SparkKeeperApi } from './api/sparkkeeperApi';
import type { RequestState } from './composables/useRequest';
import type { RealtimeState } from './composables/useRealtimeEvents';
import type { RuntimeStatus } from './types/api';

export interface AdminAppContext {
  readonly api: SparkKeeperApi;
  readonly refreshVersion: Readonly<Ref<number>>;
  readonly runtime: RequestState<RuntimeStatus>;
  readonly realtime: RealtimeState;
  readonly refresh: () => void;
}

export const appContextKey: InjectionKey<AdminAppContext> = Symbol('SparkKeeperAdminContext');

export function useAdminApp(): AdminAppContext {
  const context = inject(appContextKey);
  if (context === undefined) throw new Error('SparkKeeper admin context is unavailable.');
  return context;
}
