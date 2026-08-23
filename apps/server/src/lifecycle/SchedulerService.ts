import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
  SystemEventRepository,
  type DatabaseClient,
} from '@sparkkeeper/database';

import { DailyTaskRunner } from '../application/DailyTaskRunner.js';
import { ProductionDailyTaskAutomation } from '../automation/ProductionDailyTaskAutomation.js';
import { resolveSchedulerConfig, type SchedulerEnvironment } from '../config/SchedulerConfig.js';
import {
  resolveObservabilityConfig,
  type ObservabilityEnvironment,
} from '../config/ObservabilityConfig.js';
import { ProductionRuntimeObserver } from '../observability/ProductionRuntimeObserver.js';
import { RetentionManager } from '../observability/RetentionManager.js';
import {
  createProductionRuntimeLogger,
  type RuntimeLogger,
} from '../observability/RuntimeLogger.js';
import { ScreenshotManager } from '../observability/ScreenshotManager.js';
import { TraceManager } from '../observability/TraceManager.js';
import { TaskScheduler } from '../scheduler/TaskScheduler.js';

export class SchedulerService {
  private client: DatabaseClient | undefined;
  private scheduler: TaskScheduler | undefined;
  private logger: RuntimeLogger | undefined;

  async start(
    environment: SchedulerEnvironment & ObservabilityEnvironment = process.env,
  ): Promise<'DISABLED' | 'BLOCKED' | 'STARTED'> {
    const observabilityConfig = resolveObservabilityConfig(environment);
    const config = resolveSchedulerConfig(environment);
    if (!config.enabled) return 'DISABLED';
    if (!config.allowRealSend) return 'BLOCKED';
    if (config.accountId === undefined || config.messageTemplateId === undefined) {
      throw new Error('Scheduler explicit identifiers are unavailable.');
    }
    const logger = createProductionRuntimeLogger(observabilityConfig);
    this.logger = logger;
    let client: DatabaseClient | undefined;
    try {
      client = createDatabase();
      client.migrate();
      const schedules = new ScheduleRepository(client);
      const automation = new ProductionDailyTaskAutomation();
      const observer = new ProductionRuntimeObserver({
        logger,
        systemEvents: new SystemEventRepository(client),
        screenshots: new ScreenshotManager(observabilityConfig.screenshotRoot, {
          capture: (absolutePath) => automation.captureScreenshot(absolutePath),
        }),
        traces: new TraceManager(observabilityConfig.traceMode, observabilityConfig.traceRoot, {
          start: () => automation.startTrace(),
          stop: (absolutePath) => automation.stopTrace(absolutePath),
        }),
        retention: new RetentionManager({
          screenshotRoot: observabilityConfig.screenshotRoot,
          traceRoot: observabilityConfig.traceRoot,
          screenshotRetentionDays: observabilityConfig.screenshotRetentionDays,
          traceRetentionDays: observabilityConfig.traceRetentionDays,
        }),
      });
      await observer.cleanup();
      const runner = new DailyTaskRunner({
        accountId: config.accountId,
        messageTemplateId: config.messageTemplateId,
        allowRealSend: true,
        automation,
        accounts: new AccountRepository(client),
        schedules,
        friends: new FriendRepository(client),
        templates: new MessageTemplateRepository(client),
        dailyRuns: new DailyRunRepository(client),
        sendRecords: new SendRecordRepository(client),
        observer,
      });
      this.client = client;
      this.scheduler = new TaskScheduler(
        config.accountId,
        schedules,
        runner,
        undefined,
        undefined,
        undefined,
        (error) => {
          logger.emit('error', {
            eventType: 'BROWSER_ERROR',
            errorCode: 'SCHEDULER_TICK_FAILED',
          });
          void error;
        },
        observer,
      );
      this.scheduler.start();
      return 'STARTED';
    } catch (error) {
      try {
        logger.emit('error', {
          eventType: 'OBSERVABILITY_ERROR',
          errorCode: 'SERVER_START_FAILED',
        });
      } catch {
        // Startup error remains primary when logging is unavailable.
      }
      client?.close();
      try {
        await logger.close();
      } catch {
        // Startup error remains primary when logger flush fails.
      }
      this.logger = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.scheduler?.stop();
    this.scheduler = undefined;
    this.client?.close();
    this.client = undefined;
    await this.logger?.close();
    this.logger = undefined;
  }
}
