import type { CreateSystemEventInput } from '@sparkkeeper/database';
import type { NotificationEventCandidate, NotificationEventType } from '@sparkkeeper/notifier';

import type { ConsecutiveRunFailureSource } from '../notifications/ConsecutiveRunFailureDetector.js';
import type { RealtimeEventPublisher } from '../realtime/RealtimeEvent.js';
import type { RuntimeLogEvent, RuntimeLogWriter } from './RuntimeLogger.js';
import { safeEventMessage } from './RuntimeLogger.js';
import {
  defaultScreenshotCapture,
  defaultSystemEventPersistence,
  systemEventLevel,
  type RuntimeObservation,
  type RuntimeObserver,
  type RuntimeRunContext,
  type RuntimeRunResult,
} from './RuntimeObserver.js';
import type { RetentionManager, RetentionResult } from './RetentionManager.js';
import type { ScreenshotManager, ScreenshotResult } from './ScreenshotManager.js';
import type { TraceFinishResult, TraceManager, TraceStartResult } from './TraceManager.js';

interface SystemEventStore {
  create(input: CreateSystemEventInput): unknown;
}

interface SafeLogger {
  emit(level: RuntimeObservation['level'], event: RuntimeLogEvent): void;
}

interface ScreenshotEvidence {
  capture(request: Parameters<ScreenshotManager['capture']>[0]): Promise<ScreenshotResult>;
}

interface TraceEvidence {
  start(runId: string): Promise<TraceStartResult>;
  finish(
    request: Parameters<TraceManager['finish']>[0],
    failed: boolean,
  ): Promise<TraceFinishResult>;
}

interface EvidenceRetention {
  cleanup(now?: Date): RetentionResult;
}

interface NotificationPublisher {
  publish(candidate: NotificationEventCandidate): void;
}

type TerminalNotificationCandidate = Omit<NotificationEventCandidate, 'eventType'> & {
  readonly eventType: NotificationEventType;
};

export interface ProductionRuntimeObserverOptions {
  readonly logger: SafeLogger | RuntimeLogWriter;
  readonly systemEvents: SystemEventStore;
  readonly screenshots: ScreenshotEvidence;
  readonly traces: TraceEvidence;
  readonly retention: EvidenceRetention | RetentionManager;
  readonly realtime?: RealtimeEventPublisher;
  readonly notifications?: NotificationPublisher;
  readonly consecutiveFailures?: ConsecutiveRunFailureSource;
  readonly clock?: () => Date;
  readonly fallback?: (safeMessage: string) => void;
}

export class ProductionRuntimeObserver implements RuntimeObserver {
  private readonly tracePaths = new Map<string, string>();
  private readonly runsWithScreenshot = new Set<string>();
  private readonly pendingRunNotifications = new Map<string, TerminalNotificationCandidate>();
  private readonly fallback: (safeMessage: string) => void;
  private readonly clock: () => Date;

  constructor(private readonly options: ProductionRuntimeObserverOptions) {
    this.fallback = options.fallback ?? ((message) => process.stderr.write(`${message}\n`));
    this.clock = options.clock ?? (() => new Date());
  }

  async observe(event: RuntimeObservation): Promise<void> {
    this.safeLog(event.level, event);
    let screenshotPath: string | undefined;
    const shouldCapture = event.captureScreenshot ?? defaultScreenshotCapture(event.eventType);
    if (
      shouldCapture &&
      event.runId !== undefined &&
      event.businessDate !== undefined &&
      !(event.eventType === 'TASK_FAILED' && this.runsWithScreenshot.has(event.runId))
    ) {
      const screenshot = await this.options.screenshots.capture({
        businessDate: event.businessDate,
        runId: event.runId,
        eventType: event.eventType,
        ...(event.friendId === undefined ? {} : { friendId: event.friendId }),
      });
      if (screenshot.status === 'CAPTURED') {
        screenshotPath = screenshot.relativePath;
        this.runsWithScreenshot.add(event.runId);
      } else {
        this.recordObservabilityFailure(screenshot.errorCode, event);
      }
    }

    const shouldPersist = event.persist ?? defaultSystemEventPersistence(event.eventType);
    if (shouldPersist) {
      const tracePath = event.runId === undefined ? undefined : this.tracePaths.get(event.runId);
      try {
        this.options.systemEvents.create({
          eventType: event.eventType,
          level: systemEventLevel(event.level),
          ...(event.runId === undefined ? {} : { runId: event.runId }),
          ...(event.accountId === undefined ? {} : { accountId: event.accountId }),
          ...(event.friendId === undefined ? {} : { friendId: event.friendId }),
          ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
          ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
          message: safeEventMessage(event.eventType),
          ...(screenshotPath === undefined ? {} : { screenshotPath }),
          ...(tracePath === undefined ? {} : { tracePath }),
        });
      } catch {
        this.safeLog('error', observabilityFailureEvent('OBSERVABILITY_PERSIST_FAILED', event));
        this.safeFallback('SparkKeeper observability persistence failed.');
      }
    }
    this.safeRealtimeBroadcast(event);
    this.safeNotificationPublish(event);
    await this.safeConsecutiveFailureObserve(event);
  }

