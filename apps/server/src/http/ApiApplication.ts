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
  type DatabaseEnvironment,
} from '@sparkkeeper/database';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import { RunExecutionCoordinator } from '../application/RunExecutionCoordinator.js';
import { resolveManualRunConfig, type ManualRunEnvironment } from '../config/ManualRunConfig.js';
import {
  resolveObservabilityConfig,
  type ObservabilityEnvironment,
} from '../config/ObservabilityConfig.js';
import { resolveSchedulerConfig, type SchedulerEnvironment } from '../config/SchedulerConfig.js';
import { PINO_REDACT_PATHS } from '../observability/RuntimeLogger.js';
import { RuntimeEventHub } from '../realtime/RuntimeEventHub.js';
import { resolveHttpConfig, type HttpConfig, type HttpEnvironment } from './config/HttpConfig.js';
import { createServer } from './createServer.js';
import { localMutationGuardOptions } from './plugins/MutationGuard.js';
import { ApiConfigurationService } from './services/ApiConfigurationService.js';
import { ApiReadService } from './services/ApiReadService.js';
import { StatusService } from './services/StatusService.js';
import {
  ManualRunService,
  type ManualRunRunnerFactory,
  type ManualRunServiceOptions,
} from './services/ManualRunService.js';
import { ProductionManualRunRunnerFactory } from './services/ProductionManualRunRunnerFactory.js';

export type ServerEnvironment = HttpEnvironment &
  SchedulerEnvironment &
  ObservabilityEnvironment &
  ManualRunEnvironment;

export interface CreateApiApplicationOptions {
  readonly environment?: ServerEnvironment;
  readonly cwd?: string;
  readonly databasePath?: string;
  readonly logger?: FastifyServerOptions['logger'];
  readonly clock?: () => Date;
  readonly realtime?: RuntimeEventHub;
  readonly sseHeartbeatMs?: number;
  readonly sseRetryMs?: number;
  readonly coordinator?: RunExecutionCoordinator;
  readonly manualRunRunnerFactory?: ManualRunRunnerFactory;
  readonly onManualRunBackgroundFailure?: NonNullable<
    ManualRunServiceOptions['onBackgroundFailure']
  >;
}

export interface ApiApplication {
  readonly server: FastifyInstance;
  readonly database: DatabaseClient;
  readonly config: HttpConfig;
  readonly realtime: RuntimeEventHub;
  readonly manualRun: ManualRunService;
  closeHttp(): Promise<void>;
  stopManualRuns(): Promise<void>;
  closeDatabase(): void;
  close(): Promise<void>;
}

const HTTP_REDACT_PATHS = [
  ...PINO_REDACT_PATHS,
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
] as const;

