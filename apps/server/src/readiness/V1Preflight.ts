import { accessSync, constants, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  openDatabaseReadOnly,
  resolveDatabasePath,
  V1ReleaseReadModel,
} from '@sparkkeeper/database';
import { resolveBusinessTimeZone } from '@sparkkeeper/shared';

import {
  resolveObservabilityConfig,
  type ObservabilityEnvironment,
} from '../config/ObservabilityConfig.js';
import { resolveSchedulerConfig, type SchedulerEnvironment } from '../config/SchedulerConfig.js';

export const EXPECTED_V1_MIGRATION_COUNT = 7;

export interface V1PreflightEnvironment
  extends
    SchedulerEnvironment,
    ObservabilityEnvironment,
    Readonly<Record<string, string | undefined>> {
  readonly BROWSER_PROFILE_DIR?: string;
}

export type ReadyState = 'READY' | 'MISSING' | 'DISABLED' | 'INVALID';

export interface V1PreflightResult {
  readonly database: ReadyState;
  readonly migration: ReadyState;
  readonly account: ReadyState;
  readonly schedule: ReadyState;
  readonly template: ReadyState;
  readonly enabledFriendCount: number;
  readonly browserProfile: 'CONFIGURED' | 'MISSING';
  readonly scheduler: 'DISABLED' | 'ENABLED' | 'INVALID';
  readonly realSendAuthorization: 'DISABLED' | 'ENABLED' | 'INVALID';
  readonly observability: ReadyState;
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

export interface RunV1PreflightOptions {
  readonly environment?: V1PreflightEnvironment;
  readonly workingDirectory?: string;
}

export function runV1Preflight(options: RunV1PreflightOptions = {}): V1PreflightResult {
  const environment = options.environment ?? process.env;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const blockers: string[] = [];
  let observability: ReadyState = 'INVALID';
  let dataDirectory: string | undefined;
  try {
    const config = resolveObservabilityConfig(environment, workingDirectory);
    dataDirectory = config.dataDirectory;
    accessSync(dataDirectory, constants.R_OK | constants.W_OK);
    observability = 'READY';
  } catch {
    blockers.push('Runtime DATA/LOG/TRACE configuration is invalid or inaccessible.');
  }

  let scheduler: V1PreflightResult['scheduler'] = 'INVALID';
  let realSendAuthorization: V1PreflightResult['realSendAuthorization'] = 'INVALID';
  let accountId: string | undefined;
  let templateId: string | undefined;
  try {
    const config = resolveSchedulerConfig(environment);
    scheduler = config.enabled ? 'ENABLED' : 'DISABLED';
    realSendAuthorization = config.allowRealSend ? 'ENABLED' : 'DISABLED';
    accountId = config.accountId;
    templateId = config.messageTemplateId;
    if (config.enabled) blockers.push('Scheduler must remain disabled during Phase A preflight.');
    if (config.allowRealSend)
      blockers.push('Real send authorization must remain disabled during Phase A preflight.');
  } catch {
    blockers.push('Scheduler configuration is invalid.');
  }

  const profilePath = path.resolve(
    workingDirectory,
    environment.BROWSER_PROFILE_DIR ??
      path.join(
        dataDirectory ?? path.resolve(workingDirectory, environment.DATA_DIR ?? 'data'),
        'browser-profile',
      ),
  );
  const browserProfile =
    existsSync(profilePath) && statSync(profilePath).isDirectory() ? 'CONFIGURED' : 'MISSING';
  if (browserProfile === 'MISSING') blockers.push('Browser Profile directory is missing.');

  let database: ReadyState = 'MISSING';
  let migration: ReadyState = 'MISSING';
  let account: ReadyState = 'MISSING';
  let schedule: ReadyState = 'MISSING';
  let template: ReadyState = 'MISSING';
  let enabledFriendCount = 0;
  let client: ReturnType<typeof openDatabaseReadOnly> | undefined;
  try {
    const databasePath = resolveDatabasePath({ environment, cwd: workingDirectory });
    client = openDatabaseReadOnly({ databasePath });
    const inspection = client.inspect();
    const schemasReady =
      inspection.accountsSchemaCompatible &&
      inspection.friendsSchemaCompatible &&
      inspection.messageTemplatesSchemaCompatible &&
      inspection.dailyRunsSchemaCompatible &&
      inspection.sendRecordsSchemaCompatible &&
      inspection.schedulesSchemaCompatible &&
      inspection.systemEventsSchemaCompatible &&
      inspection.pragmas.journalMode === 'wal' &&
      inspection.pragmas.foreignKeys === 1 &&
      inspection.pragmas.busyTimeoutMs === 5_000 &&
      inspection.pragmas.synchronous === 2;
    database = schemasReady ? 'READY' : 'INVALID';
    migration =
      inspection.appliedMigrationCount === EXPECTED_V1_MIGRATION_COUNT ? 'READY' : 'INVALID';
    if (database !== 'READY') blockers.push('Database schema or PRAGMA state is not ready.');
    if (migration !== 'READY')
      blockers.push('Database migration journal does not contain 7 entries.');

    const readModel = new V1ReleaseReadModel(client);
    if (accountId === undefined) {
      blockers.push('SCHEDULER_ACCOUNT_ID is missing.');
    } else {
      const value = readModel.findAccount(accountId);
      account = value === undefined ? 'MISSING' : value.enabled ? 'READY' : 'DISABLED';
      if (account !== 'READY') blockers.push('Configured Account is missing or disabled.');
      const scheduleValue = readModel.findScheduleByAccountId(accountId);
      if (scheduleValue !== undefined) {
        try {
          resolveBusinessTimeZone(scheduleValue.timezone);
          schedule = scheduleValue.enabled ? 'READY' : 'DISABLED';
        } catch {
          schedule = 'INVALID';
        }
      }
      if (schedule !== 'READY')
        blockers.push('Configured Schedule is missing, disabled, or invalid.');
      enabledFriendCount = readModel.countEnabledFriends(accountId);
      if (enabledFriendCount < 2)
        blockers.push('At least 2 enabled Friends are required for controlled validation.');
    }
    if (templateId === undefined) {
      blockers.push('SCHEDULER_MESSAGE_TEMPLATE_ID is missing.');
    } else {
      const value = readModel.findTemplate(templateId);
      template = value === undefined ? 'MISSING' : value.enabled ? 'READY' : 'DISABLED';
      if (template !== 'READY') blockers.push('Configured MessageTemplate is missing or disabled.');
    }
  } catch {
    blockers.push('Database is missing, unreadable, or incompatible.');
  } finally {
    client?.close();
  }

  return {
    database,
    migration,
    account,
    schedule,
    template,
    enabledFriendCount,
    browserProfile,
    scheduler,
    realSendAuthorization,
    observability,
    ready: blockers.length === 0,
    blockers,
  };
}

export function renderV1Preflight(result: V1PreflightResult): string {
  return [
    `Database: ${result.database}`,
    `Migration: ${result.migration}`,
    `Account: ${result.account}`,
    `Schedule: ${result.schedule}`,
    `Template: ${result.template}`,
    `Enabled friends: ${result.enabledFriendCount}`,
    `Browser profile path: ${result.browserProfile}`,
    `Scheduler: ${result.scheduler}`,
    `Real send authorization: ${result.realSendAuthorization}`,
    `Observability: ${result.observability}`,
    `Controlled validation: ${result.ready ? 'READY' : 'BLOCKED'}`,
  ].join('\n');
}
