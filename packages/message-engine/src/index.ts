export { MessageEngine, MessageEngineError, type MessageEngineErrorCode } from './MessageEngine.js';
export {
  RandomProvider,
  RandomSourceError,
  StaticProvider,
  type MessageProvider,
  type RandomSource,
} from './providers/index.js';
export {
  MESSAGE_PROVIDER_TYPES,
  MessageTemplateValidationError,
  validateMessageTemplateDefinition,
  validateMessageText,
  validateProviderType,
  validateTemplateForProvider,
  validateTemplateMessages,
  validateTemplateName,
  type MessageTemplateValidationCode,
} from './validation.js';
export type { MessageProviderType, MessageTemplate } from '@sparkkeeper/shared';
