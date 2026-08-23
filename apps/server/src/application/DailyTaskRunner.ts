import {
  AccountRepository,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
  type Schedule,
  type SendRecord,
} from '@sparkkeeper/database';
import { MessageEngine } from '@sparkkeeper/message-engine';
import type { BusinessDate, ExternalActionState, RetryFailureCode } from '@sparkkeeper/shared';

import { evaluateScheduleWindow } from '../scheduler/ScheduleWindow.js';
import {
  DailyTaskAutomationError,
  type AutomationSendResult,
  type DailyTaskAutomation,
} from './DailyTaskAutomation.js';
import { RetryPolicy, type RetryDecision } from './retry/RetryPolicy.js';

export interface DailyTaskRunnerOptions {
  readonly accountId: string;
  readonly messageTemplateId: string;
  readonly allowRealSend: boolean;
  readonly automation: DailyTaskAutomation;
  readonly accounts: AccountRepository;
  readonly schedules: ScheduleRepository;
  readonly friends: FriendRepository;
  readonly templates: MessageTemplateRepository;
  readonly dailyRuns: DailyRunRepository;
  readonly sendRecords: SendRecordRepository;
  readonly messageEngine?: MessageEngine;
  readonly retryPolicy?: RetryPolicy;
  readonly now?: () => Date;
}

export type DailyTaskRunResult = 'SUCCESS' | 'FAILED' | 'AUTH_EXPIRED' | 'RETRY_WAIT' | 'SKIPPED';

interface FailureApplicationResult {
  readonly decision: RetryDecision;
  readonly stopRun: boolean;
}

export class DailyTaskRunner {
  private readonly engine: MessageEngine;
  private readonly retryPolicy: RetryPolicy;
  private readonly now: () => Date;

  constructor(private readonly options: DailyTaskRunnerOptions) {
    this.engine = options.messageEngine ?? new MessageEngine();
    this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.now = options.now ?? (() => new Date());
  }

