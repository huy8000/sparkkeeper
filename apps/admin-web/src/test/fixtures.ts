import type {
  Account,
  DailyRun,
  Friend,
  Health,
  MessageTemplateDetail,
  MessageTemplateSummary,
  ManualRunAccepted,
  ManualRunPreflight,
  RuntimeStatus,
  Schedule,
  SendRecord,
  SystemEvent,
} from '../types/api';

export const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
export const FRIEND_ID = '00000000-0000-4000-8000-000000000002';
export const SCHEDULE_ID = '00000000-0000-4000-8000-000000000003';
export const RUN_ID = '00000000-0000-4000-8000-000000000004';
export const RECORD_ID = '00000000-0000-4000-8000-000000000005';
export const TEMPLATE_ID = '00000000-0000-4000-8000-000000000006';
const CREATED_AT = '2026-01-02T03:04:05.000Z';

export const healthFixture: Health = {
  serviceName: 'SparkKeeper',
  version: '2.0.0-test',
  status: 'READY',
  database: { status: 'READY' },
  migration: { status: 'READY' },
  timestamp: CREATED_AT,
};

export const runtimeFixture: RuntimeStatus = {
  serverStatus: 'READY',
  schedulerEnabled: false,
  realSendAuthorizationEnabled: false,
  manualRunEnabled: false,
  timezone: 'Asia/Shanghai',
  databaseReady: true,
  migrationReady: true,
  observabilityReady: true,
  browserProfileConfigured: true,
  version: '2.0.0-test',
  timestamp: CREATED_AT,
};

export const accountFixture: Account = {
  id: ACCOUNT_ID,
  name: 'Demo Account',
  enabled: true,
  loginStatus: 'READY',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const friendFixture: Friend = {
  id: FRIEND_ID,
  accountId: ACCOUNT_ID,
  displayName: 'Demo Contact Alpha',
  remarkName: null,
  shortId: 'demo-alpha',
  uniqueId: null,
  secUid: null,
  matchField: 'shortId',
  enabled: false,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const scheduleFixture: Schedule = {
  id: SCHEDULE_ID,
  accountId: ACCOUNT_ID,
  startTime: '09:00',
  endTime: '10:30',
  timezone: 'Asia/Shanghai',
  enabled: true,
  maxAttempts: 3,
  retryIntervalSeconds: 30,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const templateSummaryFixture: MessageTemplateSummary = {
  id: TEMPLATE_ID,
  name: 'Demo Template',
  providerType: 'STATIC',
  messageCount: 1,
  enabled: true,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const templateDetailFixture: MessageTemplateDetail = {
  ...templateSummaryFixture,
  messages: ['Fictional template editor content.'],
};

export const manualRunPreflightFixture: ManualRunPreflight = {
  accountId: ACCOUNT_ID,
  templateId: TEMPLATE_ID,
  businessDate: '2026-01-02',
  manualRunEnabled: true,
  realSendAuthorizationEnabled: true,
  accountEnabled: true,
  templateEnabled: true,
  enabledFriendCount: 2,
  scheduleConfigured: true,
  currentDailyRunStatus: null,
  successfulFriendCount: 0,
  pendingFriendCount: 2,
  canRun: true,
  blockedReasons: [],
};

export const manualRunAcceptedFixture: ManualRunAccepted = {
  runId: RUN_ID,
  businessDate: '2026-01-02',
  status: 'ACCEPTED',
};

export const runFixture: DailyRun = {
  id: RUN_ID,
  accountId: ACCOUNT_ID,
  businessDate: '2026-01-02',
  status: 'SUCCESS',
  startedAt: CREATED_AT,
  finishedAt: '2026-01-02T03:05:05.000Z',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const sendRecordFixture: SendRecord = {
  id: RECORD_ID,
  dailyRunId: RUN_ID,
  friendId: FRIEND_ID,
  businessDate: '2026-01-02',
  status: 'FAILED',
  attempts: 3,
  failureCode: 'TEST_FAILURE',
  startedAt: CREATED_AT,
  finishedAt: '2026-01-02T03:05:00.000Z',
  sentAt: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export const systemEventFixture: SystemEvent = {
  eventType: 'TASK_FAILED',
  level: 'ERROR',
  friendId: FRIEND_ID,
  attempt: 3,
  errorCode: 'TEST_FAILURE',
  message: 'A safe test event summary.',
  screenshotEvidenceAvailable: true,
  traceEvidenceAvailable: true,
  createdAt: CREATED_AT,
};