  async startRun(context: RuntimeRunContext): Promise<void> {
    const result = await this.options.traces.start(context.runId);
    if (result.status === 'FAILED') this.recordObservabilityFailure(result.errorCode, context);
  }

  async finishRun(
    context: RuntimeRunContext,
    runResult: RuntimeRunResult,
    evidenceFailed: boolean,
  ): Promise<void> {
    const finalFailed = runResult === 'FAILED' || runResult === 'AUTH_EXPIRED';
    const shouldKeepFailureEvidence = finalFailed || evidenceFailed;
    const result = await this.options.traces.finish(
      {
        businessDate: context.businessDate,
        runId: context.runId,
        eventType: finalFailed ? 'TASK_FAILED' : evidenceFailed ? 'RETRY_WAIT' : 'RUN_FINISHED',
      },
      shouldKeepFailureEvidence,
    );
    if (result.status === 'SAVED') this.tracePaths.set(context.runId, result.relativePath);
    else if (result.status === 'FAILED') this.recordObservabilityFailure(result.errorCode, context);
    if (finalFailed) {
      await this.observe({
        ...context,
        eventType: 'TASK_FAILED',
        level: 'error',
        persist: true,
        captureScreenshot: false,
      });
    }
    await this.observe({
      ...context,
      eventType: 'RUN_FINISHED',
      level: 'info',
      runResult,
    });
    this.tracePaths.delete(context.runId);
    this.runsWithScreenshot.delete(context.runId);
  }

  async cleanup(): Promise<void> {
    try {
      const result = this.options.retention.cleanup();
      if (result.errorCount > 0) {
        this.recordObservabilityFailure('RETENTION_CLEANUP_FAILED', {});
      }
    } catch {
      this.recordObservabilityFailure('RETENTION_CLEANUP_FAILED', {});
    }
  }

  private recordObservabilityFailure(
    errorCode: string,
    context: Partial<RuntimeRunContext & RuntimeObservation>,
  ): void {
    this.safeLog('error', observabilityFailureEvent(errorCode, context));
  }

  private safeLog(level: RuntimeObservation['level'], event: RuntimeLogEvent): void {
    try {
      this.options.logger.emit(level, event);
    } catch {
      this.safeFallback('SparkKeeper structured logging failed.');
    }
  }

  private safeRealtimeBroadcast(event: RuntimeObservation): void {
    try {
      this.options.realtime?.publish({
        type: 'RUNTIME_EVENT',
        data: {
          eventType: event.eventType,
          level: event.level,
          message: safeEventMessage(event.eventType),
          ...(event.runId === undefined ? {} : { runId: event.runId }),
          ...(event.accountId === undefined ? {} : { accountId: event.accountId }),
          ...(event.friendId === undefined ? {} : { friendId: event.friendId }),
          ...(event.businessDate === undefined ? {} : { businessDate: event.businessDate }),
          ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
          ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
          ...(event.nextRetryAt === undefined
            ? {}
            : { nextRetryAt: event.nextRetryAt.toISOString() }),
          ...(event.successCount === undefined ? {} : { successCount: event.successCount }),
          ...(event.failedCount === undefined ? {} : { failedCount: event.failedCount }),
          ...(event.retryWaitCount === undefined ? {} : { retryWaitCount: event.retryWaitCount }),
          ...(event.idempotentSkipCount === undefined
            ? {}
            : { idempotentSkipCount: event.idempotentSkipCount }),
          ...(event.runResult === undefined ? {} : { runResult: event.runResult }),
        },
      });
    } catch {
      this.safeLog('error', observabilityFailureEvent('REALTIME_BROADCAST_FAILED', event));
      this.safeFallback('SparkKeeper realtime broadcast failed.');
    }
  }

