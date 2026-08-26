import type { DatabaseClient } from '@sparkkeeper/database';
import type { NotificationService } from '@sparkkeeper/notifier';

import type { ObservabilityConfig } from '../../config/ObservabilityConfig.js';
import {
  createProductionRuntimeLogger,
  type RuntimeLogger,
} from '../../observability/RuntimeLogger.js';
import type { RealtimeEventPublisher } from '../../realtime/RealtimeEvent.js';
import { createProductionDailyTaskRunner } from '../../lifecycle/createProductionDailyTaskRunner.js';
import type { ManualRunRunner, ManualRunRunnerFactory } from './ManualRunService.js';

export interface ProductionManualRunRunnerFactoryOptions {
  readonly database: DatabaseClient;
  readonly observability: ObservabilityConfig;
  readonly realtime?: RealtimeEventPublisher;
  readonly notifications?: Pick<NotificationService, 'publish'>;
  readonly clock?: () => Date;
}

export class ProductionManualRunRunnerFactory implements ManualRunRunnerFactory {
  private logger: RuntimeLogger | undefined;
  private retentionCleanup: Promise<void> | undefined;

  constructor(private readonly options: ProductionManualRunRunnerFactoryOptions) {}

  create(accountId: string, templateId: string): ManualRunRunner {
    const composition = createProductionDailyTaskRunner({
      database: this.options.database,
      accountId,
      templateId,
      observability: this.options.observability,
      logger: this.runtimeLogger(),
      ...(this.options.realtime === undefined ? {} : { realtime: this.options.realtime }),
      ...(this.options.notifications === undefined
        ? {}
        : { notifications: this.options.notifications }),
      ...(this.options.clock === undefined ? {} : { clock: this.options.clock }),
    });
    this.retentionCleanup ??= composition.observer.cleanup().catch(() => {
      // Evidence retention is observability-only and cannot block Manual Run execution.
    });
    return {
      run: async (runAccountId, businessDate, mode) => {
        await this.retentionCleanup;
        return composition.runner.run(runAccountId, businessDate, mode);
      },
    };
  }

  async close(): Promise<void> {
    await this.retentionCleanup;
    this.retentionCleanup = undefined;
    await this.logger?.close();
    this.logger = undefined;
  }

  private runtimeLogger(): RuntimeLogger {
    this.logger ??= createProductionRuntimeLogger(this.options.observability);
    return this.logger;
  }
}
