import { createDatabase, type DatabaseClient } from '@sparkkeeper/database';
import type { NotificationService } from '@sparkkeeper/notifier';

import { RunExecutionCoordinator } from '../application/RunExecutionCoordinator.js';
import { resolveSchedulerConfig, type SchedulerEnvironment } from '../config/SchedulerConfig.js';
import {
  resolveObservabilityConfig,
  type ObservabilityEnvironment,
} from '../config/ObservabilityConfig.js';
import {
  createProductionRuntimeLogger,
  type RuntimeLogger,
} from '../observability/RuntimeLogger.js';
import type { RealtimeEventPublisher } from '../realtime/RealtimeEvent.js';
import { TaskScheduler } from '../scheduler/TaskScheduler.js';
import { createProductionDailyTaskRunner } from './createProductionDailyTaskRunner.js';

export class SchedulerService {
  private client: DatabaseClient | undefined;
  private scheduler: TaskScheduler | undefined;
  private logger: RuntimeLogger | undefined;

  constructor(
    private readonly realtime?: RealtimeEventPublisher,
    private readonly coordinator = new RunExecutionCoordinator(),
    private readonly notifications?: Pick<NotificationService, 'publish'>,
  ) {}

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
      const { runner, observer, schedules } = createProductionDailyTaskRunner({
        database: client,
        accountId: config.accountId,
        templateId: config.messageTemplateId,
        observability: observabilityConfig,
        logger,
        ...(this.realtime === undefined ? {} : { realtime: this.realtime }),
        ...(this.notifications === undefined ? {} : { notifications: this.notifications }),
      });
      await observer.cleanup();
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
        this.coordinator,
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
