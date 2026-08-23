import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
  type DatabaseClient,
} from '@sparkkeeper/database';

import { DailyTaskRunner } from '../application/DailyTaskRunner.js';
import { ProductionDailyTaskAutomation } from '../automation/ProductionDailyTaskAutomation.js';
import { resolveSchedulerConfig, type SchedulerEnvironment } from '../config/SchedulerConfig.js';
import { TaskScheduler } from '../scheduler/TaskScheduler.js';

export class SchedulerService {
  private client: DatabaseClient | undefined;
  private scheduler: TaskScheduler | undefined;

  async start(
    environment: SchedulerEnvironment = process.env,
  ): Promise<'DISABLED' | 'BLOCKED' | 'STARTED'> {
    const config = resolveSchedulerConfig(environment);
    if (!config.enabled) return 'DISABLED';
    if (!config.allowRealSend) return 'BLOCKED';
    if (config.accountId === undefined || config.messageTemplateId === undefined) {
      throw new Error('Scheduler explicit identifiers are unavailable.');
    }
    const client = createDatabase();
    try {
      client.migrate();
      const schedules = new ScheduleRepository(client);
      const runner = new DailyTaskRunner({
        accountId: config.accountId,
        messageTemplateId: config.messageTemplateId,
        allowRealSend: true,
        automation: new ProductionDailyTaskAutomation(),
        accounts: new AccountRepository(client),
        schedules,
        friends: new FriendRepository(client),
        templates: new MessageTemplateRepository(client),
        dailyRuns: new DailyRunRepository(client),
        sendRecords: new SendRecordRepository(client),
      });
      this.client = client;
      this.scheduler = new TaskScheduler(config.accountId, schedules, runner);
      this.scheduler.start();
      return 'STARTED';
    } catch (error) {
      client.close();
      throw error;
    }
  }

  async stop(): Promise<void> {
    await this.scheduler?.stop();
    this.scheduler = undefined;
    this.client?.close();
    this.client = undefined;
  }
}
