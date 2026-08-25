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

import {
  resolveObservabilityConfig,
  type ObservabilityEnvironment,
} from '../config/ObservabilityConfig.js';
import { resolveSchedulerConfig, type SchedulerEnvironment } from '../config/SchedulerConfig.js';
import { PINO_REDACT_PATHS } from '../observability/RuntimeLogger.js';
import { resolveHttpConfig, type HttpConfig, type HttpEnvironment } from './config/HttpConfig.js';
import { createServer } from './createServer.js';
import { localMutationGuardOptions } from './plugins/MutationGuard.js';
import { ApiConfigurationService } from './services/ApiConfigurationService.js';
import { ApiReadService } from './services/ApiReadService.js';
import { StatusService } from './services/StatusService.js';

export type ServerEnvironment = HttpEnvironment & SchedulerEnvironment & ObservabilityEnvironment;

export interface CreateApiApplicationOptions {
  readonly environment?: ServerEnvironment;
  readonly cwd?: string;
  readonly databasePath?: string;
  readonly logger?: FastifyServerOptions['logger'];
  readonly clock?: () => Date;
}

export interface ApiApplication {
  readonly server: FastifyInstance;
  readonly database: DatabaseClient;
  readonly config: HttpConfig;
  closeHttp(): Promise<void>;
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
  const observabilityConfig = resolveObservabilityConfig(environment, options.cwd);
  const databaseEnvironment: DatabaseEnvironment = { DATA_DIR: environment.DATA_DIR };
  const database = createDatabase({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.databasePath === undefined ? {} : { databasePath: options.databasePath }),
    environment: databaseEnvironment,
  });

  try {
    const migration = database.migrate();
    const accounts = new AccountRepository(database);
    const friends = new FriendRepository(database);
    const schedules = new ScheduleRepository(database);
    const templates = new MessageTemplateRepository(database);
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
        systemEvents: new SystemEventRepository(database),
      }),
      configuration: new ApiConfigurationService(
        { accounts, friends, schedules, templates },
        options.clock,
      ),
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
    });

    let httpClosed = false;
    let databaseClosed = false;
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
    return {
      server,
      database,
      config,
      closeHttp,
      closeDatabase,
      async close(): Promise<void> {
        try {
          await closeHttp();
        } finally {
          closeDatabase();
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
