import type { MessageProviderType, MessageTemplate } from '@sparkkeeper/shared';

import { RandomProvider, StaticProvider, type MessageProvider } from './providers/index.js';
import {
  MessageTemplateValidationError,
  validateMessageTemplateDefinition,
  validateMessageText,
} from './validation.js';

export type MessageEngineErrorCode =
  'TEMPLATE_DISABLED' | 'UNKNOWN_PROVIDER' | 'INVALID_TEMPLATE' | 'INVALID_MESSAGE';

export class MessageEngineError extends Error {
  constructor(
    readonly code: MessageEngineErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MessageEngineError';
  }
}

export class MessageEngine {
  private readonly providers: ReadonlyMap<MessageProviderType, MessageProvider>;

  constructor(
    providers: readonly MessageProvider[] = [new StaticProvider(), new RandomProvider()],
  ) {
    this.providers = new Map(providers.map((provider) => [provider.type, provider]));
  }

  async build(template: MessageTemplate): Promise<string> {
    if (template.enabled === false) {
      throw new MessageEngineError('TEMPLATE_DISABLED', 'Message template is disabled.');
    }
    if (template.enabled !== true) {
      throw new MessageEngineError(
        'INVALID_TEMPLATE',
        'Message template enabled state is invalid.',
      );
    }

    try {
      validateMessageTemplateDefinition(template);
    } catch (error) {
      if (error instanceof MessageTemplateValidationError && error.code === 'UNKNOWN_PROVIDER') {
        throw new MessageEngineError(
          'UNKNOWN_PROVIDER',
          'Message template provider is not supported.',
          error,
        );
      }
      throw new MessageEngineError('INVALID_TEMPLATE', 'Message template is invalid.', error);
    }

    const provider = this.providers.get(template.providerType);
    if (provider === undefined) {
      throw new MessageEngineError(
        'UNKNOWN_PROVIDER',
        'No provider is registered for the message template.',
      );
    }

    const message = await provider.build(template);
    try {
      validateMessageText(message);
    } catch (error) {
      throw new MessageEngineError(
        'INVALID_MESSAGE',
        'Message provider generated an invalid message.',
        error,
      );
    }
    return message;
  }
}
