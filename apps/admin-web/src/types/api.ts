import type {
  DailyRunStatus,
  FriendMatchField,
  LoginStatus,
  RuntimeEventType,
  SendRecordStatus,
  SystemEventLevel,
  MessageProviderType,
} from '@sparkkeeper/shared';

export interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
}

export interface ApiFailure {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly retryAfter?: number | undefined;
  };
}

export interface AdminUserDto {
  readonly id: string;
  readonly username: string;
}

export interface AuthSessionResponseData {
  readonly admin: AdminUserDto;
  readonly csrfToken: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly recentlyReauthenticated: boolean;
}

export interface LoginInput {
  readonly username: string;
  readonly password: string;
}

export type AuthErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'ORIGIN_REJECTED'
  | 'CSRF_REJECTED'
  | 'REAUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'SERVICE_NOT_INITIALIZED'
  | 'AUTH_SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface Health {
  readonly serviceName: 'SparkKeeper';
  readonly status: 'READY' | 'DEGRADED';
}

export interface RuntimeStatus {
  readonly serverStatus: 'READY' | 'DEGRADED';
  readonly schedulerEnabled: boolean;
  readonly realSendAuthorizationEnabled: boolean;
  readonly manualRunEnabled: boolean;
  readonly timezone: string;
  readonly databaseReady: boolean;
  readonly migrationReady: boolean;
  readonly observabilityReady: boolean;
  readonly browserProfileConfigured: boolean;
  readonly version: string;
  readonly timestamp: string;
}

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly loginStatus: LoginStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Friend {
  readonly id: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly remarkName: string | null;
  readonly shortId: string | null;
  readonly uniqueId: string | null;
  readonly secUid: string | null;
  readonly matchField: FriendMatchField;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Schedule {
  readonly id: string;
  readonly accountId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly retryIntervalSeconds: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageTemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly providerType: MessageProviderType;
  readonly messageCount: number;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageTemplateDetail extends MessageTemplateSummary {
  readonly messages: readonly string[];
}

export interface CreateAccountInput {
  readonly name: string;
  readonly enabled?: boolean;
}

export interface UpdateAccountInput {
  readonly name?: string;
  readonly enabled?: boolean;
}

export interface FriendConfigurationInput {
  readonly displayName: string;
  readonly remarkName?: string | null;
  readonly shortId?: string | null;
  readonly uniqueId?: string | null;
  readonly secUid?: string | null;
  readonly matchField?: FriendMatchField;
  readonly enabled?: boolean;
}

export type UpdateFriendInput = Partial<FriendConfigurationInput>;

export interface MessageTemplateInput {
  readonly name: string;
  readonly providerType: MessageProviderType;
  readonly messages: readonly string[];
  readonly enabled?: boolean;
}

export type UpdateMessageTemplateInput = Partial<MessageTemplateInput>;

export interface ConfigureScheduleInput {
  readonly startTime: string;
  readonly endTime: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly retryIntervalSeconds: number;
}

export interface DailyRun {
  readonly id: string;
  readonly accountId: string;
  readonly businessDate: string;
  readonly status: DailyRunStatus;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SendRecord {
  readonly id: string;
  readonly dailyRunId: string;
  readonly friendId: string;
  readonly businessDate: string;
  readonly status: SendRecordStatus;
  readonly attempts: number;
  readonly failureCode: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SystemEvent {
  readonly eventType: RuntimeEventType;
  readonly level: SystemEventLevel;
  readonly friendId: string | null;
  readonly attempt: number | null;
  readonly errorCode: string | null;
  readonly message: string;
  readonly screenshotEvidenceAvailable: boolean;
  readonly traceEvidenceAvailable: boolean;
  readonly createdAt: string;
}

export interface RunFilters {
  readonly accountId?: string;
  readonly businessDate?: string;
  readonly status?: DailyRunStatus;
  readonly limit?: 25 | 50 | 100;
}

export type ManualRunBlockedReason =
  | 'MANUAL_RUN_DISABLED'
  | 'REAL_SEND_NOT_AUTHORIZED'
  | 'ACCOUNT_DISABLED'
  | 'TEMPLATE_DISABLED'
  | 'NO_ENABLED_FRIENDS'
  | 'SCHEDULE_NOT_CONFIGURED'
  | 'RUN_IN_PROGRESS'
  | 'RUN_ALREADY_COMPLETE'
  | 'RUN_TERMINAL';

export interface ManualRunPreflight {
  readonly accountId: string;
  readonly templateId: string;
  readonly businessDate: string | null;
  readonly manualRunEnabled: boolean;
  readonly realSendAuthorizationEnabled: boolean;
  readonly accountEnabled: boolean;
  readonly templateEnabled: boolean;
  readonly enabledFriendCount: number;
  readonly scheduleConfigured: boolean;
  readonly currentDailyRunStatus: DailyRunStatus | null;
  readonly successfulFriendCount: number;
  readonly pendingFriendCount: number;
  readonly canRun: boolean;
  readonly blockedReasons: readonly ManualRunBlockedReason[];
}

export interface ManualRunAccepted {
  readonly runId: string;
  readonly businessDate: string;
  readonly status: 'ACCEPTED';
}

export interface ManualRunRequest {
  readonly templateId: string;
  readonly acknowledgeRealSend: true;
}

export interface NotificationConfigurationInput {
  readonly enabled: boolean;
  readonly provider: 'WEBHOOK';
  readonly webhookUrl: string | null;
  readonly notifyAuthExpired: boolean;
  readonly notifyTaskFailed: boolean;
  readonly notifyConsecutiveFailure: boolean;
  readonly notifyDeliveryUnknown: boolean;
}

export interface NotificationConfiguration extends NotificationConfigurationInput {
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export type NotificationDeliveryResult =
  | { readonly status: 'SENT'; readonly attempts: number; readonly httpStatus: number }
  | {
      readonly status: 'FAILED';
      readonly attempts: number;
      readonly failureCode: 'TIMEOUT' | 'NETWORK_ERROR' | 'HTTP_ERROR';
      readonly httpStatus?: number;
    }
  | {
      readonly status: 'BLOCKED';
      readonly attempts: 0;
      readonly failureCode: 'DESTINATION_BLOCKED' | 'INVALID_CONFIG';
    };

export type RealtimeConnectionState = 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

export type ConfigEntityType = 'ACCOUNT' | 'FRIEND' | 'TEMPLATE' | 'SCHEDULE' | 'NOTIFICATION';

export interface RealtimeReadyEvent {
  readonly id: string;
  readonly type: 'READY';
  readonly timestamp: string;
  readonly data: { readonly serviceStatus: 'READY' };
}

export interface RealtimeRuntimeEvent {
  readonly id: string;
  readonly type: 'RUNTIME_EVENT';
  readonly timestamp: string;
  readonly data: {
    readonly eventType: RuntimeEventType;
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly message: string;
    readonly runId?: string;
    readonly accountId?: string;
    readonly friendId?: string;
    readonly businessDate?: string;
    readonly attempt?: number;
    readonly errorCode?: string;
    readonly nextRetryAt?: string;
    readonly successCount?: number;
    readonly failedCount?: number;
    readonly retryWaitCount?: number;
    readonly idempotentSkipCount?: number;
    readonly runResult?: 'SUCCESS' | 'FAILED' | 'AUTH_EXPIRED' | 'RETRY_WAIT' | 'SKIPPED';
  };
}

export interface RealtimeConfigEvent {
  readonly id: string;
  readonly type: 'CONFIG_CHANGED';
  readonly timestamp: string;
  readonly data: {
    readonly entityType: ConfigEntityType;
    readonly entityId: string;
    readonly accountId?: string;
  };
}

export type RealtimeEvent = RealtimeReadyEvent | RealtimeRuntimeEvent | RealtimeConfigEvent;

export type {
  DailyRunStatus,
  FriendMatchField,
  LoginStatus,
  MessageProviderType,
  RuntimeEventType,
  SendRecordStatus,
  SystemEventLevel,
};
