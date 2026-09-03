import {
  DAILY_RUN_STATUSES,
  FRIEND_MATCH_FIELDS,
  LOGIN_STATUSES,
  SEND_RECORD_STATUSES,
} from '@sparkkeeper/database';
import { MESSAGE_PROVIDER_TYPES } from '@sparkkeeper/message-engine';
import {
  MAX_MAX_ATTEMPTS,
  MAX_RETRY_INTERVAL_SECONDS,
  MIN_MAX_ATTEMPTS,
  MIN_RETRY_INTERVAL_SECONDS,
  RUNTIME_EVENT_TYPES,
  SYSTEM_EVENT_LEVELS,
} from '@sparkkeeper/shared';

const isoTimestampSchema = { type: 'string', format: 'date-time' } as const;
const nullableTimestampSchema = { ...isoTimestampSchema, nullable: true } as const;
const nullableStringSchema = { type: 'string', nullable: true } as const;

export const errorEnvelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'error'],
  properties: {
    success: { const: false },
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
    },
  },
} as const;

export const standardErrorResponses = {
  400: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  500: errorEnvelopeSchema,
} as const;

export const mutationErrorResponses = {
  400: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  415: errorEnvelopeSchema,
  500: errorEnvelopeSchema,
  503: errorEnvelopeSchema,
} as const;

export function successEnvelopeSchema(data: object): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['success', 'data'],
    properties: {
      success: { const: true },
      data,
    },
  };
}

export function idParamsSchema(name: string): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: [name],
    properties: {
      [name]: { type: 'string', format: 'uuid' },
    },
  };
}

export const healthSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['serviceName', 'status'],
  properties: {
    serviceName: { const: 'SparkKeeper' },
    status: { type: 'string', enum: ['READY', 'DEGRADED'] },
  },
} as const;

export const runtimeStatusSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'serverStatus',
    'schedulerEnabled',
    'realSendAuthorizationEnabled',
    'manualRunEnabled',
    'timezone',
    'databaseReady',
    'migrationReady',
    'observabilityReady',
    'browserProfileConfigured',
    'version',
    'timestamp',
  ],
  properties: {
    serverStatus: { type: 'string', enum: ['READY', 'DEGRADED'] },
    schedulerEnabled: { type: 'boolean' },
    realSendAuthorizationEnabled: { type: 'boolean' },
    manualRunEnabled: { type: 'boolean' },
    timezone: { type: 'string' },
    databaseReady: { type: 'boolean' },
    migrationReady: { type: 'boolean' },
    observabilityReady: { type: 'boolean' },
    browserProfileConfigured: { type: 'boolean' },
    version: { type: 'string' },
    timestamp: isoTimestampSchema,
  },
} as const;

export const manualRunPreflightQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['templateId'],
  properties: { templateId: { type: 'string', format: 'uuid' } },
} as const;

export const manualRunRequestBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['templateId', 'acknowledgeRealSend'],
  properties: {
    templateId: { type: 'string', format: 'uuid' },
    acknowledgeRealSend: { type: 'boolean' },
  },
} as const;

export const manualRunPreflightSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'accountId',
    'templateId',
    'businessDate',
    'manualRunEnabled',
    'realSendAuthorizationEnabled',
    'accountEnabled',
    'templateEnabled',
    'enabledFriendCount',
    'scheduleConfigured',
    'currentDailyRunStatus',
    'successfulFriendCount',
    'pendingFriendCount',
    'canRun',
    'blockedReasons',
  ],
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    templateId: { type: 'string', format: 'uuid' },
    businessDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', nullable: true },
    manualRunEnabled: { type: 'boolean' },
    realSendAuthorizationEnabled: { type: 'boolean' },
    accountEnabled: { type: 'boolean' },
    templateEnabled: { type: 'boolean' },
    enabledFriendCount: { type: 'integer', minimum: 0 },
    scheduleConfigured: { type: 'boolean' },
    currentDailyRunStatus: {
      type: 'string',
      enum: [...DAILY_RUN_STATUSES],
      nullable: true,
    },
    successfulFriendCount: { type: 'integer', minimum: 0 },
    pendingFriendCount: { type: 'integer', minimum: 0 },
    canRun: { type: 'boolean' },
    blockedReasons: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'MANUAL_RUN_DISABLED',
          'REAL_SEND_NOT_AUTHORIZED',
          'ACCOUNT_DISABLED',
          'TEMPLATE_DISABLED',
          'NO_ENABLED_FRIENDS',
          'SCHEDULE_NOT_CONFIGURED',
          'RUN_IN_PROGRESS',
          'RUN_ALREADY_COMPLETE',
          'RUN_TERMINAL',
        ],
      },
    },
  },
} as const;

