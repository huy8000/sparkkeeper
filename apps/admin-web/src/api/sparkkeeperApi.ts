import type {
  Account,
  AuthSessionResponseData,
  ConfigureScheduleInput,
  CreateAccountInput,
  DailyRun,
  Friend,
  FriendConfigurationInput,
  Health,
  LoginInput,
  RunFilters,
  RuntimeStatus,
  Schedule,
  SendRecord,
  SystemEvent,
  MessageTemplateDetail,
  MessageTemplateInput,
  MessageTemplateSummary,
  ManualRunAccepted,
  ManualRunPreflight,
  ManualRunRequest,
  NotificationConfiguration,
  NotificationConfigurationInput,
  NotificationDeliveryResult,
  UpdateAccountInput,
  UpdateFriendInput,
  UpdateMessageTemplateInput,
} from '../types/api';
import { ApiClient, type ApiClientOptions, type FetchImplementation } from './client';
import {
  parseAccount,
  parseAccounts,
  parseAuthSessionResponse,
  parseDailyRun,
  parseDailyRuns,
  parseFriend,
  parseFriends,
  parseHealth,
  parseMessageTemplateDetail,
  parseMessageTemplateSummaries,
  parseManualRunAccepted,
  parseManualRunPreflight,
  parseNoContent,
  parseNotificationConfiguration,
  parseNotificationDeliveryResult,
  parseRuntimeStatus,
  parseSchedule,
  parseSchedules,
  parseSendRecords,
  parseSystemEvents,
} from './parsers';

export interface SparkKeeperApi {
  // Auth routes
  login(input: LoginInput, signal?: AbortSignal): Promise<AuthSessionResponseData>;
  getCurrentUser(signal?: AbortSignal): Promise<AuthSessionResponseData>;
  logout(signal?: AbortSignal): Promise<void>;

  // App routes
  getHealth(signal?: AbortSignal): Promise<Health>;
  getRuntimeStatus(signal?: AbortSignal): Promise<RuntimeStatus>;
  listAccounts(signal?: AbortSignal): Promise<Account[]>;
  getAccount(accountId: string, signal?: AbortSignal): Promise<Account>;
  createAccount(input: CreateAccountInput, signal?: AbortSignal): Promise<Account>;
  updateAccount(
    accountId: string,
    input: UpdateAccountInput,
    signal?: AbortSignal,
  ): Promise<Account>;
  listFriends(accountId: string, signal?: AbortSignal): Promise<Friend[]>;
  createFriend(
    accountId: string,
    input: FriendConfigurationInput,
    signal?: AbortSignal,
  ): Promise<Friend>;
  updateFriend(friendId: string, input: UpdateFriendInput, signal?: AbortSignal): Promise<Friend>;
  listSchedules(accountId: string, signal?: AbortSignal): Promise<Schedule[]>;
  configureSchedule(
    accountId: string,
    input: ConfigureScheduleInput,
    signal?: AbortSignal,
  ): Promise<Schedule>;
  listTemplates(signal?: AbortSignal): Promise<MessageTemplateSummary[]>;
  getTemplate(templateId: string, signal?: AbortSignal): Promise<MessageTemplateDetail>;
  createTemplate(input: MessageTemplateInput, signal?: AbortSignal): Promise<MessageTemplateDetail>;
  updateTemplate(
    templateId: string,
    input: UpdateMessageTemplateInput,
    signal?: AbortSignal,
  ): Promise<MessageTemplateDetail>;
  listRuns(filters: RunFilters, signal?: AbortSignal): Promise<DailyRun[]>;
  getRun(runId: string, signal?: AbortSignal): Promise<DailyRun>;
  listSendRecords(runId: string, signal?: AbortSignal): Promise<SendRecord[]>;
  listSystemEvents(runId: string, signal?: AbortSignal): Promise<SystemEvent[]>;
  getManualRunPreflight(
    accountId: string,
    templateId: string,
    signal?: AbortSignal,
  ): Promise<ManualRunPreflight>;
  startManualRun(
    accountId: string,
    input: ManualRunRequest,
    signal?: AbortSignal,
  ): Promise<ManualRunAccepted>;
  getNotificationConfiguration(signal?: AbortSignal): Promise<NotificationConfiguration>;
  updateNotificationConfiguration(
    input: NotificationConfigurationInput,
    signal?: AbortSignal,
  ): Promise<NotificationConfiguration>;
  sendTestNotification(signal?: AbortSignal): Promise<NotificationDeliveryResult>;
}

