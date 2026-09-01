/** Login-state metadata shared by automation and persistence boundaries. */
export type LoginStatus = 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN';

/** Identity metadata that can be shared without database or browser dependencies. */
export interface FriendIdentity {
  readonly displayName: string;
  readonly remarkName?: string | null;
  readonly shortId?: string | null;
  readonly uniqueId?: string | null;
  readonly secUid?: string | null;
}

/** The single normalized identity field currently used to bind a Friend. */
export type FriendMatchField = 'displayName' | 'remarkName' | 'shortId' | 'uniqueId' | 'secUid';

/** Message provider kinds supported by the V1 template engine. */
export type MessageProviderType = 'STATIC' | 'RANDOM';

/** Persisted message template domain object shared by persistence and generation boundaries. */
export interface MessageTemplate {
  readonly id: string;
  readonly name: string;
  readonly providerType: MessageProviderType;
  readonly messages: readonly string[];
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export {
  BusinessDateError,
  DEFAULT_APP_TIMEZONE,
  parseBusinessDate,
  resolveBusinessDate,
  resolveBusinessTimeZone,
  type BusinessDate,
  type BusinessDateErrorCode,
} from './BusinessDate.js';

export type DailyRunStatus = 'READY' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'AUTH_EXPIRED';

export type SendRecordStatus =
  'READY' | 'RUNNING' | 'RETRY_WAIT' | 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN';

export {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_INTERVAL_SECONDS,
  MAX_MAX_ATTEMPTS,
  MAX_RETRY_INTERVAL_SECONDS,
  MIN_MAX_ATTEMPTS,
  MIN_RETRY_INTERVAL_SECONDS,
  RetryConfigurationError,
  validateMaxAttempts,
  validateRetryIntervalSeconds,
  type ExternalActionState,
  type RetryFailureCode,
} from './Retry.js';

export {
  parseScheduleTime,
  ScheduleTimeError,
  scheduleTimeToMinutes,
  validateScheduleWindow,
  type ScheduleTime,
} from './ScheduleTime.js';

export {
  isRuntimeEventType,
  isSystemEventLevel,
  RUNTIME_EVENT_TYPES,
  SYSTEM_EVENT_LEVELS,
  type RuntimeEventType,
  type SystemEventLevel,
} from './RuntimeEvent.js';

export {
  ADMIN_USER_STATUSES,
  AdminValidationError,
  isAdminUserStatus,
  normalizeAdminUsername,
  validateAdminUsername,
  type AdminUserStatus,
} from './Admin.js';

export {
  ACCOUNT_LIFECYCLE_STATUSES,
  ACCOUNT_LOGIN_FAILURE_CODES,
  ACCOUNT_LOGIN_PURPOSES,
  ACCOUNT_LOGIN_SESSION_STATUSES,
  ACCOUNT_PROFILE_STATES,
  AccountValidationError,
  isAccountLifecycleStatus,
  isAccountLoginFailureCode,
  isAccountLoginPurpose,
  isAccountLoginSessionStatus,
  isAccountProfileState,
  normalizeOptionalIdentifier,
  validateAccountName,
  type AccountLifecycleStatus,
  type AccountLoginFailureCode,
  type AccountLoginPurpose,
  type AccountLoginSessionStatus,
  type AccountProfileState,
} from './Account.js';

export {
  CONTACT_AVAILABILITY_STATUSES,
  CONTACT_IDENTITY_KINDS,
  CONTACT_IDENTITY_SOURCES,
  CONTACT_IDENTITY_STATES,
  CONTACT_IDENTITY_STATUSES,
  CONTACT_SYNC_FAILURE_CODES,
  CONTACT_SYNC_RUN_STATUSES,
  CONTACT_TYPES,
  ContactValidationError,
  isContactAvailabilityStatus,
  isContactIdentityKind,
  isContactIdentitySource,
  isContactIdentityState,
  isContactIdentityStatus,
  isContactSyncFailureCode,
  isContactSyncRunStatus,
  isContactType,
  validateContactDisplayName,
  validateIdentityValue,
  validateOptionalContactString,
  validateStreakDays,
  type ContactAvailabilityStatus,
  type ContactIdentityKind,
  type ContactIdentitySource,
  type ContactIdentityState,
  type ContactIdentityStatus,
  type ContactSyncFailureCode,
  type ContactSyncRunStatus,
  type ContactType,
} from './Contact.js';

export {
  DEFAULT_TASK_MAX_ATTEMPTS,
  DEFAULT_TASK_RETRY_INTERVAL_SECONDS,
  MAX_TASK_MAX_ATTEMPTS,
  MAX_TASK_RETRY_INTERVAL_SECONDS,
  MIN_TASK_MAX_ATTEMPTS,
  MIN_TASK_RETRY_INTERVAL_SECONDS,
  SEND_TASK_SCHEDULE_TYPES,
  SendTaskValidationError,
  isSendTaskScheduleType,
  validateSendTaskMaxAttempts,
  validateSendTaskName,
  validateSendTaskRetryIntervalSeconds,
  validateSendTaskScheduleWindow,
  validateSendTaskTimeZone,
  type SendTaskScheduleType,
} from './SendTask.js';

export {
  DELIVERY_RESOLUTION_SOURCES,
  DELIVERY_RESOLUTION_VALUES,
  EXECUTION_RUN_KINDS,
  EXECUTION_RUN_STATUSES,
  ExecutionValidationError,
  LEGACY_BINDING_STATUSES,
  LEGACY_SCHEDULE_IMPORT_STATUSES,
  TARGET_SEND_FAILURE_CODES,
  TARGET_SEND_MACHINE_STATUSES,
  isDeliveryResolutionSource,
  isDeliveryResolutionValue,
  isExecutionRunKind,
  isExecutionRunStatus,
  isLegacyBindingStatus,
  isLegacyScheduleImportStatus,
  isTargetSendFailureCode,
  isTargetSendMachineStatus,
  validateIdempotencyKey,
  validateResolutionNote,
  type DeliveryResolutionSource,
  type DeliveryResolutionValue,
  type ExecutionRunKind,
  type ExecutionRunStatus,
  type LegacyBindingStatus,
  type LegacyScheduleImportStatus,
  type TargetSendFailureCode,
  type TargetSendMachineStatus,
} from './Execution.js';

export {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AUDIT_OUTCOMES,
  AuditValidationError,
  isAuditAction,
  isAuditEntityType,
  isAuditOutcome,
  validateAuditReasonCode,
  validateCorrelationDigest,
  type AuditAction,
  type AuditEntityType,
  type AuditOutcome,
} from './Audit.js';
