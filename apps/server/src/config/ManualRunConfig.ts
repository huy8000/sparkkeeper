export interface ManualRunEnvironment {
  readonly MANUAL_RUN_ENABLED?: string;
}

export interface ManualRunConfig {
  readonly enabled: boolean;
}

export function resolveManualRunConfig(
  environment: ManualRunEnvironment = process.env,
): ManualRunConfig {
  return { enabled: parseBoolean(environment.MANUAL_RUN_ENABLED) };
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '' || value.trim().toLowerCase() === 'false') {
    return false;
  }
  if (value.trim().toLowerCase() === 'true') return true;
  throw new Error('MANUAL_RUN_ENABLED must be true or false.');
}
