import {
  type AccountRepository,
  type DailyRun,
  type DailyRunRepository,
  type FriendRepository,
  type ScheduleRepository,
  type SendRecord,
  type SendRecordRepository,
  type SystemEvent,
  type SystemEventRepository,
} from '@sparkkeeper/database';
import {
  parseBusinessDate,
  type BusinessDate,
  type DailyRunStatus,
  type RuntimeEventType,
  type SendRecordStatus,
  type SystemEventLevel,
} from '@sparkkeeper/shared';

import { safeEventMessage } from '../../observability/RuntimeLogger.js';
import { ApiError, entityNotFound } from '../errors/ApiError.js';
import {
  type AccountDto,
  type FriendDto,
  type ScheduleDto,
  toAccountDto,
  toFriendDto,
  toScheduleDto,
} from './ApiEntityDtos.js';

export type { AccountDto, FriendDto, ScheduleDto } from './ApiEntityDtos.js';

export interface DailyRunDto {
  readonly id: string;
  readonly accountId: string;
  readonly businessDate: string;
  readonly status: DailyRunStatus;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SendRecordDto {
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

export interface SystemEventDto {
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

export interface ListRunsInput {
  readonly accountId?: string;
  readonly businessDate?: string;
  readonly status?: DailyRunStatus;
  readonly limit?: number;
}

export interface ApiReadRepositories {
  readonly accounts: Pick<AccountRepository, 'findById' | 'list'>;
  readonly friends: Pick<FriendRepository, 'findById' | 'listByAccountId'>;
  readonly schedules: Pick<ScheduleRepository, 'findById' | 'findByAccountId'>;
  readonly dailyRuns: Pick<DailyRunRepository, 'findById' | 'list'>;
  readonly sendRecords: Pick<SendRecordRepository, 'listByDailyRunId'>;
  readonly systemEvents: Pick<SystemEventRepository, 'listByRunId'>;
}

export class ApiReadService {
  constructor(private readonly repositories: ApiReadRepositories) {}

  listAccounts(): AccountDto[] {
    return this.repositories.accounts.list().map(toAccountDto);
  }

  getAccount(accountId: string): AccountDto {
    const account = this.repositories.accounts.findById(accountId);
    if (account === undefined) throw entityNotFound('ACCOUNT_NOT_FOUND', 'Account');
    return toAccountDto(account);
  }

  listFriends(accountId: string): FriendDto[] {
    this.assertAccountExists(accountId);
    return this.repositories.friends.listByAccountId(accountId).map(toFriendDto);
  }

  getFriend(friendId: string): FriendDto {
    const friend = this.repositories.friends.findById(friendId);
    if (friend === undefined) throw entityNotFound('FRIEND_NOT_FOUND', 'Friend');
    return toFriendDto(friend);
  }

  listSchedules(accountId: string): ScheduleDto[] {
    this.assertAccountExists(accountId);
    const schedule = this.repositories.schedules.findByAccountId(accountId);
    return schedule === undefined ? [] : [toScheduleDto(schedule)];
  }

  getSchedule(scheduleId: string): ScheduleDto {
    const schedule = this.repositories.schedules.findById(scheduleId);
    if (schedule === undefined) throw entityNotFound('SCHEDULE_NOT_FOUND', 'Schedule');
    return toScheduleDto(schedule);
  }

  listRuns(input: ListRunsInput): DailyRunDto[] {
    const businessDate = parseOptionalBusinessDate(input.businessDate);
    return this.repositories.dailyRuns
      .list({
        ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
        ...(businessDate === undefined ? {} : { businessDate }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      })
      .map(toDailyRunDto);
  }

  getRun(runId: string): DailyRunDto {
    return toDailyRunDto(this.requireRun(runId));
  }

  listSendRecords(runId: string): SendRecordDto[] {
    this.requireRun(runId);
    return this.repositories.sendRecords.listByDailyRunId(runId).map(toSendRecordDto);
  }

  listSystemEvents(runId: string): SystemEventDto[] {
    this.requireRun(runId);
    return this.repositories.systemEvents.listByRunId(runId).map(toSystemEventDto);
  }

  private assertAccountExists(accountId: string): void {
    if (this.repositories.accounts.findById(accountId) === undefined) {
      throw entityNotFound('ACCOUNT_NOT_FOUND', 'Account');
    }
  }

  private requireRun(runId: string): DailyRun {
    const run = this.repositories.dailyRuns.findById(runId);
    if (run === undefined) throw entityNotFound('RUN_NOT_FOUND', 'DailyRun');
    return run;
  }
}

function toDailyRunDto(run: DailyRun): DailyRunDto {
  return {
    id: run.id,
    accountId: run.accountId,
    businessDate: run.businessDate,
    status: run.status,
    startedAt: isoOrNull(run.startedAt),
    finishedAt: isoOrNull(run.finishedAt),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function toSendRecordDto(record: SendRecord): SendRecordDto {
  return {
    id: record.id,
    dailyRunId: record.dailyRunId,
    friendId: record.friendId,
    businessDate: record.businessDate,
    status: record.status,
    attempts: record.attemptCount,
    failureCode: record.lastErrorCode,
    startedAt: isoOrNull(record.startedAt),
    finishedAt: isoOrNull(record.finishedAt),
    sentAt: isoOrNull(record.sentAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toSystemEventDto(event: SystemEvent): SystemEventDto {
  return {
    eventType: event.eventType,
    level: event.level,
    friendId: event.friendId,
    attempt: event.attempt,
    errorCode: event.errorCode,
    message: safeEventMessage(event.eventType),
    screenshotEvidenceAvailable: event.screenshotPath !== null,
    traceEvidenceAvailable: event.tracePath !== null,
    createdAt: event.createdAt.toISOString(),
  };
}

function isoOrNull(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function parseOptionalBusinessDate(value: string | undefined): BusinessDate | undefined {
  if (value === undefined) return undefined;
  try {
    return parseBusinessDate(value);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed.');
  }
}
