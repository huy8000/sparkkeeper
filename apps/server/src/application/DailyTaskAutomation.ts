import type { Friend, SendRecord } from '@sparkkeeper/database';

export type AutomationAuthResult = 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN';
export type ContactOpenResult = 'VERIFIED' | 'NOT_FOUND' | 'AMBIGUOUS' | 'VERIFICATION_FAILED';
export interface AutomationSendResult {
  readonly status: 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN';
  readonly sendAttemptCount: 0 | 1;
}

export interface DailyTaskAutomation {
  start(): Promise<void>;
  checkAuth(): Promise<AutomationAuthResult>;
  resolveAndOpen(friend: Friend): Promise<ContactOpenResult>;
  sendAndVerify(friend: Friend, record: SendRecord): Promise<AutomationSendResult>;
  close(): Promise<void>;
}
