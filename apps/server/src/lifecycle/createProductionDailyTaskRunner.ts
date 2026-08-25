import {
  AccountRepository,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
  SystemEventRepository,
  type DatabaseClient,
} from '@sparkkeeper/database';
import type { NotificationService } from '@sparkkeeper/notifier';

import { DailyTaskRunner } from '../application/DailyTaskRunner.js';
import { ProductionDailyTaskAutomation } from '../automation/ProductionDailyTaskAutomation.js';
import type { ObservabilityConfig } from '../config/ObservabilityConfig.js';
import { ProductionRuntimeObserver } from '../observability/ProductionRuntimeObserver.js';
import { RetentionManager } from '../observability/RetentionManager.js';
import type { RuntimeLogger } from '../observability/RuntimeLogger.js';
import { ScreenshotManager } from '../observability/ScreenshotManager.js';
import { TraceManager } from '../observability/TraceManager.js';
import type { RealtimeEventPublisher } from '../realtime/RealtimeEvent.js';

export interface ProductionDailyTaskRunnerOptions {
  readonly database: DatabaseClient;
  readonly accountId: string;
  readonly templateId: string;
  readonly observability: ObservabilityConfig;
  readonly logger: RuntimeLogger;
  readonly realtime?: RealtimeEventPublisher;
  readonly notifications?: Pick<NotificationService, 'publish'>;
  readonly clock?: () => Date;
}

export interface ProductionDailyTaskRunnerComposition {
  readonly runner: DailyTaskRunner;
  readonly observer: ProductionRuntimeObserver;
  readonly schedules: ScheduleRepository;
}

export function createProductionDailyTaskRunner(
  options: ProductionDailyTaskRunnerOptions,
): ProductionDailyTaskRunnerComposition {
  const automation = new ProductionDailyTaskAutomation();
  const schedules = new ScheduleRepository(options.database);
  const observer = new ProductionRuntimeObserver({
    logger: options.logger,
    systemEvents: new SystemEventRepository(options.database),
    screenshots: new ScreenshotManager(options.observability.screenshotRoot, {
      capture: (absolutePath) => automation.captureScreenshot(absolutePath),
    }),
    traces: new TraceManager(options.observability.traceMode, options.observability.traceRoot, {
      start: () => automation.startTrace(),
      stop: (absolutePath) => automation.stopTrace(absolutePath),
    }),
    retention: new RetentionManager({
      screenshotRoot: options.observability.screenshotRoot,
      traceRoot: options.observability.traceRoot,
      screenshotRetentionDays: options.observability.screenshotRetentionDays,
      traceRetentionDays: options.observability.traceRetentionDays,
    }),
    ...(options.realtime === undefined ? {} : { realtime: options.realtime }),
    ...(options.notifications === undefined ? {} : { notifications: options.notifications }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  return {
    schedules,
    observer,
    runner: new DailyTaskRunner({
      accountId: options.accountId,
      messageTemplateId: options.templateId,
      allowRealSend: true,
      automation,
      accounts: new AccountRepository(options.database),
      schedules,
      friends: new FriendRepository(options.database),
      templates: new MessageTemplateRepository(options.database),
      dailyRuns: new DailyRunRepository(options.database),
      sendRecords: new SendRecordRepository(options.database),
      observer,
      ...(options.clock === undefined ? {} : { now: options.clock }),
    }),
  };
}