  async run(accountId: string, businessDate: BusinessDate): Promise<DailyTaskRunResult> {
    const { account, schedule, template } = this.requireConfiguration(accountId);
    const currentTime = this.now();
    const window = evaluateScheduleWindow(
      currentTime,
      schedule.timezone,
      schedule.startTime,
      schedule.endTime,
    );
    if (window.position !== 'IN_WINDOW' || window.businessDate !== businessDate) {
      await this.finalizeExpired(accountId, window.businessDate);
      return 'SKIPPED';
    }

    this.finalizePreviousBusinessDates(account.id, businessDate);
    let run = this.options.dailyRuns.createOrGet({ accountId, businessDate, now: currentTime });
    if (run.status === 'SUCCESS' || run.status === 'FAILED' || run.status === 'AUTH_EXPIRED') {
      return 'SKIPPED';
    }
    if (run.status === 'READY') {
      const claim = this.options.dailyRuns.claimForExecution(run.id, this.now());
      if (claim.type !== 'CLAIMED') return 'SKIPPED';
      run = claim.run;
    }

    if (this.recoverInterruptedAttempts(run.id, schedule, businessDate)) {
      this.options.dailyRuns.markFailed(run.id, this.now());
      return 'FAILED';
    }

    const enabledFriends = this.options.friends.listEnabledByAccountId(account.id);
    if (!this.hasActionableWork(run.id, enabledFriends, businessDate, schedule)) {
      return this.aggregate(run.id, enabledFriends, businessDate);
    }

    let started = false;
    let activeRecordId: string | undefined;
    let stopRun = false;
    try {
      await this.options.automation.start();
      started = true;
      const auth = await this.options.automation.checkAuth();
      if (auth === 'AUTH_EXPIRED') {
        this.options.accounts.update(account.id, { loginStatus: 'AUTH_EXPIRED' });
        this.options.dailyRuns.markAuthExpired(run.id, this.now());
        return 'AUTH_EXPIRED';
      }
      if (auth !== 'READY') {
        this.options.accounts.update(account.id, { loginStatus: 'UNKNOWN' });
        this.options.dailyRuns.markFailed(run.id, this.now());
        return 'FAILED';
      }
      this.options.accounts.update(account.id, { loginStatus: 'READY', lastLoginAt: this.now() });

      for (const friend of enabledFriends) {
        let record = this.options.sendRecords.findByFriendAndBusinessDate(friend.id, businessDate);
        if (
          record?.status === 'SUCCESS' ||
          record?.status === 'FAILED' ||
          record?.status === 'DELIVERY_UNKNOWN'
        ) {
          if (record.status === 'DELIVERY_UNKNOWN') stopRun = true;
          if (stopRun) break;
          continue;
        }
        if (record?.status === 'RUNNING') {
          stopRun = true;
          break;
        }

        if (record === undefined) {
          const messageText = await this.engine.build(template);
          record = this.options.sendRecords.prepare({
            dailyRunId: run.id,
            friendId: friend.id,
            businessDate,
            messageTemplateId: template.id,
            messageText,
            now: this.now(),
          }).record;
        }

        const claim =
          record.status === 'READY'
            ? this.options.sendRecords.claimInitialAttempt(
                record.id,
                this.now(),
                schedule.maxAttempts,
              )
            : this.options.sendRecords.claimRetryAttempt(
                record.id,
                this.now(),
                schedule.maxAttempts,
              );
        if (claim.type !== 'CLAIMED') {
          if (claim.type === 'NOT_CLAIMABLE' && claim.record.status === 'DELIVERY_UNKNOWN') {
            stopRun = true;
            break;
          }
          continue;
        }

        activeRecordId = claim.record.id;
        const opened = await this.options.automation.resolveAndOpen(friend);
        if (opened.status !== 'VERIFIED') {
          const failure = this.applyFailure(
            claim.record,
            opened.failureCode,
            'NOT_STARTED',
            schedule,
            businessDate,
          );
          activeRecordId = undefined;
          if (failure.stopRun) {
            stopRun = true;
            break;
          }
          continue;
        }

        const marked = this.options.sendRecords.markSendActionStarted(claim.record.id, this.now());
        const result = await this.options.automation.sendAndVerify(friend, marked);
        activeRecordId = undefined;
        if (result.status === 'SUCCESS') {
          this.options.sendRecords.markSuccess(record.id, this.now());
          continue;
        }

        const failure = this.applySendFailure(marked, result, schedule, businessDate);
        if (failure.stopRun) {
          stopRun = true;
          break;
        }
      }
    } catch (error) {
      if (activeRecordId !== undefined) {
        const active = this.options.sendRecords.findById(activeRecordId);
        if (active?.status === 'RUNNING') {
          if (active.sendActionStartedAt !== null) {
            this.options.sendRecords.recoverInterruptedAfterSendBoundary(active.id, this.now());
            stopRun = true;
          } else {
            const code =
              error instanceof DailyTaskAutomationError ? error.failureCode : 'CONFIG_INVALID';
            const state =
              error instanceof DailyTaskAutomationError
                ? error.externalActionState
                : ('NOT_STARTED' as const);
            stopRun = this.applyFailure(active, code, state, schedule, businessDate).stopRun;
          }
        }
      } else {
        const current = this.options.dailyRuns.findById(run.id);
        if (current?.status === 'RUNNING') this.options.dailyRuns.markFailed(run.id, this.now());
        throw error;
      }
    } finally {
      if (started) await this.options.automation.close();
    }

    if (stopRun) {
      const records = this.options.sendRecords.listByDailyRunId(run.id);
      if (records.some((record) => record.status === 'DELIVERY_UNKNOWN')) {
        this.options.dailyRuns.markFailed(run.id, this.now());
        return 'FAILED';
      }
    }
    return this.aggregate(run.id, enabledFriends, businessDate);
  }

