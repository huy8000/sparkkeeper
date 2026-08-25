import type {
  AccountRepository,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
} from '@sparkkeeper/database';
import { resolveBusinessDate, type BusinessDate, type DailyRunStatus } from '@sparkkeeper/shared';

import type {
  DailyTaskExecutionMode,
  DailyTaskRunResult,
} from '../../application/DailyTaskRunner.js';
import { RunExecutionCoordinator } from '../../application/RunExecutionCoordinator.js';
import { ApiError, entityNotFound } from '../errors/ApiError.js';

export const MANUAL_RUN_BLOCKED_REASONS = [
  'MANUAL_RUN_DISABLED',
  'REAL_SEND_NOT_AUTHORIZED',
  'ACCOUNT_DISABLED',
  'TEMPLATE_DISABLED',
  'NO_ENABLED_FRIENDS',
  'SCHEDULE_NOT_CONFIGURED',
  'RUN_IN_PROGRESS',
  'RUN_ALREADY_COMPLETE',
  'RUN_TERMINAL',
] as const;

export type ManualRunBlockedReason = (typeof MANUAL_RUN_BLOCKED_REASONS)[number];

export interface ManualRunPreflightDto {
  readonly accountId: string;
  readonly templateId: string;
  readonly businessDate: BusinessDate | null;
  readonly manualRunEnabled: boolean;
  readonly realSendAuthorizationEnabled: boolean;
  readonly accountEnabled: boolean;
  readonly templateEnabled: boolean;
  readonly enabledFriendCount: number;
  readonly scheduleConfigured: boolean;
  readonly currentDailyRunStatus: DailyRunStatus | null;
  readonly successfulFriendCount: number;
  readonly pendingFriendCount: number;
  readonly canRun: boolean;
  readonly blockedReasons: readonly ManualRunBlockedReason[];
}

export interface ManualRunAcceptedDto {
  readonly runId: string;
  readonly businessDate: BusinessDate;
  readonly status: 'ACCEPTED';
}

export interface ManualRunRequest {
  readonly templateId: string;
  readonly acknowledgeRealSend: boolean;
}

export interface ManualRunRunner {
  run(
    accountId: string,
    businessDate: BusinessDate,
    mode: DailyTaskExecutionMode,
  ): Promise<DailyTaskRunResult>;
}

export interface ManualRunRunnerFactory {
  create(accountId: string, templateId: string): ManualRunRunner;
  close?(): Promise<void>;
}

export interface ManualRunRepositories {
  readonly accounts: Pick<AccountRepository, 'findById'>;
  readonly schedules: Pick<ScheduleRepository, 'findByAccountId'>;
  readonly friends: Pick<FriendRepository, 'listEnabledByAccountId'>;
  readonly templates: Pick<MessageTemplateRepository, 'findById'>;
  readonly dailyRuns: Pick<
    DailyRunRepository,
    'createOrGet' | 'findByAccountAndBusinessDate' | 'claimForExecution' | 'markFailed'
  >;
  readonly sendRecords: Pick<SendRecordRepository, 'findByFriendAndBusinessDate'>;
}

export interface ManualRunServiceOptions {
  readonly repositories: ManualRunRepositories;
  readonly manualRunEnabled: boolean;
  readonly realSendAuthorizationEnabled: boolean;
  readonly coordinator: RunExecutionCoordinator;
  readonly runnerFactory: ManualRunRunnerFactory;
  readonly clock?: () => Date;
  readonly onBackgroundFailure?: (context: {
    readonly accountId: string;
    readonly runId: string;
    readonly businessDate: BusinessDate;
  }) => void;
}

export class ManualRunService {
  private readonly clock: () => Date;
  private readonly activeExecutions = new Set<Promise<void>>();
  private accepting = true;

