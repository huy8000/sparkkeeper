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

export interface ConversationCandidate extends ConversationSummary {
  /** Ephemeral virtual-list position used only during the current browser run. */
  readonly listIndex: number;
}

export interface TargetContactIdentity {
  readonly displayName: string;
}

export interface ResolvedContact {
  readonly identity: TargetContactIdentity;
  /** Ephemeral virtual-list position; this is not a contact identity field. */
  readonly listIndex: number;
}

export type ContactResolveResult =
  | {
      readonly type: 'FOUND';
      readonly contact: ResolvedContact;
      readonly matchCount: 1;
      readonly scrollAttempts: number;
    }
  | {
      readonly type: 'NOT_FOUND';
      readonly matchCount: 0;
      readonly scrollAttempts: number;
    }
  | {
      readonly type: 'AMBIGUOUS';
      readonly matchCount: number;
      readonly scrollAttempts: number;
    };

export interface ConversationListScrollResult {
  readonly moved: boolean;
  readonly atEnd: boolean;
}

export interface ConversationOpenResult {
  readonly status: 'VERIFIED';
}

export type MessageSendStatus =
  'SUCCESS' | 'INPUT_FAILED' | 'SEND_ACTION_FAILED' | 'VERIFY_FAILED' | 'DELIVERY_UNKNOWN';

export type MessageInputStatus = 'VERIFIED' | 'FAILED' | 'NOT_ATTEMPTED';
export type MessageSendActionStatus = 'TRIGGERED' | 'NOT_TRIGGERED' | 'UNKNOWN';
export type DeliveryVerificationStatus = 'SUCCESS' | 'FAILED' | 'UNKNOWN' | 'NOT_ATTEMPTED';

export interface MessageSendRequest {
  readonly target: TargetContactIdentity;
  readonly message: string;
  readonly allowRealSend: boolean;
}

export interface MessageSendResult {
  readonly status: MessageSendStatus;
  readonly input: MessageInputStatus;
  readonly sendAction: MessageSendActionStatus;
  readonly delivery: DeliveryVerificationStatus;
  readonly sendAttemptCount: 0 | 1;
  readonly reason: string;
}

export type MessageSenderErrorCode =
  'SEND_NOT_AUTHORIZED' | 'MESSAGE_INVALID' | 'SEND_ALREADY_ATTEMPTED';

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
  | 'CONVERSATION_OPEN_FAILED'
  | 'CONVERSATION_VERIFICATION_FAILED'
  | 'PAGE_CLOSED'
  | 'BROWSER_ERROR';
