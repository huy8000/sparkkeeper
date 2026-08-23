import type { TargetContactIdentity } from './types.js';

export const TARGET_DISPLAY_NAME_ENV = 'MVP_TARGET_DISPLAY_NAME';

export interface ContactTargetEnvironment {
  readonly MVP_TARGET_DISPLAY_NAME?: string;
}

export function resolveTargetContactIdentity(
  environment: ContactTargetEnvironment = process.env,
): TargetContactIdentity {
  const displayName = environment.MVP_TARGET_DISPLAY_NAME?.trim() ?? '';
  if (displayName === '') {
    throw new Error(`${TARGET_DISPLAY_NAME_ENV} must be configured with a non-empty value.`);
  }

  return { displayName };
}