  constructor(private readonly options: ManualRunServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  preflight(accountId: string, templateId: string): ManualRunPreflightDto {
    return this.evaluatePreflight(accountId, templateId, false);
  }

  start(accountId: string, request: ManualRunRequest): ManualRunAcceptedDto {
    if (request.acknowledgeRealSend !== true) {
      throw new ApiError(
        400,
        'REAL_SEND_ACKNOWLEDGEMENT_REQUIRED',
        'Manual Run requires explicit acknowledgement of possible real sending.',
      );
    }
    if (!this.accepting) {
      throw new ApiError(
        503,
        'MANUAL_RUN_UNAVAILABLE',
        'Manual Run is unavailable during shutdown.',
      );
    }

    const initial = this.evaluatePreflight(accountId, request.templateId, false);
    assertRunnable(initial);
    const businessDate = requiredBusinessDate(initial);
    const lease = this.options.coordinator.tryAcquire(accountId, businessDate);
    if (lease === undefined) throw runInProgress();

    try {
      const revalidated = this.evaluatePreflight(accountId, request.templateId, true);
      assertRunnable(revalidated);
      if (requiredBusinessDate(revalidated) !== businessDate) {
        throw new ApiError(
          409,
          'MANUAL_RUN_BLOCKED',
          'BusinessDate changed during Manual Run validation; run preflight again.',
        );
      }
      const now = this.clock();
      const run = this.options.repositories.dailyRuns.createOrGet({ accountId, businessDate, now });
      if (run.status === 'SUCCESS') throw runAlreadyComplete();
      if (run.status === 'FAILED' || run.status === 'AUTH_EXPIRED') throw runTerminal();

      const runner = this.options.runnerFactory.create(accountId, request.templateId);
      const execution = runner
        .run(accountId, businessDate, 'MANUAL')
        .then((result) => {
          if (result === 'SKIPPED') {
            this.handleUnexpectedTermination(accountId, run.id, businessDate);
          }
        })
        .catch(() => {
          this.handleUnexpectedTermination(accountId, run.id, businessDate);
        });
      const tracked = execution.finally(() => {
        lease.release();
        this.activeExecutions.delete(tracked);
      });
      this.activeExecutions.add(tracked);
      return { runId: run.id, businessDate, status: 'ACCEPTED' };
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.accepting = false;
    await Promise.allSettled([...this.activeExecutions]);
    await this.options.runnerFactory.close?.();
  }

  get activeCount(): number {
    return this.activeExecutions.size;
  }

  private evaluatePreflight(
    accountId: string,
    templateId: string,
    ignoreCoordinator: boolean,
  ): ManualRunPreflightDto {
    const account = this.options.repositories.accounts.findById(accountId);
    if (account === undefined) throw entityNotFound('ACCOUNT_NOT_FOUND', 'Account');
    const template = this.options.repositories.templates.findById(templateId);
    if (template === undefined) throw entityNotFound('TEMPLATE_NOT_FOUND', 'Message template');

    const schedule = this.options.repositories.schedules.findByAccountId(accountId);
    const businessDate =
      schedule === undefined ? null : resolveBusinessDate(this.clock(), schedule.timezone);
    const enabledFriends = this.options.repositories.friends.listEnabledByAccountId(accountId);
    const currentRun =
      businessDate === null
        ? undefined
        : this.options.repositories.dailyRuns.findByAccountAndBusinessDate(accountId, businessDate);
    const successfulFriendCount =
      businessDate === null
        ? 0
        : enabledFriends.filter(
            (friend) =>
              this.options.repositories.sendRecords.findByFriendAndBusinessDate(
                friend.id,
                businessDate,
              )?.status === 'SUCCESS',
          ).length;
    const blockedReasons: ManualRunBlockedReason[] = [];
    if (!this.options.manualRunEnabled) blockedReasons.push('MANUAL_RUN_DISABLED');
    if (!this.options.realSendAuthorizationEnabled) {
      blockedReasons.push('REAL_SEND_NOT_AUTHORIZED');
    }
    if (!account.enabled) blockedReasons.push('ACCOUNT_DISABLED');
    if (!template.enabled) blockedReasons.push('TEMPLATE_DISABLED');
    if (enabledFriends.length === 0) blockedReasons.push('NO_ENABLED_FRIENDS');
    if (schedule === undefined) blockedReasons.push('SCHEDULE_NOT_CONFIGURED');
    if (!ignoreCoordinator && businessDate !== null && this.options.coordinator.isBusy) {
      blockedReasons.push('RUN_IN_PROGRESS');
    }
    if (currentRun?.status === 'SUCCESS') blockedReasons.push('RUN_ALREADY_COMPLETE');
    if (currentRun?.status === 'FAILED' || currentRun?.status === 'AUTH_EXPIRED') {
      blockedReasons.push('RUN_TERMINAL');
    }

    return {
      accountId,
      templateId,
      businessDate,
      manualRunEnabled: this.options.manualRunEnabled,
      realSendAuthorizationEnabled: this.options.realSendAuthorizationEnabled,
      accountEnabled: account.enabled,
      templateEnabled: template.enabled,
      enabledFriendCount: enabledFriends.length,
      scheduleConfigured: schedule !== undefined,
      currentDailyRunStatus: currentRun?.status ?? null,
      successfulFriendCount,
      pendingFriendCount: enabledFriends.length - successfulFriendCount,
      canRun: blockedReasons.length === 0,
      blockedReasons,
    };
  }

  private markUnexpectedTermination(runId: string): void {
    try {
      // `createOrGet` above established the canonical row. Conditional claim prevents changing
      // any terminal result that the core runner may already have persisted.
      const claim = this.options.repositories.dailyRuns.claimForExecution(runId, this.clock());
      if (claim.type === 'CLAIMED') {
        this.options.repositories.dailyRuns.markFailed(runId, this.clock());
        return;
      }
      if (claim.type === 'NOT_CLAIMABLE' && claim.run.status === 'RUNNING') {
        this.options.repositories.dailyRuns.markFailed(runId, this.clock());
      }
    } catch {
      // The original background failure remains primary and is reported through safe diagnostics.
    }
  }

  private handleUnexpectedTermination(
    accountId: string,
    runId: string,
    businessDate: BusinessDate,
  ): void {
    this.markUnexpectedTermination(runId);
    try {
      this.options.onBackgroundFailure?.({ accountId, runId, businessDate });
    } catch {
      // Background diagnostics cannot affect execution cleanup.
    }
  }
}

function requiredBusinessDate(preflight: ManualRunPreflightDto): BusinessDate {
  if (preflight.businessDate === null) {
    throw new ApiError(409, 'MANUAL_RUN_BLOCKED', 'Manual Run is blocked by server state.');
  }
  return preflight.businessDate;
}

function assertRunnable(preflight: ManualRunPreflightDto): void {
  if (preflight.canRun) return;
  if (preflight.blockedReasons.includes('RUN_IN_PROGRESS')) throw runInProgress();
  if (preflight.blockedReasons.includes('RUN_ALREADY_COMPLETE')) throw runAlreadyComplete();
  if (preflight.blockedReasons.includes('RUN_TERMINAL')) throw runTerminal();
  if (
    preflight.blockedReasons.includes('MANUAL_RUN_DISABLED') ||
    preflight.blockedReasons.includes('REAL_SEND_NOT_AUTHORIZED')
  ) {
    throw new ApiError(403, 'MANUAL_RUN_FORBIDDEN', 'Manual Run is disabled by server policy.');
  }
  throw new ApiError(409, 'MANUAL_RUN_BLOCKED', 'Manual Run is blocked by server state.');
}

function runInProgress(): ApiError {
  return new ApiError(409, 'RUN_ALREADY_IN_PROGRESS', 'A run is already in progress.');
}

function runAlreadyComplete(): ApiError {
  return new ApiError(409, 'RUN_ALREADY_COMPLETE', 'The current BusinessDate is already complete.');
}

function runTerminal(): ApiError {
  return new ApiError(409, 'RUN_TERMINAL', 'The current BusinessDate has a terminal run state.');
}