export const manualRunAcceptedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['runId', 'businessDate', 'status'],
  properties: {
    runId: { type: 'string', format: 'uuid' },
    businessDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    status: { const: 'ACCEPTED' },
  },
} as const;

const notificationConfigurationProperties = {
  enabled: { type: 'boolean' },
  provider: { const: 'WEBHOOK' },
  webhookUrl: { type: 'string', minLength: 1, maxLength: 2048, nullable: true },
  notifyAuthExpired: { type: 'boolean' },
  notifyTaskFailed: { type: 'boolean' },
  notifyConsecutiveFailure: { type: 'boolean' },
  notifyDeliveryUnknown: { type: 'boolean' },
} as const;

const notificationConfigurationRequired = [
  'enabled',
  'provider',
  'webhookUrl',
  'notifyAuthExpired',
  'notifyTaskFailed',
  'notifyConsecutiveFailure',
  'notifyDeliveryUnknown',
] as const;

export const notificationConfigurationBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: [...notificationConfigurationRequired],
  properties: notificationConfigurationProperties,
} as const;

export const notificationConfigurationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...notificationConfigurationRequired, 'createdAt', 'updatedAt'],
  properties: {
    ...notificationConfigurationProperties,
    createdAt: nullableTimestampSchema,
    updatedAt: nullableTimestampSchema,
  },
} as const;

export const notificationDeliveryResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'attempts'],
  properties: {
    status: { type: 'string', enum: ['SENT', 'FAILED', 'BLOCKED'] },
    attempts: { type: 'integer', minimum: 0, maximum: 3 },
    failureCode: {
      type: 'string',
      enum: ['TIMEOUT', 'NETWORK_ERROR', 'HTTP_ERROR', 'DESTINATION_BLOCKED', 'INVALID_CONFIG'],
    },
    httpStatus: { type: 'integer', minimum: 100, maximum: 599 },
  },
} as const;

export const accountSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'enabled', 'loginStatus', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    enabled: { type: 'boolean' },
    loginStatus: { type: 'string', enum: [...LOGIN_STATUSES] },
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  },
} as const;

export const friendSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'accountId',
    'displayName',
    'remarkName',
    'shortId',
    'uniqueId',
    'secUid',
    'matchField',
    'enabled',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
    displayName: { type: 'string' },
    remarkName: nullableStringSchema,
    shortId: nullableStringSchema,
    uniqueId: nullableStringSchema,
    secUid: nullableStringSchema,
    matchField: { type: 'string', enum: [...FRIEND_MATCH_FIELDS] },
    enabled: { type: 'boolean' },
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  },
} as const;

const nonblankStringSchema = { type: 'string', minLength: 1 } as const;
const optionalIdentityProperties = {
  remarkName: nullableStringSchema,
  shortId: nullableStringSchema,
  uniqueId: nullableStringSchema,
  secUid: nullableStringSchema,
  matchField: { type: 'string', enum: [...FRIEND_MATCH_FIELDS] },
  enabled: { type: 'boolean' },
} as const;

export const createAccountBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: { name: nonblankStringSchema, enabled: { type: 'boolean' } },
} as const;

export const updateAccountBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: { name: nonblankStringSchema, enabled: { type: 'boolean' } },
} as const;

export const createFriendBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['displayName'],
  properties: { displayName: nonblankStringSchema, ...optionalIdentityProperties },
} as const;

export const updateFriendBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: { displayName: nonblankStringSchema, ...optionalIdentityProperties },
} as const;

