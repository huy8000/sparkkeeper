import {
  AccountRepository,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
  type SendRecord,
} from '@sparkkeeper/database';
import { MessageEngine } from '@sparkkeeper/message-engine';
import type { BusinessDate } from '@sparkkeeper/shared';

import type { DailyTaskAutomation } from './DailyTaskAutomation.js';

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
  readonly now?: () => Date;
}

export type DailyTaskRunResult = 'SUCCESS' | 'FAILED' | 'AUTH_EXPIRED' | 'SKIPPED';

export class DailyTaskRunner {
  private readonly engine: MessageEngine;
  private readonly now: () => Date;

  constructor(private readonly options: DailyTaskRunnerOptions) {
    this.engine = options.messageEngine ?? new MessageEngine();
    this.now = options.now ?? (() => new Date());
  }

  async run(accountId: string, businessDate: BusinessDate): Promise<DailyTaskRunResult> {
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

    let run = this.options.dailyRuns.createOrGet({ accountId, businessDate, now: this.now() });
    if (run.status === 'SUCCESS') return 'SKIPPED';
    if (run.status === 'FAILED' || run.status === 'AUTH_EXPIRED') return 'SKIPPED';
    if (run.status === 'READY') {
      const claim = this.options.dailyRuns.claimForExecution(run.id, this.now());
      if (claim.type !== 'CLAIMED') return 'SKIPPED';
      run = claim.run;
    }

    let failed = false;
    let started = false;
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

      for (const friend of this.options.friends.listEnabledByAccountId(account.id)) {
        const existing = this.options.sendRecords.findByFriendAndBusinessDate(
          friend.id,
          businessDate,
        );
        if (existing?.status === 'SUCCESS') continue;
        if (existing?.status === 'RUNNING' || existing?.status === 'FAILED') {
          failed = true;
          continue;
        }
        if (existing?.status === 'DELIVERY_UNKNOWN') {
          failed = true;
          break;
        }

        let record: SendRecord;
        if (existing === undefined) {
          const messageText = await this.engine.build(template);
          record = this.options.sendRecords.prepare({
            dailyRunId: run.id,
            friendId: friend.id,
            businessDate,
            messageTemplateId: template.id,
            messageText,
            now: this.now(),
          }).record;
        } else {
          record = existing;
        }

        const opened = await this.options.automation.resolveAndOpen(friend);
        if (opened !== 'VERIFIED') {
          this.options.sendRecords.markFailedBeforeSend(record.id, this.now());
          failed = true;
          continue;
        }
        const claim = this.options.sendRecords.claimForExecution(record.id, this.now());
        if (claim.type !== 'CLAIMED') {
          failed = true;
          if (claim.type === 'NOT_CLAIMABLE' && claim.record.status === 'DELIVERY_UNKNOWN') break;
          continue;
        }
        try {
          const result = await this.options.automation.sendAndVerify(friend, claim.record);
          if (result.status === 'SUCCESS') {
            this.options.sendRecords.markSuccess(record.id, this.now());
          } else if (result.status === 'DELIVERY_UNKNOWN' || result.sendAttemptCount === 1) {
            this.options.sendRecords.markDeliveryUnknown(record.id, this.now());
            failed = true;
            break;
          } else {
            this.options.sendRecords.markFailed(record.id, this.now());
            failed = true;
          }
        } catch {
          this.options.sendRecords.markDeliveryUnknown(record.id, this.now());
          failed = true;
          break;
        }
      }

      if (failed) {
        this.options.dailyRuns.markFailed(run.id, this.now());
        return 'FAILED';
      }
      this.options.dailyRuns.markSuccess(run.id, this.now());
      return 'SUCCESS';
    } catch (error) {
      const current = this.options.dailyRuns.findById(run.id);
      if (current?.status === 'RUNNING') this.options.dailyRuns.markFailed(run.id, this.now());
      throw error;
    } finally {
      if (started) await this.options.automation.close();
    }
  }
}
