import type {
  Account,
  DailyRun,
  Friend,
  Health,
  MessageTemplateDetail,
  MessageTemplateSummary,
  RuntimeStatus,
  Schedule,
  SendRecord,
  SystemEvent,
} from '../types/api';

export type Parser<T> = (value: unknown) => T | undefined;

const LOGIN_STATUSES = ['READY', 'AUTH_EXPIRED', 'UNKNOWN'] as const;
const MATCH_FIELDS = ['displayName', 'remarkName', 'shortId', 'uniqueId', 'secUid'] as const;
const MESSAGE_PROVIDER_TYPES = ['STATIC', 'RANDOM'] as const;
const RUN_STATUSES = ['READY', 'RUNNING', 'SUCCESS', 'FAILED', 'AUTH_EXPIRED'] as const;
const SEND_STATUSES = [
  'READY',
  'RUNNING',
  'RETRY_WAIT',
  'SUCCESS',
  'FAILED',
  'DELIVERY_UNKNOWN',
] as const;
const EVENT_LEVELS = ['INFO', 'WARN', 'ERROR'] as const;
const EVENT_TYPES = [
  'RUN_STARTED',
  'RUN_FINISHED',
  'AUTH_CHECKING',
  'AUTH_EXPIRED',
  'AUTH_UNKNOWN',
  'FRIEND_RESOLVING',
  'CONTACT_NOT_FOUND',
  'AMBIGUOUS_CONTACT',
  'MESSAGE_BUILDING',
  'MESSAGE_SENDING',
  'VERIFYING',
  'VERIFY_SUCCESS',
  'RETRY_WAIT',
  'TASK_FAILED',
  'SELECTOR_FAILURE',
  'BROWSER_ERROR',
  'DELIVERY_UNKNOWN',
  'CONVERSATION_VERIFICATION_FAILED',
  'SKIPPED_IDEMPOTENT',
  'CONSECUTIVE_RUN_FAILURE',
  'OBSERVABILITY_ERROR',
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : string(value);
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : number(value);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] | undefined {
  return typeof value === 'string' && values.some((candidate) => candidate === value)
    ? (value as T[number])
    : undefined;
}

function arrayOf<T>(value: unknown, parser: Parser<T>): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: T[] = [];
  for (const item of value) {
    const result = parser(item);
    if (result === undefined) return undefined;
    parsed.push(result);
  }
  return parsed;
}

export const parseHealth: Parser<Health> = (value) => {
  const data = record(value);
  const database = record(data?.database);
  const migration = record(data?.migration);
  const version = string(data?.version);
  const timestamp = string(data?.timestamp);
  const status = oneOf(data?.status, ['READY', 'DEGRADED'] as const);
  const databaseStatus = oneOf(database?.status, ['READY', 'UNAVAILABLE'] as const);
  const migrationStatus = oneOf(migration?.status, ['READY', 'NOT_READY'] as const);
  if (
    data?.serviceName !== 'SparkKeeper' ||
    version === undefined ||
    timestamp === undefined ||
    status === undefined ||
    databaseStatus === undefined ||
    migrationStatus === undefined
  )
    return undefined;
  return {
    serviceName: 'SparkKeeper',
    version,
    status,
    database: { status: databaseStatus },
    migration: { status: migrationStatus },
    timestamp,
  };
};

export const parseRuntimeStatus: Parser<RuntimeStatus> = (value) => {
  const data = record(value);
  const serverStatus = oneOf(data?.serverStatus, ['READY', 'DEGRADED'] as const);
  const schedulerEnabled = boolean(data?.schedulerEnabled);
  const realSendAuthorizationEnabled = boolean(data?.realSendAuthorizationEnabled);
  const timezone = string(data?.timezone);
  const databaseReady = boolean(data?.databaseReady);
  const migrationReady = boolean(data?.migrationReady);
  const observabilityReady = boolean(data?.observabilityReady);
  const browserProfileConfigured = boolean(data?.browserProfileConfigured);
  const version = string(data?.version);
  const timestamp = string(data?.timestamp);
  if (
    serverStatus === undefined ||
    schedulerEnabled === undefined ||
    realSendAuthorizationEnabled === undefined ||
    timezone === undefined ||
    databaseReady === undefined ||
    migrationReady === undefined ||
    observabilityReady === undefined ||
    browserProfileConfigured === undefined ||
    version === undefined ||
    timestamp === undefined
  )
    return undefined;
  return {
    serverStatus,
    schedulerEnabled,
    realSendAuthorizationEnabled,
    timezone,
    databaseReady,
    migrationReady,
    observabilityReady,
    browserProfileConfigured,
    version,
    timestamp,
  };
};