export const templateSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'providerType', 'messageCount', 'enabled', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    providerType: { type: 'string', enum: [...MESSAGE_PROVIDER_TYPES] },
    messageCount: { type: 'integer', minimum: 1 },
    enabled: { type: 'boolean' },
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  },
} as const;

export const templateDetailSchema = {
  ...templateSummarySchema,
  required: [...templateSummarySchema.required, 'messages'],
  properties: {
    ...templateSummarySchema.properties,
    messages: { type: 'array', minItems: 1, items: nonblankStringSchema },
  },
} as const;

const templateInputProperties = {
  name: nonblankStringSchema,
  providerType: { type: 'string', enum: [...MESSAGE_PROVIDER_TYPES] },
  messages: { type: 'array', minItems: 1, items: nonblankStringSchema },
  enabled: { type: 'boolean' },
} as const;

export const createTemplateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'providerType', 'messages'],
  properties: templateInputProperties,
} as const;

export const updateTemplateBodySchema = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: templateInputProperties,
} as const;

export const configureScheduleBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['startTime', 'endTime', 'timezone', 'enabled', 'maxAttempts', 'retryIntervalSeconds'],
  properties: {
    startTime: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
    endTime: { type: 'string', pattern: '^(?:[01]\\d|2[0-3]):[0-5]\\d$' },
    timezone: nonblankStringSchema,
    enabled: { type: 'boolean' },
    maxAttempts: {
      type: 'integer',
      minimum: MIN_MAX_ATTEMPTS,
      maximum: MAX_MAX_ATTEMPTS,
    },
    retryIntervalSeconds: {
      type: 'integer',
      minimum: MIN_RETRY_INTERVAL_SECONDS,
      maximum: MAX_RETRY_INTERVAL_SECONDS,
    },
  },
} as const;

export const scheduleSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'accountId',
    'startTime',
    'endTime',
    'timezone',
    'enabled',
    'maxAttempts',
    'retryIntervalSeconds',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    timezone: { type: 'string' },
    enabled: { type: 'boolean' },
    maxAttempts: { type: 'integer' },
    retryIntervalSeconds: { type: 'integer' },
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  },
} as const;

export const dailyRunSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'accountId',
    'businessDate',
    'status',
    'startedAt',
    'finishedAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
    businessDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    status: { type: 'string', enum: [...DAILY_RUN_STATUSES] },
    startedAt: nullableTimestampSchema,
    finishedAt: nullableTimestampSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  },
} as const;

export const sendRecordSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'dailyRunId',
    'friendId',
    'businessDate',
    'status',
    'attempts',
    'failureCode',
    'startedAt',
    'finishedAt',
    'sentAt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    dailyRunId: { type: 'string', format: 'uuid' },
    friendId: { type: 'string', format: 'uuid' },
    businessDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    status: { type: 'string', enum: [...SEND_RECORD_STATUSES] },
    attempts: { type: 'integer', minimum: 0 },
    failureCode: nullableStringSchema,
    startedAt: nullableTimestampSchema,
    finishedAt: nullableTimestampSchema,
    sentAt: nullableTimestampSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  },
} as const;

export const systemEventSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'eventType',
    'level',
    'friendId',
    'attempt',
    'errorCode',
    'message',
    'screenshotEvidenceAvailable',
    'traceEvidenceAvailable',
    'createdAt',
  ],
  properties: {
    eventType: { type: 'string', enum: [...RUNTIME_EVENT_TYPES] },
    level: { type: 'string', enum: [...SYSTEM_EVENT_LEVELS] },
    friendId: { type: 'string', format: 'uuid', nullable: true },
    attempt: { type: 'integer', minimum: 1, nullable: true },
    errorCode: nullableStringSchema,
    message: { type: 'string' },
    screenshotEvidenceAvailable: { type: 'boolean' },
    traceEvidenceAvailable: { type: 'boolean' },
    createdAt: isoTimestampSchema,
  },
} as const;

export const runQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    accountId: { type: 'string', format: 'uuid' },
    businessDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    status: { type: 'string', enum: [...DAILY_RUN_STATUSES] },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  },
} as const;