export function createApiApplication(options: CreateApiApplicationOptions = {}): ApiApplication {
  const environment = options.environment ?? process.env;
  const config = resolveHttpConfig(environment);
  const schedulerConfig = resolveSchedulerConfig(environment);
  const manualRunConfig = resolveManualRunConfig(environment);
  const observabilityConfig = resolveObservabilityConfig(environment, options.cwd);
  const databaseEnvironment: DatabaseEnvironment = { DATA_DIR: environment.DATA_DIR };
  const database = createDatabase({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.databasePath === undefined ? {} : { databasePath: options.databasePath }),
    environment: databaseEnvironment,
  });

  try {
    const realtime = options.realtime ?? new RuntimeEventHub(options.clock);
    const backgroundDiagnostics: { server?: FastifyInstance } = {};
    const migration = database.migrate();
    const accounts = new AccountRepository(database);
    const friends = new FriendRepository(database);
    const schedules = new ScheduleRepository(database);
    const templates = new MessageTemplateRepository(database);
    const systemEvents = new SystemEventRepository(database);
    const coordinator = options.coordinator ?? new RunExecutionCoordinator();
    const manualRun = new ManualRunService({
      repositories: {
        accounts,
        schedules,
        friends,
        templates,
        dailyRuns: new DailyRunRepository(database),
        sendRecords: new SendRecordRepository(database),
      },
      manualRunEnabled: manualRunConfig.enabled,
      realSendAuthorizationEnabled: schedulerConfig.allowRealSend,
      coordinator,
      runnerFactory:
        options.manualRunRunnerFactory ??
        new ProductionManualRunRunnerFactory({
          database,
          observability: observabilityConfig,
          realtime,
          ...(options.clock === undefined ? {} : { clock: options.clock }),
        }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.onManualRunBackgroundFailure === undefined
        ? {
            onBackgroundFailure: (context) => {
              try {
                systemEvents.create({
                  eventType: 'TASK_FAILED',
                  level: 'ERROR',
                  accountId: context.accountId,
                  runId: context.runId,
                  errorCode: 'MANUAL_RUN_BACKGROUND_FAILED',
                  message: 'Manual Run stopped after an unexpected background failure.',
                });
              } catch {
                // Persistence failure cannot change the conservative terminal state.
              }
              try {
                realtime.publish({
                  type: 'RUNTIME_EVENT',
                  data: {
                    eventType: 'RUN_FINISHED',
                    level: 'error',
                    message: 'Daily run finished',
                    accountId: context.accountId,
                    runId: context.runId,
                    businessDate: context.businessDate,
                    errorCode: 'MANUAL_RUN_BACKGROUND_FAILED',
                    runResult: 'FAILED',
                  },
                });
              } catch {
                // Realtime is a non-critical side channel.
              }
              backgroundDiagnostics.server?.log.error(
                { eventType: 'MANUAL_RUN_BACKGROUND_FAILED' },
                'Manual Run background execution failed; inspect persisted run state.',
              );
            },
          }
        : { onBackgroundFailure: options.onManualRunBackgroundFailure }),
    });
    const services = {
      status: new StatusService({
        database,
        migrationReady: () => {
          const inspection = database.inspect();
          return (
            inspection.appliedMigrationCount === migration.appliedMigrationCount &&
            inspection.accountsSchemaCompatible &&
            inspection.dailyRunsSchemaCompatible &&
            inspection.friendsSchemaCompatible &&
            inspection.messageTemplatesSchemaCompatible &&
            inspection.sendRecordsSchemaCompatible &&
            inspection.schedulesSchemaCompatible &&
            inspection.systemEventsSchemaCompatible
          );
        },
        schedulerEnabled: schedulerConfig.enabled,
        realSendAuthorizationEnabled: schedulerConfig.allowRealSend,
        manualRunEnabled: manualRunConfig.enabled,
        timezone: config.timezone,
        observabilityReady: true,
        browserProfileConfigured: config.browserProfileConfigured,
        version: config.version,
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      }),
      read: new ApiReadService({
        accounts,
        friends,
        schedules,
        dailyRuns: new DailyRunRepository(database),
        sendRecords: new SendRecordRepository(database),
        systemEvents,
      }),
      configuration: new ApiConfigurationService(
        { accounts, friends, schedules, templates },
        options.clock,
        realtime,
      ),
      manualRun,
    };
    const server = createServer({
      services,
      logger:
        options.logger ??
        ({
          level: observabilityConfig.logLevel,
          redact: { paths: [...HTTP_REDACT_PATHS], censor: '[REDACTED]' },
        } satisfies FastifyServerOptions['logger']),
      mutationGuard: localMutationGuardOptions(config.port),
      realtime: {
        events: realtime,
        access: localMutationGuardOptions(config.port),
        ...(options.sseHeartbeatMs === undefined ? {} : { heartbeatMs: options.sseHeartbeatMs }),
        ...(options.sseRetryMs === undefined ? {} : { retryMs: options.sseRetryMs }),
      },
    });
    backgroundDiagnostics.server = server;

    let httpClosed = false;
    let databaseClosed = false;
    let manualRunsStopped = false;
    const closeHttp = async (): Promise<void> => {
      if (httpClosed) return;
      await server.close();
      httpClosed = true;
    };
    const closeDatabase = (): void => {
      if (databaseClosed) return;
      database.close();
      databaseClosed = true;
    };
    const stopManualRuns = async (): Promise<void> => {
      if (manualRunsStopped) return;
      await manualRun.stop();
      manualRunsStopped = true;
    };
    return {
      server,
      database,
      config,
      realtime,
      manualRun,
      closeHttp,
      stopManualRuns,
      closeDatabase,
      async close(): Promise<void> {
        try {
          await closeHttp();
        } finally {
          try {
            await stopManualRuns();
          } finally {
            closeDatabase();
          }
        }
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function listenApiApplication(application: ApiApplication): Promise<string> {
  return application.server.listen({
    host: application.config.host,
    port: application.config.port,
  });
}
