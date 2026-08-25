import {
  createApiApplication,
  listenApiApplication,
  type ApiApplication,
  type ServerEnvironment,
} from '../http/ApiApplication.js';
import { RuntimeEventHub } from '../realtime/RuntimeEventHub.js';
import { SchedulerService } from './SchedulerService.js';

export interface SparkKeeperStartResult {
  readonly address: string;
  readonly scheduler: 'DISABLED' | 'BLOCKED' | 'STARTED';
}

export class SparkKeeperService {
  private application: ApiApplication | undefined;
  private stopping: Promise<void> | undefined;
  private readonly scheduler: SchedulerService;
  private readonly realtime: RuntimeEventHub;

  constructor(scheduler?: SchedulerService, realtime = new RuntimeEventHub()) {
    this.realtime = realtime;
    this.scheduler = scheduler ?? new SchedulerService(realtime);
  }

  async start(environment: ServerEnvironment = process.env): Promise<SparkKeeperStartResult> {
    if (this.application !== undefined) {
      throw new Error('SparkKeeper service is already started.');
    }

    const application = createApiApplication({ environment, realtime: this.realtime });
    this.application = application;
    try {
      const address = await listenApiApplication(application);
      const scheduler = await this.scheduler.start(environment);
      return { address, scheduler };
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping !== undefined) return this.stopping;
    this.stopping = this.stopResources();
    try {
      await this.stopping;
    } finally {
      this.stopping = undefined;
    }
  }

  private async stopResources(): Promise<void> {
    const application = this.application;
    this.application = undefined;
    let firstError: unknown;

    try {
      await application?.closeHttp();
    } catch (error) {
      firstError = error;
    }
    try {
      await this.scheduler.stop();
    } catch (error) {
      firstError ??= error;
    }
    try {
      application?.closeDatabase();
    } catch (error) {
      firstError ??= error;
    }

    if (firstError !== undefined) throw firstError;
  }
}