export const parseAccount: Parser<Account> = (value) => {
  const data = record(value);
  const id = string(data?.id);
  const name = string(data?.name);
  const enabled = boolean(data?.enabled);
  const loginStatus = oneOf(data?.loginStatus, LOGIN_STATUSES);
  const createdAt = string(data?.createdAt);
  const updatedAt = string(data?.updatedAt);
  if ([id, name, enabled, loginStatus, createdAt, updatedAt].some((item) => item === undefined)) {
    return undefined;
  }
  return {
    id: id!,
    name: name!,
    enabled: enabled!,
    loginStatus: loginStatus!,
    createdAt: createdAt!,
    updatedAt: updatedAt!,
  };
};

export const parseFriend: Parser<Friend> = (value) => {
  const data = record(value);
  const id = string(data?.id);
  const accountId = string(data?.accountId);
  const displayName = string(data?.displayName);
  const remarkName = nullableString(data?.remarkName);
  const shortId = nullableString(data?.shortId);
  const uniqueId = nullableString(data?.uniqueId);
  const secUid = nullableString(data?.secUid);
  const matchField = oneOf(data?.matchField, MATCH_FIELDS);
  const enabled = boolean(data?.enabled);
  const createdAt = string(data?.createdAt);
  const updatedAt = string(data?.updatedAt);
  if (
    [
      id,
      accountId,
      displayName,
      remarkName,
      shortId,
      uniqueId,
      secUid,
      matchField,
      enabled,
      createdAt,
      updatedAt,
    ].some((item) => item === undefined)
  )
    return undefined;
  return {
    id: id!,
    accountId: accountId!,
    displayName: displayName!,
    remarkName: remarkName!,
    shortId: shortId!,
    uniqueId: uniqueId!,
    secUid: secUid!,
    matchField: matchField!,
    enabled: enabled!,
    createdAt: createdAt!,
    updatedAt: updatedAt!,
  };
};

export const parseMessageTemplateSummary: Parser<MessageTemplateSummary> = (value) => {
  const data = record(value);
  const id = string(data?.id);
  const name = string(data?.name);
  const providerType = oneOf(data?.providerType, MESSAGE_PROVIDER_TYPES);
  const messageCount = number(data?.messageCount);
  const enabled = boolean(data?.enabled);
  const createdAt = string(data?.createdAt);
  const updatedAt = string(data?.updatedAt);
  if (
    [id, name, providerType, messageCount, enabled, createdAt, updatedAt].some(
      (item) => item === undefined,
    )
  )
    return undefined;
  return {
    id: id!,
    name: name!,
    providerType: providerType!,
    messageCount: messageCount!,
    enabled: enabled!,
    createdAt: createdAt!,
    updatedAt: updatedAt!,
  };
};

export const parseMessageTemplateDetail: Parser<MessageTemplateDetail> = (value) => {
  const summary = parseMessageTemplateSummary(value);
  const data = record(value);
  const messages = arrayOf(data?.messages, string);
  if (summary === undefined || messages === undefined) return undefined;
  return { ...summary, messages };
};

export const parseSchedule: Parser<Schedule> = (value) => {
  const data = record(value);
  const id = string(data?.id);
  const accountId = string(data?.accountId);
  const startTime = string(data?.startTime);
  const endTime = string(data?.endTime);
  const timezone = string(data?.timezone);
  const enabled = boolean(data?.enabled);
  const maxAttempts = number(data?.maxAttempts);
  const retryIntervalSeconds = number(data?.retryIntervalSeconds);
  const createdAt = string(data?.createdAt);
  const updatedAt = string(data?.updatedAt);
  if (
    [
      id,
      accountId,
      startTime,
      endTime,
      timezone,
      enabled,
      maxAttempts,
      retryIntervalSeconds,
      createdAt,
      updatedAt,
    ].some((item) => item === undefined)
  )
    return undefined;
  return {
    id: id!,
    accountId: accountId!,
    startTime: startTime!,
    endTime: endTime!,
    timezone: timezone!,
    enabled: enabled!,
    maxAttempts: maxAttempts!,
    retryIntervalSeconds: retryIntervalSeconds!,
    createdAt: createdAt!,
    updatedAt: updatedAt!,
  };
};

