import type {
  Account,
  ConfigureScheduleInput,
  CreateAccountInput,
  DailyRun,
  Friend,
  FriendConfigurationInput,
  Health,
  RunFilters,
  RuntimeStatus,
  Schedule,
  SendRecord,
  SystemEvent,
  MessageTemplateDetail,
  MessageTemplateInput,
  MessageTemplateSummary,
  UpdateAccountInput,
  UpdateFriendInput,
  UpdateMessageTemplateInput,
} from '../types/api';
import { ApiClient, type FetchImplementation } from './client';
import {
  parseAccount,
  parseAccounts,
  parseDailyRun,
  parseDailyRuns,
  parseFriend,
  parseFriends,
  parseHealth,
  parseMessageTemplateDetail,
  parseMessageTemplateSummaries,
  parseRuntimeStatus,
  parseSchedule,
  parseSchedules,
  parseSendRecords,
  parseSystemEvents,
} from './parsers';

export interface SparkKeeperApi {
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
}

export function createSparkKeeperApi(
  baseUrl?: string,
  fetchImplementation?: FetchImplementation,
): SparkKeeperApi {
  const client = new ApiClient(baseUrl, fetchImplementation);
  return {
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
    updateFriend: (friendId, input, signal) =>
      client.mutate(
        'PATCH',
        `/friends/${encodeURIComponent(friendId)}`,
        input,
        parseFriend,
        signal,
      ),
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
  };
}
