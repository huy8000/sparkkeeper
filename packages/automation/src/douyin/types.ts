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