  async finalizeExpired(accountId: string, currentBusinessDate: BusinessDate): Promise<void> {
    if (accountId !== this.options.accountId) return;
    const schedule = this.options.schedules.findByAccountId(accountId);
    if (schedule === undefined) return;
    const window = evaluateScheduleWindow(
      this.now(),
      schedule.timezone,
      schedule.startTime,
      schedule.endTime,
    );
    for (const run of this.options.dailyRuns.listByAccountId(accountId)) {
      if (run.status !== 'RUNNING') continue;
      const isPrevious = run.businessDate < currentBusinessDate;
      const isCurrentExpired =
        run.businessDate === currentBusinessDate && window.position === 'AFTER_WINDOW';
      if (!isPrevious && !isCurrentExpired) continue;
      for (const record of this.options.sendRecords.listByDailyRunId(run.id)) {
        if (record.status === 'RUNNING' && record.sendActionStartedAt !== null) {
          this.options.sendRecords.recoverInterruptedAfterSendBoundary(record.id, this.now());
        } else if (record.status === 'RUNNING' || record.status === 'RETRY_WAIT') {
          this.options.sendRecords.markFinalFailed(record.id, this.now(), 'RETRY_WINDOW_EXPIRED');
        }
      }
      this.options.dailyRuns.markFailed(run.id, this.now());
    }
  }

  private requireConfiguration(accountId: string) {
    if (!this.options.allowRealSend) throw new Error('Scheduler real sending is not authorized.');
    if (accountId !== this.options.accountId)
      throw new Error('Scheduler Account does not match explicit configuration.');
    const account = this.options.accounts.findById(accountId);
    const schedule = this.options.schedules.findByAccountId(accountId);
    const template = this.options.templates.findById(this.options.messageTemplateId);
    if (account === undefined || !account.enabled)
      throw new Error('Configured Scheduler Account is unavailable or disabled.');
    if (schedule === undefined || !schedule.enabled)
      throw new Error('Configured Schedule is unavailable or disabled.');
    if (template === undefined || !template.enabled)
      throw new Error('Configured MessageTemplate is unavailable or disabled.');
    return { account, schedule, template };
  }

  private recoverInterruptedAttempts(
    dailyRunId: string,
    schedule: Schedule,
    businessDate: BusinessDate,
  ): boolean {
    let uncertain = false;
    for (const record of this.options.sendRecords.listByDailyRunId(dailyRunId)) {
      if (record.status !== 'RUNNING') continue;
      if (record.sendActionStartedAt !== null) {
        this.options.sendRecords.recoverInterruptedAfterSendBoundary(record.id, this.now());
        uncertain = true;
        continue;
      }
      const decision = this.retryPolicy.decide({
        failureCode: 'PROCESS_INTERRUPTED_BEFORE_SEND',
        externalActionState: 'NOT_STARTED',
        attemptCount: record.attemptCount,
        maxAttempts: schedule.maxAttempts,
        retryIntervalSeconds: schedule.retryIntervalSeconds,
        now: this.now(),
        businessDate,
        timezone: schedule.timezone,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      });
      if (decision.type === 'RETRY_SCHEDULED') {
        const recovery = this.options.sendRecords.recoverInterruptedBeforeSend(record.id, {
          maxAttempts: schedule.maxAttempts,
          nextRetryAt: decision.nextRetryAt,
          now: this.now(),
        });
        if (recovery.type === 'NOT_RECOVERABLE') {
          this.options.sendRecords.markFinalFailed(record.id, this.now(), 'MAX_ATTEMPTS_EXHAUSTED');
        }
      } else if (decision.type === 'DELIVERY_UNKNOWN') {
        this.options.sendRecords.markDeliveryUnknown(record.id, this.now());
        uncertain = true;
      } else {
        this.options.sendRecords.markFinalFailed(record.id, this.now(), decision.failureCode);
      }
    }
    return uncertain;
  }

  private hasActionableWork(
    dailyRunId: string,
    friends: readonly { readonly id: string }[],
    businessDate: BusinessDate,
    schedule: Schedule,
  ): boolean {
    const now = this.now();
    for (const friend of friends) {
      const record = this.options.sendRecords.findByFriendAndBusinessDate(friend.id, businessDate);
      if (record === undefined || record.status === 'READY') return true;
      if (
        record.status === 'RETRY_WAIT' &&
        record.nextRetryAt !== null &&
        record.nextRetryAt.getTime() <= now.getTime() &&
        record.attemptCount < schedule.maxAttempts
      ) {
        return true;
      }
    }
    return this.options.sendRecords
      .listDueRetriesByDailyRunId(dailyRunId, now)
      .some((record) => record.attemptCount < schedule.maxAttempts);
  }

