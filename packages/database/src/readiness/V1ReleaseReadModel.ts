import type {
  BusinessDate,
  DailyRunStatus,
  RuntimeEventType,
  SendRecordStatus,
} from '@sparkkeeper/shared';
import { and, asc, count, eq } from 'drizzle-orm';

import type { ReadOnlyDatabaseClient } from '../client/DatabaseClient.js';
import {
  accounts,
  dailyRuns,
  friends,
  messageTemplates,
  schedules,
  sendRecords,
  systemEvents,
} from '../schema/index.js';

export interface PreflightAccountState {
  readonly id: string;
  readonly enabled: boolean;
}

export interface PreflightScheduleState {
  readonly id: string;
  readonly enabled: boolean;
  readonly timezone: string;
}

export interface PreflightTemplateState {
  readonly id: string;
  readonly enabled: boolean;
}

export interface V1AuditSendRecordState {
  readonly friendId: string;
  readonly status: SendRecordStatus;
  readonly attemptCount?: number;
}

export interface V1AuditSystemEventState {
  readonly eventType: RuntimeEventType;
  readonly screenshotPath: string | null;
  readonly tracePath: string | null;
}

export interface V1AuditDayData {
  readonly businessDate: BusinessDate;
  readonly dailyRunStatus: DailyRunStatus | undefined;
  readonly enabledFriendCount: number;
  readonly sendRecords: readonly V1AuditSendRecordState[];
  readonly systemEvents: readonly V1AuditSystemEventState[];
}

export class V1ReleaseReadModel {
  constructor(private readonly client: ReadOnlyDatabaseClient) {}

  findAccount(id: string): PreflightAccountState | undefined {
    return this.client.orm
      .select({ id: accounts.id, enabled: accounts.enabled })
      .from(accounts)
      .where(eq(accounts.id, id))
      .get();
  }

  findScheduleByAccountId(accountId: string): PreflightScheduleState | undefined {
    return this.client.orm
      .select({ id: schedules.id, enabled: schedules.enabled, timezone: schedules.timezone })
      .from(schedules)
      .where(eq(schedules.accountId, accountId))
      .get();
  }

  findTemplate(id: string): PreflightTemplateState | undefined {
    return this.client.orm
      .select({ id: messageTemplates.id, enabled: messageTemplates.enabled })
      .from(messageTemplates)
      .where(eq(messageTemplates.id, id))
      .get();
  }

  countEnabledFriends(accountId: string): number {
    return (
      this.client.orm
        .select({ value: count() })
        .from(friends)
        .where(and(eq(friends.accountId, accountId), eq(friends.enabled, true)))
        .get()?.value ?? 0
    );
  }

  readAuditDay(accountId: string, businessDate: BusinessDate): V1AuditDayData {
    const run = this.client.orm
      .select({ id: dailyRuns.id, status: dailyRuns.status })
      .from(dailyRuns)
      .where(and(eq(dailyRuns.accountId, accountId), eq(dailyRuns.businessDate, businessDate)))
      .get();
    const records =
      run === undefined
        ? []
        : this.client.orm
            .select({
              friendId: sendRecords.friendId,
              status: sendRecords.status,
              attemptCount: sendRecords.attemptCount,
            })
            .from(sendRecords)
            .where(eq(sendRecords.dailyRunId, run.id))
            .orderBy(asc(sendRecords.createdAt), asc(sendRecords.id))
            .all();
    const events =
      run === undefined
        ? []
        : this.client.orm
            .select({
              eventType: systemEvents.eventType,
              screenshotPath: systemEvents.screenshotPath,
              tracePath: systemEvents.tracePath,
            })
            .from(systemEvents)
            .where(eq(systemEvents.runId, run.id))
            .orderBy(asc(systemEvents.createdAt), asc(systemEvents.id))
            .all();
    return {
      businessDate,
      dailyRunStatus: run?.status,
      enabledFriendCount: this.countEnabledFriends(accountId),
      sendRecords: records,
      systemEvents: events,
    };
  }
}
