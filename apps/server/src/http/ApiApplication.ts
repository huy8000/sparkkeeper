import {
  ScheduledSendRepository,
  MigrationRepository,
  SafeRuntimeEventRepository,
  TestSendRepository,
  TargetResolverSnapshotRepository,
  AccountRepository,
  AccountOnboardingRepository,
  ContactDiscoveryRepository,
  AdminAuthRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  NotificationConfigRepository,
  ScheduleRepository,
  SendRecordRepository,
  SystemEventRepository,
  type DatabaseClient,
  type DatabaseEnvironment,
  resolveDatabasePath,
} from '@sparkkeeper/database';
import path from 'node:path';
import { V4SafeEventRelay } from '../observability/V4SafeEventRelay.js';
import { AdminSecurityRepository } from '@sparkkeeper/database';
import { AdminSecurityService } from '../security/AdminSecurityService.js';
import { MigrationApiService } from './services/MigrationApiService.js';
import { SendTaskScheduler } from '../scheduling/SendTaskScheduler.js';
import { TestSendManager, type TestSendRuntimeFactory } from '../test-send/TestSendManager.js';
import { TargetResolutionService } from '../automation/TargetResolutionService.js';
import {
  NodeWebhookTransport,
  NotificationService,
  PublicDestinationPolicy,
  WebhookProvider,
  type NotificationProvider,
} from '@sparkkeeper/notifier';
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
import { AdminAuthenticationService } from '../security/AdminAuthenticationService.js';
import { AdminSessionService } from '../security/AdminSessionService.js';
import { LoginRateLimiter } from '../security/LoginRateLimiter.js';
import { PasswordHasher } from '../security/PasswordHasher.js';
import { resolveHttpConfig, type HttpConfig, type HttpEnvironment } from './config/HttpConfig.js';
import { createServer } from './createServer.js';
import type { AdminAuthGuardRegistration } from './plugins/AdminAuthGuards.js';
import { ApiConfigurationService } from './services/ApiConfigurationService.js';
import { ApiReadService } from './services/ApiReadService.js';
import type { ApiServices } from './services/ApiServices.js';
import { StatusService } from './services/StatusService.js';
import {
  ManualRunService,
  type ManualRunRunnerFactory,
  type ManualRunServiceOptions,
} from './services/ManualRunService.js';
import { ProductionManualRunRunnerFactory } from './services/ProductionManualRunRunnerFactory.js';
import { NotificationConfigurationService } from './services/NotificationConfigurationService.js';
import { DatabaseNotificationConfigurationSource } from '../notifications/DatabaseNotificationConfigurationSource.js';
import { AccountProfileStore } from '../onboarding/AccountProfileStore.js';
import { AccountConsoleConnections } from '../onboarding/AuthenticatedConsoleGateway.js';
import { AccountLoginWorkerSupervisor } from '../onboarding/AccountLoginWorkerSupervisor.js';
import { AccountOnboardingManager } from '../onboarding/AccountOnboardingManager.js';
import { BrowserOperationCoordinator } from '../onboarding/BrowserOperationCoordinator.js';
import { ContactDiscoveryManager } from '../contacts/ContactDiscoveryManager.js';
import {
  ContactDiscoveryWorkerSupervisor,
  type DiscoverySupervisor,
} from '../contacts/ContactDiscoveryWorkerSupervisor.js';
import { AvatarCacheStore } from '../contacts/AvatarCacheStore.js';

export type ServerEnvironment = HttpEnvironment &
  SchedulerEnvironment &
  ObservabilityEnvironment &
  ManualRunEnvironment;

export interface CreateApiApplicationOptions {
  readonly scheduling?: {
    runtime?: TestSendRuntimeFactory;
    master?: () => boolean;
    released?: () => boolean;
  };
  readonly testSendRuntime?: TestSendRuntimeFactory;
  readonly environment?: ServerEnvironment;
  readonly cwd?: string;
  readonly databasePath?: string;
  readonly logger?: FastifyServerOptions['logger'];
  readonly clock?: () => Date;
  readonly realtime?: RuntimeEventHub;
  readonly sseHeartbeatMs?: number;
  readonly sseRetryMs?: number;
  readonly sseSessionRevalidateMs?: number;
  readonly coordinator?: RunExecutionCoordinator;
  readonly manualRunRunnerFactory?: ManualRunRunnerFactory;
  readonly onManualRunBackgroundFailure?: NonNullable<
    ManualRunServiceOptions['onBackgroundFailure']
  >;
  readonly notificationAddressPolicy?: Pick<PublicDestinationPolicy, 'resolve'>;
  readonly notificationProvider?: NotificationProvider;
  readonly onboardingSupervisor?: AccountLoginWorkerSupervisor;
  readonly discoverySupervisor?: DiscoverySupervisor;
}