export const parseDailyRun: Parser<DailyRun> = (value) => {
  const data = record(value);
  const id = string(data?.id);
  const accountId = string(data?.accountId);
  const businessDate = string(data?.businessDate);
  const status = oneOf(data?.status, RUN_STATUSES);
  const startedAt = nullableString(data?.startedAt);
  const finishedAt = nullableString(data?.finishedAt);
  const createdAt = string(data?.createdAt);
  const updatedAt = string(data?.updatedAt);
  if (
    [id, accountId, businessDate, status, startedAt, finishedAt, createdAt, updatedAt].some(
      (item) => item === undefined,
    )
  )
    return undefined;
  return {
    id: id!,
    accountId: accountId!,
    businessDate: businessDate!,
    status: status!,
    startedAt: startedAt!,
    finishedAt: finishedAt!,
    createdAt: createdAt!,
    updatedAt: updatedAt!,
  };
};

export const parseSendRecord: Parser<SendRecord> = (value) => {
  const data = record(value);
  const id = string(data?.id);
  const dailyRunId = string(data?.dailyRunId);
  const friendId = string(data?.friendId);
  const businessDate = string(data?.businessDate);
  const status = oneOf(data?.status, SEND_STATUSES);
  const attempts = number(data?.attempts);
  const failureCode = nullableString(data?.failureCode);
  const startedAt = nullableString(data?.startedAt);
  const finishedAt = nullableString(data?.finishedAt);
  const sentAt = nullableString(data?.sentAt);
  const createdAt = string(data?.createdAt);
  const updatedAt = string(data?.updatedAt);
  if (
    [
      id,
      dailyRunId,
      friendId,
      businessDate,
      status,
      attempts,
      failureCode,
      startedAt,
      finishedAt,
      sentAt,
      createdAt,
      updatedAt,
    ].some((item) => item === undefined)
  )
    return undefined;
  return {
    id: id!,
    dailyRunId: dailyRunId!,
    friendId: friendId!,
    businessDate: businessDate!,
    status: status!,
    attempts: attempts!,
    failureCode: failureCode!,
    startedAt: startedAt!,
    finishedAt: finishedAt!,
    sentAt: sentAt!,
    createdAt: createdAt!,
    updatedAt: updatedAt!,
  };
};

export const parseSystemEvent: Parser<SystemEvent> = (value) => {
  const data = record(value);
  const eventType = oneOf(data?.eventType, EVENT_TYPES);
  const level = oneOf(data?.level, EVENT_LEVELS);
  const friendId = nullableString(data?.friendId);
  const attempt = nullableNumber(data?.attempt);
  const errorCode = nullableString(data?.errorCode);
  const message = string(data?.message);
  const screenshotEvidenceAvailable = boolean(data?.screenshotEvidenceAvailable);
  const traceEvidenceAvailable = boolean(data?.traceEvidenceAvailable);
  const createdAt = string(data?.createdAt);
  if (
    [
      eventType,
      level,
      friendId,
      attempt,
      errorCode,
      message,
      screenshotEvidenceAvailable,
      traceEvidenceAvailable,
      createdAt,
    ].some((item) => item === undefined)
  )
    return undefined;
  return {
    eventType: eventType!,
    level: level!,
    friendId: friendId!,
    attempt: attempt!,
    errorCode: errorCode!,
    message: message!,
    screenshotEvidenceAvailable: screenshotEvidenceAvailable!,
    traceEvidenceAvailable: traceEvidenceAvailable!,
    createdAt: createdAt!,
  };
};

export const parseAccounts: Parser<Account[]> = (value) => arrayOf(value, parseAccount);
export const parseFriends: Parser<Friend[]> = (value) => arrayOf(value, parseFriend);
export const parseSchedules: Parser<Schedule[]> = (value) => arrayOf(value, parseSchedule);
export const parseMessageTemplateSummaries: Parser<MessageTemplateSummary[]> = (value) =>
  arrayOf(value, parseMessageTemplateSummary);
export const parseDailyRuns: Parser<DailyRun[]> = (value) => arrayOf(value, parseDailyRun);
export const parseSendRecords: Parser<SendRecord[]> = (value) => arrayOf(value, parseSendRecord);
export const parseSystemEvents: Parser<SystemEvent[]> = (value) => arrayOf(value, parseSystemEvent);
