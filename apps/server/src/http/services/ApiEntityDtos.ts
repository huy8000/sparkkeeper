import type { Account, Friend, Schedule } from '@sparkkeeper/database';
import type { FriendMatchField, LoginStatus } from '@sparkkeeper/shared';

export interface AccountDto {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly loginStatus: LoginStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FriendDto {
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

export interface ScheduleDto {
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

export function toAccountDto(account: Account): AccountDto {
  return {
    id: account.id,
    name: account.name,
    enabled: account.enabled,
    loginStatus: account.loginStatus,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function toFriendDto(friend: Friend): FriendDto {
  return {
    id: friend.id,
    accountId: friend.accountId,
    displayName: friend.displayName,
    remarkName: friend.remarkName,
    shortId: friend.shortId,
    uniqueId: friend.uniqueId,
    secUid: friend.secUid,
    matchField: friend.matchField,
    enabled: friend.enabled,
    createdAt: friend.createdAt.toISOString(),
    updatedAt: friend.updatedAt.toISOString(),
  };
}

export function toScheduleDto(schedule: Schedule): ScheduleDto {
  return {
    id: schedule.id,
    accountId: schedule.accountId,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    timezone: schedule.timezone,
    enabled: schedule.enabled,
    maxAttempts: schedule.maxAttempts,
    retryIntervalSeconds: schedule.retryIntervalSeconds,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}
