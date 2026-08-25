import type { Friend, SendRecord } from '@sparkkeeper/database';
import type { ExternalActionState, RetryFailureCode } from '@sparkkeeper/shared';

export type AutomationAuthResult = 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN';
export type ContactOpenResult =
  | { readonly status: 'VERIFIED' }
  | { readonly status: 'FAILED'; readonly failureCode: RetryFailureCode };
export type AutomationSendResult =
  | { readonly status: 'SUCCESS'; readonly sendAction: 'TRIGGERED' }
  | {
      readonly status: 'FAILED';
      readonly failureCode: RetryFailureCode;
      readonly sendAction: 'NOT_TRIGGERED';
    }
  | {
      readonly status: 'DELIVERY_UNKNOWN';
      readonly failureCode: 'DELIVERY_UNKNOWN' | 'VERIFY_FAILED';
      readonly sendAction: 'TRIGGERED' | 'UNKNOWN';
    };

export class DailyTaskAutomationError extends Error {
  constructor(
    readonly failureCode: RetryFailureCode,
    readonly externalActionState: ExternalActionState,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DailyTaskAutomationError';
  }
}

export interface DailyTaskAutomation {
  start(): Promise<void>;
  checkAuth(): Promise<AutomationAuthResult>;
  resolveAndOpen(friend: Friend): Promise<ContactOpenResult>;
  sendAndVerify(friend: Friend, record: SendRecord): Promise<AutomationSendResult>;
  close(): Promise<void>;
}
