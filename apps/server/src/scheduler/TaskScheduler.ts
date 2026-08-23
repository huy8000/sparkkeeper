import type { BusinessDate } from '@sparkkeeper/shared';
import type { ScheduleRepository } from '@sparkkeeper/database';

import { evaluateScheduleWindow } from './ScheduleWindow.js';

export interface SchedulerClock {
  now(): Date;
}
export interface SchedulerTimer {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}
export interface DailyRunTrigger {
  run(accountId: string, businessDate: BusinessDate): Promise<unknown>;
}
export type SchedulerErrorHandler = (error: unknown) => void;

export const DEFAULT_SCHEDULER_POLL_INTERVAL_MS = 60_000;

export class TaskScheduler {
  private intervalHandle: unknown;
  private activeTick: Promise<'TRIGGERED' | 'SKIPPED'> | undefined;
  private stopped = true;
  private readonly attempted = new Set<string>();

  constructor(
    private readonly accountId: string,
    private readonly schedules: Pick<ScheduleRepository, 'findByAccountId'>,
    private readonly runner: DailyRunTrigger,
    private readonly clock: SchedulerClock = { now: () => new Date() },
    private readonly timer: SchedulerTimer = defaultTimer,
    private readonly pollIntervalMs = DEFAULT_SCHEDULER_POLL_INTERVAL_MS,
    private readonly onError: SchedulerErrorHandler = defaultErrorHandler,
  ) {
    if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1) {
      throw new Error('Scheduler poll interval must be a positive integer.');
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.requestTick();
    this.intervalHandle = this.timer.setInterval(() => this.requestTick(), this.pollIntervalMs);
  }

  private requestTick(): void {
    if (this.stopped) return;
    void this.tick().catch((error: unknown) => this.onError(error));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.intervalHandle !== undefined) {
      this.timer.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    await this.activeTick;
  }

  async tick(): Promise<'TRIGGERED' | 'SKIPPED'> {
    if (this.activeTick !== undefined) return 'SKIPPED';
    const operation = this.tickInternal();
    this.activeTick = operation;
    try {
      return await operation;
    } finally {
      if (this.activeTick === operation) this.activeTick = undefined;
    }
  }

  private async tickInternal(): Promise<'TRIGGERED' | 'SKIPPED'> {
    const schedule = this.schedules.findByAccountId(this.accountId);
    if (schedule === undefined || !schedule.enabled) return 'SKIPPED';
    const evaluation = evaluateScheduleWindow(
      this.clock.now(),
      schedule.timezone,
      schedule.startTime,
      schedule.endTime,
    );
    if (evaluation.position !== 'IN_WINDOW') return 'SKIPPED';
    const key = `${schedule.accountId}:${evaluation.businessDate}`;
    if (this.attempted.has(key)) return 'SKIPPED';
    this.attempted.add(key);
    await this.runner.run(schedule.accountId, evaluation.businessDate);
    return 'TRIGGERED';
  }
}

const defaultTimer: SchedulerTimer = {
  setInterval: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clearInterval: (handle) => globalThis.clearInterval(handle as NodeJS.Timeout),
};

function defaultErrorHandler(): void {
  console.error('SparkKeeper Scheduler tick failed; manual inspection is required.');
}