export function createSparkKeeperApi(
  optionsOrBaseUrl?: string | ApiClientOptions,
  fetchImplementation?: FetchImplementation,
): SparkKeeperApi {
  const client = new ApiClient(optionsOrBaseUrl, fetchImplementation);

  return {
    login: (input, signal) => client.login('/auth/login', input, parseAuthSessionResponse, signal),
    getCurrentUser: (signal) => client.get('/auth/me', parseAuthSessionResponse, signal),
    logout: (signal) => client.mutate('POST', '/auth/logout', {}, parseNoContent, signal),

    getHealth: (signal) => client.get('/health', parseHealth, signal),
    getRuntimeStatus: (signal) => client.get('/runtime/status', parseRuntimeStatus, signal),
    listAccounts: (signal) => client.get('/accounts', parseAccounts, signal),
    getAccount: (accountId, signal) =>
      client.get(`/accounts/${encodeURIComponent(accountId)}`, parseAccount, signal),
    createAccount: (input, signal) =>
      client.mutate('POST', '/accounts', input, parseAccount, signal),
    updateAccount: (accountId, input, signal) =>
      client.mutate(
        'PATCH',
        `/accounts/${encodeURIComponent(accountId)}`,
        input,
        parseAccount,
        signal,
      ),
    listFriends: (accountId, signal) =>
      client.get(`/accounts/${encodeURIComponent(accountId)}/friends`, parseFriends, signal),
    createFriend: (accountId, input, signal) =>
      client.mutate(
        'POST',
        `/accounts/${encodeURIComponent(accountId)}/friends`,
        input,
        parseFriend,
        signal,
      ),
    updateFriend(friendId, input, signal) {
      return client.mutate(
        'PATCH',
        `/friends/${encodeURIComponent(friendId)}`,
        input,
        parseFriend,
        signal,
      );
    },
    listSchedules: (accountId, signal) =>
      client.get(`/accounts/${encodeURIComponent(accountId)}/schedules`, parseSchedules, signal),
    configureSchedule: (accountId, input, signal) =>
      client.mutate(
        'PUT',
        `/accounts/${encodeURIComponent(accountId)}/schedule`,
        input,
        parseSchedule,
        signal,
      ),
    listTemplates: (signal) => client.get('/templates', parseMessageTemplateSummaries, signal),
    getTemplate: (templateId, signal) =>
      client.get(
        `/templates/${encodeURIComponent(templateId)}`,
        parseMessageTemplateDetail,
        signal,
      ),
    createTemplate: (input, signal) =>
      client.mutate('POST', '/templates', input, parseMessageTemplateDetail, signal),
    updateTemplate: (templateId, input, signal) =>
      client.mutate(
        'PATCH',
        `/templates/${encodeURIComponent(templateId)}`,
        input,
        parseMessageTemplateDetail,
        signal,
      ),
    listRuns: (filters, signal) => {
      const query = new URLSearchParams();
      if (filters.accountId !== undefined && filters.accountId !== '')
        query.set('accountId', filters.accountId);
      if (filters.businessDate !== undefined && filters.businessDate !== '')
        query.set('businessDate', filters.businessDate);
      if (filters.status !== undefined) query.set('status', filters.status);
      if (filters.limit !== undefined) query.set('limit', String(filters.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return client.get(`/runs${suffix}`, parseDailyRuns, signal);
    },
    getRun: (runId, signal) =>
      client.get(`/runs/${encodeURIComponent(runId)}`, parseDailyRun, signal),
    listSendRecords: (runId, signal) =>
      client.get(`/runs/${encodeURIComponent(runId)}/send-records`, parseSendRecords, signal),
    listSystemEvents: (runId, signal) =>
      client.get(`/runs/${encodeURIComponent(runId)}/events`, parseSystemEvents, signal),
    getManualRunPreflight: (accountId, templateId, signal) =>
      client.get(
        `/accounts/${encodeURIComponent(accountId)}/manual-run/preflight?templateId=${encodeURIComponent(templateId)}`,
        parseManualRunPreflight,
        signal,
      ),
    startManualRun: (accountId, input, signal) =>
      client.mutate(
        'POST',
        `/accounts/${encodeURIComponent(accountId)}/manual-runs`,
        input,
        parseManualRunAccepted,
        signal,
      ),
    getNotificationConfiguration: (signal) =>
      client.get('/notification-config', parseNotificationConfiguration, signal),
    updateNotificationConfiguration: (input, signal) =>
      client.mutate('PUT', '/notification-config', input, parseNotificationConfiguration, signal),
    sendTestNotification: (signal) =>
      client.mutate(
        'POST',
        '/notification-config/test',
        {},
        parseNotificationDeliveryResult,
        signal,
      ),
  };
}
