import {
  DAILY_RUN_STATUSES,
  FRIEND_MATCH_FIELDS,
  LOGIN_STATUSES,
  SEND_RECORD_STATUSES,
} from '@sparkkeeper/database';
import { RUNTIME_EVENT_TYPES, SYSTEM_EVENT_LEVELS } from '@sparkkeeper/shared';

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
  required: ['serviceName', 'version', 'status', 'database', 'migration', 'timestamp'],
  properties: {
    serviceName: { const: 'SparkKeeper' },
    version: { type: 'string' },
    status: { type: 'string', enum: ['READY', 'DEGRADED'] },
    database: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['READY', 'UNAVAILABLE'] } },
    },
    migration: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['READY', 'NOT_READY'] } },
    },
    timestamp: isoTimestampSchema,
  },
} as const;

export const runtimeStatusSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'serverStatus',
    'schedulerEnabled',
    'realSendAuthorizationEnabled',
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
    timezone: { type: 'string' },
    databaseReady: { type: 'boolean' },
    migrationReady: { type: 'boolean' },
    observabilityReady: { type: 'boolean' },
    browserProfileConfigured: { type: 'boolean' },
    version: { type: 'string' },
    timestamp: isoTimestampSchema,
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
    matchField: { type: 'string', enum: [...FRIEND_MATCH_FIELDS] },
    enabled: { type: 'boolean' },
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
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
