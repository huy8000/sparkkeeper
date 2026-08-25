import type {
  Account,
  DailyRun,
  Friend,
  Health,
  RunFilters,
  RuntimeStatus,
  Schedule,
  SendRecord,
  SystemEvent,
} from '../types/api';
import { ApiClient, type FetchImplementation } from './client';
import {
  parseAccount,
  parseAccounts,
  parseDailyRun,
  parseDailyRuns,
  parseFriends,
  parseHealth,
  parseRuntimeStatus,
  parseSchedules,
  parseSendRecords,
  parseSystemEvents,
} from './parsers';

export interface SparkKeeperApi {
  getHealth(signal?: AbortSignal): Promise<Health>;
  getRuntimeStatus(signal?: AbortSignal): Promise<RuntimeStatus>;
  listAccounts(signal?: AbortSignal): Promise<Account[]>;
  getAccount(accountId: string, signal?: AbortSignal): Promise<Account>;
  listFriends(accountId: string, signal?: AbortSignal): Promise<Friend[]>;
  listSchedules(accountId: string, signal?: AbortSignal): Promise<Schedule[]>;
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
    listFriends: (accountId, signal) =>
      client.get(`/accounts/${encodeURIComponent(accountId)}/friends`, parseFriends, signal),
    listSchedules: (accountId, signal) =>
      client.get(`/accounts/${encodeURIComponent(accountId)}/schedules`, parseSchedules, signal),
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
