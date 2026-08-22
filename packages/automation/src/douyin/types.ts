export type AuthStatus = 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN';

export interface AuthDetectionResult {
  readonly status: AuthStatus;
  readonly reason: string;
}

export interface AuthDetectorOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export interface ConversationSummary {
  readonly displayName: string;
}

export interface ChatReadinessResult {
  readonly status: 'READY';
  readonly reason: string;
}

export type DouyinChatErrorCode =
  | 'AUTH_EXPIRED'
  | 'AUTH_UNKNOWN'
  | 'CHAT_NOT_READY'
  | 'CONVERSATION_LIST_NOT_FOUND'
  | 'CONVERSATION_ITEM_PARSE_FAILED'
  | 'PAGE_CLOSED'
  | 'BROWSER_ERROR';