export interface ApiApplication {
  readonly scheduling: SendTaskScheduler;
  readonly testSend: TestSendManager;
  readonly server: FastifyInstance;
  readonly authGuards: AdminAuthGuardRegistration;
  readonly database: DatabaseClient;
  readonly config: HttpConfig;
  readonly realtime: RuntimeEventHub;
  readonly manualRun: ManualRunService;
  readonly notifications: NotificationService;
  readonly services: ApiServices;
  readonly onboarding: AccountOnboardingManager;
  readonly discovery: ContactDiscoveryManager;
  readonly avatars: AvatarCacheStore;
  recoverOnboarding(): Promise<void>;
  stopOnboarding(): Promise<void>;
  closeHttp(): Promise<void>;
  stopManualRuns(): Promise<void>;
  stopNotifications(): Promise<void>;
  closeDatabase(): void;
  close(): Promise<void>;
}

export const HTTP_REDACT_PATHS = [
  ...PINO_REDACT_PATHS,
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  // A02: raw client IP must never reach log output.
  'req.remoteAddress',
  'req.remotePort',
  'remoteAddress',
  'remotePort',
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
    if (new MigrationRepository(database).hasPendingProfileBinding())
      throw new Error('MIGRATION_RECOVERY_REQUIRED');
    const accounts = new AccountRepository(database);
    const friends = new FriendRepository(database);
    const schedules = new ScheduleRepository(database);
    const templates = new MessageTemplateRepository(database);
    const notificationConfigs = new NotificationConfigRepository(database);
    const systemEvents = new SystemEventRepository(database);
    const notificationAddressPolicy =
      options.notificationAddressPolicy ?? new PublicDestinationPolicy();
    const notificationProvider =
      options.notificationProvider ??
      new WebhookProvider({
        addressPolicy: notificationAddressPolicy,
        transport: new NodeWebhookTransport(),
      });
    const notifications = new NotificationService({
      configuration: new DatabaseNotificationConfigurationSource(notificationConfigs),
      provider: notificationProvider,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      onDelivery: (status) => {
        const fields = {
          eventType: status.result.status === 'SENT' ? 'NOTIFICATION_SENT' : 'NOTIFICATION_FAILED',
          notificationEventType: status.eventType,
          deliveryStatus: status.result.status,
          attempts: status.result.attempts,
          ...('failureCode' in status.result ? { failureCode: status.result.failureCode } : {}),
          ...('httpStatus' in status.result ? { httpStatus: status.result.httpStatus } : {}),
        };
        if (status.result.status === 'SENT') {
          backgroundDiagnostics.server?.log.info(fields, 'Notification delivery completed.');
        } else {
          backgroundDiagnostics.server?.log.warn(fields, 'Notification delivery did not complete.');
        }
      },
    });
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
          notifications,
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

    const authRepo = new AdminAuthRepository(database);
    const hasher = new PasswordHasher();
    const rateLimiter = new LoginRateLimiter();
    const authService = new AdminAuthenticationService(authRepo, hasher, rateLimiter);
    const sessionService = new AdminSessionService(authRepo);
    const securityService = new AdminSecurityService(
      new AdminSecurityRepository(database),
      authRepo,
      hasher,
      rateLimiter,
      options.clock,
    );
    const onboardingRepository = new AccountOnboardingRepository(database);
    const profileDataDirectory = path.dirname(
      resolveDatabasePath({
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.databasePath === undefined ? {} : { databasePath: options.databasePath }),
        environment: databaseEnvironment,
      }),
    );
    const onboardingSupervisor = options.onboardingSupervisor ?? new AccountLoginWorkerSupervisor();
    const browserCoordinator = new BrowserOperationCoordinator();
    const profiles = new AccountProfileStore(profileDataDirectory);
    const scheduling = new SendTaskScheduler(new ScheduledSendRepository(database, options.clock), {
      coordinator: browserCoordinator,
      profiles,
      targets: new TargetResolutionService(new TargetResolverSnapshotRepository(database)),
      isolated: () =>
        !schedulerConfig.enabled &&
        !manualRunConfig.enabled &&
        !schedulerConfig.allowRealSend &&
        !coordinator.isBusy,
      ...options.scheduling,
      clock: options.clock,
    });
    const testSend = new TestSendManager(new TestSendRepository(database), {
      coordinator: browserCoordinator,
      profiles,
      targets: new TargetResolutionService(new TargetResolverSnapshotRepository(database)),
      isolated: () =>
        !schedulerConfig.enabled &&
        !manualRunConfig.enabled &&
        !schedulerConfig.allowRealSend &&
        !coordinator.isBusy,
      runtime: options.testSendRuntime,
      clock: options.clock,
    });
    const discoveryRepository = new ContactDiscoveryRepository(database);
    const browserGateOpen = () =>
      !schedulerConfig.enabled &&
      !manualRunConfig.enabled &&
      !schedulerConfig.allowRealSend &&
      !coordinator.isBusy &&
      !discoveryRepository.executionBusy();
    const managedDataDirectory = path.dirname(profiles.root);
    const runtimeRoot = path.join(managedDataDirectory, 'discovery-runtime');
    const discoverySupervisor =
      options.discoverySupervisor ??
      new ContactDiscoveryWorkerSupervisor(runtimeRoot, {
        isSyncId: (id) => discoveryRepository.find(id) !== undefined,
      });
    const avatars = new AvatarCacheStore(path.join(managedDataDirectory, 'avatars'), database);
    const discovery = new ContactDiscoveryManager(discoveryRepository, {
      coordinator: browserCoordinator,
      profiles,
      supervisor: discoverySupervisor,
      runtimeRoot,
      releaseGateOpen: browserGateOpen,
      avatars,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    const consoleConnections = new AccountConsoleConnections();
    const onboarding = new AccountOnboardingManager({
      repository: onboardingRepository,
      profiles,
      coordinator: browserCoordinator,
      supervisor: onboardingSupervisor,
      invalidateConsole: (sessionId) => consoleConnections.close(sessionId),
      releaseGateOpen: browserGateOpen,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
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
            inspection.notificationConfigsSchemaCompatible &&
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
      auth: authService,
      sessions: sessionService,
      security: securityService,
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
      notifications: new NotificationConfigurationService({
        repository: notificationConfigs,
        addressPolicy: notificationAddressPolicy,
        notifications,
        realtime,
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      }),
      manualRun,
    };
    const { server, authGuards } = createServer({
      services,
      migration: new MigrationApiService(database, realtime, options.clock),
      config,
      logger:
        options.logger ??
        ({
          level: observabilityConfig.logLevel,
          serializers: {
            req: (request) => ({ method: request.method, id: request.id }),
            res: (reply) => ({ statusCode: reply.statusCode ?? 0 }),
          },
          redact: { paths: [...HTTP_REDACT_PATHS], censor: '[REDACTED]' },
        } satisfies FastifyServerOptions['logger']),
      clock: options.clock,
      onboarding,
      testSend,
      discovery: { manager: discovery, avatars },
      scheduling,
      console: {
        config,
        sessions: sessionService,
        loginSessions: onboardingRepository,
        supervisor: onboardingSupervisor,
        leaseOwner: onboarding,
        connections: consoleConnections,
        clock: options.clock,
      },
      realtime: {
        events: realtime,
        ...(options.sseHeartbeatMs === undefined ? {} : { heartbeatMs: options.sseHeartbeatMs }),
        ...(options.sseRetryMs === undefined ? {} : { retryMs: options.sseRetryMs }),
        ...(options.sseSessionRevalidateMs === undefined
          ? {}
          : { sessionRevalidateMs: options.sseSessionRevalidateMs }),
      },
    });
    backgroundDiagnostics.server = server;
    const eventRelay = new V4SafeEventRelay(
      new SafeRuntimeEventRepository(database),
      realtime,
      notifications,
    );
    eventRelay.start();

    let httpClosed = false;
    let databaseClosed = false;
    let manualRunsStopped = false;
    let notificationsStopped = false;
    let onboardingStopped = false;
    let recovery: Promise<void> | undefined;
    const closeHttp = async (): Promise<void> => {
      if (httpClosed) return;
      await server.close();
      httpClosed = true;
    };
    const closeDatabase = (): void => {
      if (databaseClosed) return;
      eventRelay.stop();
      database.close();
      databaseClosed = true;
    };
    const stopManualRuns = async (): Promise<void> => {
      if (manualRunsStopped) return;
      await manualRun.stop();
      manualRunsStopped = true;
    };
    const stopNotifications = async (): Promise<void> => {
      if (notificationsStopped) return;
      await notifications.stop();
      notificationsStopped = true;
    };
    const stopOnboarding = async (): Promise<void> => {
      if (onboardingStopped) return;
      await testSend.stop();
      await scheduling.stop();
      await discovery.stop();
      consoleConnections.closeAll();
      await onboarding.stop();
      onboardingStopped = true;
    };
    return {
      server,
      authGuards,
      database,
      config,
      realtime,
      manualRun,
      notifications,
      services,
      onboarding,
      discovery,
      avatars,
      testSend,
      scheduling,
      recoverOnboarding: () =>
        (recovery ??= (async () => {
          await testSend.recover();
          await scheduling.recover();
          await discovery.recover();
          await onboarding.recover();
        })()),
      stopOnboarding,
      closeHttp,
      stopManualRuns,
      stopNotifications,
      closeDatabase,
      async close(): Promise<void> {
        try {
          await stopOnboarding();
        } finally {
          try {
            await closeHttp();
          } finally {
            try {
              await stopManualRuns();
            } finally {
              try {
                await stopNotifications();
              } finally {
                closeDatabase();
              }
            }
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
  await application.recoverOnboarding();
  return application.server.listen({
    host: application.config.host,
    port: application.config.port,
  });
}
