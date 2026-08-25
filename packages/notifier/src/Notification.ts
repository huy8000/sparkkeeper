import type { BusinessDate, RuntimeEventType } from '@sparkkeeper/shared';

export const NOTIFICATION_PROVIDER_TYPES = ['WEBHOOK'] as const;
export type NotificationProviderType = (typeof NOTIFICATION_PROVIDER_TYPES)[number];

export const NOTIFICATION_EVENT_TYPES = [
  'AUTH_EXPIRED',
  'TASK_FAILED',
  'CONSECUTIVE_RUN_FAILURE',
  'DELIVERY_UNKNOWN',
] as const satisfies readonly RuntimeEventType[];
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];
export type NotificationSeverity = 'WARN' | 'ERROR';
export type NotificationPayloadEventType = NotificationEventType | 'NOTIFICATION_TEST';

export interface NotificationEventCandidate {
  readonly eventType: RuntimeEventType;
  readonly severity: NotificationSeverity;
  readonly safeMessage: string;
  readonly timestamp: string;
  readonly businessDate?: BusinessDate;
  readonly runId?: string;
  readonly accountId?: string;
  readonly errorCode?: string;
}

export interface NotificationPayload {
  readonly serviceName: 'SparkKeeper';
  readonly eventType: NotificationPayloadEventType;
  readonly severity: NotificationSeverity;
  readonly message: string;
  readonly timestamp: string;
  readonly businessDate?: BusinessDate;
  readonly runId?: string;
  readonly accountId?: string;
  readonly errorCode?: string;
}

export function toNotificationPayload(candidate: NotificationEventCandidate): NotificationPayload {
  return {
    serviceName: 'SparkKeeper',
    eventType: candidate.eventType as NotificationEventType,
    severity: candidate.severity,
    message: candidate.safeMessage,
    timestamp: candidate.timestamp,
    ...(candidate.businessDate === undefined ? {} : { businessDate: candidate.businessDate }),
    ...(candidate.runId === undefined ? {} : { runId: candidate.runId }),
    ...(candidate.accountId === undefined ? {} : { accountId: candidate.accountId }),
    ...(candidate.errorCode === undefined ? {} : { errorCode: candidate.errorCode }),
  };
}

export interface NotificationConfiguration {
  readonly enabled: boolean;
  readonly provider: NotificationProviderType;
  readonly webhookUrl: string | null;
  readonly notifyAuthExpired: boolean;
  readonly notifyTaskFailed: boolean;
  readonly notifyConsecutiveFailure: boolean;
  readonly notifyDeliveryUnknown: boolean;
}

export const DEFAULT_NOTIFICATION_CONFIGURATION: NotificationConfiguration = {
  enabled: false,
  provider: 'WEBHOOK',
  webhookUrl: null,
  notifyAuthExpired: true,
  notifyTaskFailed: true,
  notifyConsecutiveFailure: true,
  notifyDeliveryUnknown: true,
};
