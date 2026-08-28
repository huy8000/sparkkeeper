import type { Health, RuntimeStatus } from '../types/api';

export type RuntimeReadiness = 'READY' | 'DEGRADED';
export type SystemSummaryState = RuntimeReadiness | 'LOADING' | 'UNAVAILABLE';

export function classifyRuntimeReadiness(runtime: RuntimeStatus): RuntimeReadiness {
  return runtime.serverStatus === 'READY' &&
    runtime.databaseReady &&
    runtime.migrationReady &&
    runtime.observabilityReady &&
    runtime.browserProfileConfigured
    ? 'READY'
    : 'DEGRADED';
}

export function classifySystemSummary(input: {
  readonly health: Health | null;
  readonly runtime: RuntimeStatus | null;
  readonly healthError: boolean;
  readonly runtimeError: boolean;
}): SystemSummaryState {
  if (input.healthError && input.runtimeError) return 'UNAVAILABLE';
  if (input.healthError || input.runtimeError) return 'DEGRADED';
  if (input.health === null || input.runtime === null) return 'LOADING';
  return input.health.status === 'READY' && classifyRuntimeReadiness(input.runtime) === 'READY'
    ? 'READY'
    : 'DEGRADED';
}