  private safeNotificationPublish(event: RuntimeObservation): void {
    const notifications = this.options.notifications;
    if (notifications === undefined) return;

    try {
      if (event.eventType === 'RUN_STARTED' && event.runId !== undefined) {
        this.pendingRunNotifications.delete(event.runId);
      }

      if (event.eventType === 'RUN_FINISHED' && event.runId !== undefined) {
        const pending = this.pendingRunNotifications.get(event.runId);
        this.pendingRunNotifications.delete(event.runId);
        if (pending !== undefined) notifications.publish(pending);
        return;
      }

      const terminalCandidate = toTerminalNotificationCandidate(event, this.clock().toISOString());
      if (terminalCandidate !== undefined && event.runId !== undefined) {
        const existing = this.pendingRunNotifications.get(event.runId);
        if (
          existing === undefined ||
          terminalNotificationPriority(terminalCandidate.eventType) >
            terminalNotificationPriority(existing.eventType)
        ) {
          this.pendingRunNotifications.set(event.runId, terminalCandidate);
        }
        return;
      }

      notifications.publish(toNotificationCandidate(event, this.clock().toISOString()));
    } catch {
      this.safeLog('error', observabilityFailureEvent('NOTIFICATION_PUBLISH_FAILED', event));
      this.safeFallback('SparkKeeper notification scheduling failed.');
    }
  }

  private async safeConsecutiveFailureObserve(event: RuntimeObservation): Promise<void> {
    if (
      event.eventType !== 'RUN_FINISHED' ||
      event.runId === undefined ||
      event.accountId === undefined ||
      event.businessDate === undefined ||
      event.runResult === undefined ||
      this.options.consecutiveFailures === undefined
    ) {
      return;
    }

    let shouldEmit: boolean;
    try {
      shouldEmit = this.options.consecutiveFailures.shouldEmit({
        accountId: event.accountId,
        businessDate: event.businessDate,
        runResult: event.runResult,
      });
    } catch {
      this.safeLog(
        'error',
        observabilityFailureEvent('CONSECUTIVE_RUN_FAILURE_DETECTION_FAILED', event),
      );
      this.safeFallback('SparkKeeper consecutive failure detection failed.');
      return;
    }

    if (!shouldEmit) return;
    await this.observe({
      accountId: event.accountId,
      runId: event.runId,
      businessDate: event.businessDate,
      eventType: 'CONSECUTIVE_RUN_FAILURE',
      level: 'error',
      errorCode: 'CONSECUTIVE_RUN_FAILURE',
      captureScreenshot: false,
    });
  }

  private safeFallback(message: string): void {
    try {
      this.fallback(message);
    } catch {
      // Observability must never control business state.
    }
  }
}

function toNotificationCandidate(
  event: RuntimeObservation,
  timestamp: string,
): NotificationEventCandidate {
  return {
    eventType: event.eventType,
    severity: event.level === 'error' ? 'ERROR' : 'WARN',
    safeMessage: safeEventMessage(event.eventType),
    timestamp,
    ...(event.runId === undefined ? {} : { runId: event.runId }),
    ...(event.accountId === undefined ? {} : { accountId: event.accountId }),
    ...(event.businessDate === undefined ? {} : { businessDate: event.businessDate }),
    ...(event.errorCode === undefined ? {} : { errorCode: event.errorCode }),
  };
}

function toTerminalNotificationCandidate(
  event: RuntimeObservation,
  timestamp: string,
): TerminalNotificationCandidate | undefined {
  let eventType: NotificationEventType;
  if (event.eventType === 'AUTH_EXPIRED') eventType = 'AUTH_EXPIRED';
  else if (event.eventType === 'DELIVERY_UNKNOWN') eventType = 'DELIVERY_UNKNOWN';
  else if (event.eventType === 'TASK_FAILED') {
    eventType = event.errorCode === 'DELIVERY_UNKNOWN' ? 'DELIVERY_UNKNOWN' : 'TASK_FAILED';
  } else {
    return undefined;
  }

  return {
    ...toNotificationCandidate(event, timestamp),
    eventType,
    safeMessage: safeEventMessage(eventType),
  };
}

function terminalNotificationPriority(eventType: NotificationEventType): number {
  if (eventType === 'AUTH_EXPIRED') return 3;
  if (eventType === 'DELIVERY_UNKNOWN') return 2;
  return 1;
}

function observabilityFailureEvent(
  errorCode: string,
  context: Partial<RuntimeRunContext & RuntimeObservation>,
): RuntimeLogEvent {
  return {
    eventType: 'OBSERVABILITY_ERROR',
    errorCode,
    ...(context.runId === undefined ? {} : { runId: context.runId }),
    ...(context.accountId === undefined ? {} : { accountId: context.accountId }),
    ...(context.friendId === undefined ? {} : { friendId: context.friendId }),
    ...(context.attempt === undefined ? {} : { attempt: context.attempt }),
    ...(context.businessDate === undefined ? {} : { businessDate: context.businessDate }),
  };
}
