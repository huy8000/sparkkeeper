import type { TargetContactIdentity } from './types.js';
import { resolveTargetContactIdentity } from './contactConfig.js';

export const TEST_MESSAGE_ENV = 'MVP_TEST_MESSAGE';
export const ALLOW_REAL_SEND_ENV = 'MVP_ALLOW_REAL_SEND';
const MAX_MVP_MESSAGE_LENGTH = 1_000;

export interface MessageSendEnvironment {
  readonly MVP_TARGET_DISPLAY_NAME?: string;
  readonly MVP_TEST_MESSAGE?: string;
  readonly MVP_ALLOW_REAL_SEND?: string;
}

export interface MessageSendRuntimeConfig {
  readonly target: TargetContactIdentity;
  readonly message: string;
  readonly allowRealSend: true;
}

export function resolveMessageSendRuntimeConfig(
  environment: MessageSendEnvironment = process.env,
): MessageSendRuntimeConfig {
  const target = resolveTargetContactIdentity(environment);
  const message = environment.MVP_TEST_MESSAGE ?? '';
  if (message.trim() === '') {
    throw new Error(`${TEST_MESSAGE_ENV} must be configured with a non-empty value.`);
  }
  if (message.length > MAX_MVP_MESSAGE_LENGTH) {
    throw new Error(`${TEST_MESSAGE_ENV} exceeds the MVP plain-text length limit.`);
  }
  if (environment.MVP_ALLOW_REAL_SEND !== 'true') {
    throw new Error(`${ALLOW_REAL_SEND_ENV} must equal "true" to authorize a real send.`);
  }

  return { target, message, allowRealSend: true };
}
