export { AuthDetectionError, AuthDetector } from './AuthDetector.js';
export {
  ContactResolver,
  normalizeDisplayName,
  type ContactConversationSource,
  type ContactResolverOptions,
} from './ContactResolver.js';
export {
  resolveTargetContactIdentity,
  TARGET_DISPLAY_NAME_ENV,
  type ContactTargetEnvironment,
} from './contactConfig.js';
export {
  DouyinChatPage,
  DouyinChatPageError,
  type DouyinChatPageOptions,
} from './DouyinChatPage.js';
export { DOUYIN_CHAT_URL } from './selectors.js';
export type {
  AuthDetectionResult,
  AuthDetectorOptions,
  AuthStatus,
  ChatReadinessResult,
  ContactResolveResult,
  ConversationCandidate,
  ConversationListScrollResult,
  ConversationOpenResult,
  ConversationSummary,
  DouyinChatErrorCode,
  ResolvedContact,
  TargetContactIdentity,
} from './types.js';
