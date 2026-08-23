import type { MessageProviderType, MessageTemplate } from '@sparkkeeper/shared';

export type MessageTemplateValidationCode =
  'INVALID_NAME' | 'UNKNOWN_PROVIDER' | 'INVALID_MESSAGES' | 'INVALID_MESSAGE';

export class MessageTemplateValidationError extends Error {
  constructor(
    readonly code: MessageTemplateValidationCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MessageTemplateValidationError';
  }
}

export const MESSAGE_PROVIDER_TYPES = [
  'STATIC',
  'RANDOM',
] as const satisfies readonly MessageProviderType[];

export function validateTemplateName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MessageTemplateValidationError(
      'INVALID_NAME',
      'Message template name must be a nonblank string.',
    );
  }
  return value.trim();
}

export function validateProviderType(value: unknown): asserts value is MessageProviderType {
  if (!isMessageProviderType(value)) {
    throw new MessageTemplateValidationError(
      'UNKNOWN_PROVIDER',
      'Message template provider type is not supported.',
    );
  }
}

export function validateTemplateMessages(
  providerType: unknown,
  messages: unknown,
): asserts messages is readonly string[] {
  validateProviderType(providerType);

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new MessageTemplateValidationError(
      'INVALID_MESSAGES',
      'Message template messages must be a nonempty array.',
    );
  }

  for (const message of messages) {
    validateMessageText(message);
  }

  if (providerType === 'STATIC' && messages.length !== 1) {
    throw new MessageTemplateValidationError(
      'INVALID_MESSAGES',
      'STATIC message templates require exactly one message.',
    );
  }
}

export function validateMessageTemplateDefinition(
  template: unknown,
): asserts template is MessageTemplate {
  if (typeof template !== 'object' || template === null) {
    throw new MessageTemplateValidationError(
      'INVALID_MESSAGES',
      'Message template definition must be an object.',
    );
  }

  const candidate = template as { providerType?: unknown; messages?: unknown };
  validateTemplateMessages(candidate.providerType, candidate.messages);
}

export function validateTemplateForProvider(
  template: MessageTemplate,
  expectedProvider: MessageProviderType,
): void {
  validateTemplateMessages(template.providerType, template.messages);
  if (template.providerType !== expectedProvider) {
    throw new MessageTemplateValidationError(
      'UNKNOWN_PROVIDER',
      'Message provider received a template for a different provider type.',
    );
  }
}

export function validateMessageText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new MessageTemplateValidationError(
      'INVALID_MESSAGE',
      'Message text must be a nonblank string.',
    );
  }
}

function isMessageProviderType(value: unknown): value is MessageProviderType {
  return typeof value === 'string' && (MESSAGE_PROVIDER_TYPES as readonly string[]).includes(value);
}