  private applySendFailure(
    record: SendRecord,
    result: Exclude<AutomationSendResult, { readonly status: 'SUCCESS' }>,
    schedule: Schedule,
    businessDate: BusinessDate,
  ): FailureApplicationResult {
    return this.applyFailure(
      record,
      result.failureCode,
      result.sendAction === 'NOT_TRIGGERED' ? 'NOT_TRIGGERED' : 'UNCERTAIN',
      schedule,
      businessDate,
    );
  }

  private applyFailure(
    record: SendRecord,
    failureCode: RetryFailureCode,
    externalActionState: ExternalActionState,
    schedule: Schedule,
    businessDate: BusinessDate,
  ): FailureApplicationResult {
    const decision = this.retryPolicy.decide({
      failureCode,
      externalActionState,
      attemptCount: record.attemptCount,
      maxAttempts: schedule.maxAttempts,
      retryIntervalSeconds: schedule.retryIntervalSeconds,
      now: this.now(),
      businessDate,
      timezone: schedule.timezone,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    });
    if (decision.type === 'RETRY_SCHEDULED') {
      this.options.sendRecords.scheduleRetry(record.id, {
        failureCode: decision.failureCode,
        maxAttempts: schedule.maxAttempts,
        nextRetryAt: decision.nextRetryAt,
        now: this.now(),
        externalActionConfirmedAbsent: true,
      });
    } else if (decision.type === 'DELIVERY_UNKNOWN') {
      this.options.sendRecords.markDeliveryUnknown(record.id, this.now());
    } else {
      this.options.sendRecords.markFinalFailed(record.id, this.now(), decision.failureCode);
    }
    return {
      decision,
      stopRun: decision.scope === 'RUN_GLOBAL' || decision.type === 'DELIVERY_UNKNOWN',
    };
  }

  private aggregate(
    dailyRunId: string,
    friends: readonly { readonly id: string }[],
    businessDate: BusinessDate,
  ): DailyTaskRunResult {
    const records = friends.map((friend) =>
      this.options.sendRecords.findByFriendAndBusinessDate(friend.id, businessDate),
    );
    if (records.some((record) => record?.status === 'DELIVERY_UNKNOWN')) {
      this.options.dailyRuns.markFailed(dailyRunId, this.now());
      return 'FAILED';
    }
    if (records.some((record) => record?.status === 'FAILED')) {
      this.options.dailyRuns.markFailed(dailyRunId, this.now());
      return 'FAILED';
    }
    if (
      records.some(
        (record) =>
          record === undefined ||
          record.status === 'READY' ||
          record.status === 'RUNNING' ||
          record.status === 'RETRY_WAIT',
      )
    ) {
      return 'RETRY_WAIT';
    }
    this.options.dailyRuns.markSuccess(dailyRunId, this.now());
    return 'SUCCESS';
  }

  private finalizePreviousBusinessDates(accountId: string, businessDate: BusinessDate): void {
    for (const run of this.options.dailyRuns.listByAccountId(accountId)) {
      if (run.status !== 'RUNNING' || run.businessDate >= businessDate) continue;
      for (const record of this.options.sendRecords.listByDailyRunId(run.id)) {
        if (record.status === 'RUNNING' && record.sendActionStartedAt !== null) {
          this.options.sendRecords.recoverInterruptedAfterSendBoundary(record.id, this.now());
        } else if (record.status === 'RUNNING' || record.status === 'RETRY_WAIT') {
          this.options.sendRecords.markFinalFailed(record.id, this.now(), 'RETRY_WINDOW_EXPIRED');
        }
      }
      this.options.dailyRuns.markFailed(run.id, this.now());
    }
  }
}
