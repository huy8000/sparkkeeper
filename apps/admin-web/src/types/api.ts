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
  };
}

export interface Health {
  readonly serviceName: 'SparkKeeper';
  readonly version: string;
  readonly status: 'READY' | 'DEGRADED';
  readonly database: { readonly status: 'READY' | 'UNAVAILABLE' };
  readonly migration: { readonly status: 'READY' | 'NOT_READY' };
  readonly timestamp: string;
}

export interface RuntimeStatus {
  readonly serverStatus: 'READY' | 'DEGRADED';
  readonly schedulerEnabled: boolean;
  readonly realSendAuthorizationEnabled: boolean;
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

export type {
  DailyRunStatus,
  FriendMatchField,
  LoginStatus,
  MessageProviderType,
  RuntimeEventType,
  SendRecordStatus,
  SystemEventLevel,
};
