import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountRepository,
  DailyRunRepository,
  FriendRepository,
  ScheduleRepository,
  SendRecordRepository,
  SystemEventRepository,
  type Account,
  type DailyRun,
  type Friend,
  type Schedule,
  type SendRecord,
} from '@sparkkeeper/database';
import { parseBusinessDate } from '@sparkkeeper/shared';

import {
  createApiApplication,
  type ApiApplication,
  type ServerEnvironment,
} from '../src/http/ApiApplication.js';
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  resolveHttpConfig,
} from '../src/http/config/HttpConfig.js';
import { createServer } from '../src/http/createServer.js';
import type { ApiServices } from '../src/http/services/ApiServices.js';
import { StatusService } from '../src/http/services/StatusService.js';

const FIXED_NOW = new Date('2026-01-04T03:04:05.000Z');
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

interface ApiFixture {
  readonly application: ApiApplication;
  readonly directory: string;
  readonly databasePath: string;
  readonly profilePath: string;
  readonly account: Account;
  readonly secondAccount: Account;
  readonly enabledFriend: Friend;
  readonly disabledFriend: Friend;
  readonly schedule: Schedule;
  readonly readyRun: DailyRun;
  readonly successRun: DailyRun;
  readonly failedRun: DailyRun;
  readonly failedRecord: SendRecord;
  readonly privateMessage: string;
  readonly privateEventMessage: string;
  readonly privateEvidencePath: string;
}

test('HTTP config defaults to loopback and the existing port convention', () => {
  const config = resolveHttpConfig({});
  assert.equal(config.host, DEFAULT_HTTP_HOST);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, DEFAULT_HTTP_PORT);
  assert.equal(config.port, 8080);
  assert.equal(config.browserProfileConfigured, false);
});

test('HTTP config permits only explicit bind changes and validates PORT', () => {
  assert.equal(resolveHttpConfig({ HOST: '192.0.2.10' }).host, '192.0.2.10');
  assert.throws(() => resolveHttpConfig({ PORT: '0' }), /PORT/);
  assert.throws(() => resolveHttpConfig({ PORT: 'not-a-port' }), /PORT/);
});

test('V2 read-only API foundation', async (context) => {
  const fixture = createFixture(context);
  const { server } = fixture.application;

  await context.test('health reports ready without sensitive metadata', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      success: true,
      data: {
        serviceName: 'SparkKeeper',
        version: 'test-release',
        status: 'READY',
        database: { status: 'READY' },
        migration: { status: 'READY' },
        timestamp: FIXED_NOW.toISOString(),
      },
    });
    assertSensitiveValuesAbsent(response.body, fixture);
  });

  await context.test('runtime status preserves disabled scheduler and send defaults', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/runtime/status' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      success: true,
      data: {
        serverStatus: 'READY',
        schedulerEnabled: false,
        realSendAuthorizationEnabled: false,
        manualRunEnabled: false,
        timezone: 'UTC',
        databaseReady: true,
        migrationReady: true,
        observabilityReady: true,
        browserProfileConfigured: true,
        version: 'test-release',
        timestamp: FIXED_NOW.toISOString(),
      },
    });
    assertSensitiveValuesAbsent(response.body, fixture);
  });

  await context.test('accounts list and detail expose only the read contract', async () => {
    const list = await server.inject({ method: 'GET', url: '/api/accounts' });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().data.length, 2);
    assert.deepEqual(Object.keys(list.json().data[0]).sort(), [
      'createdAt',
      'enabled',
      'id',
      'loginStatus',
      'name',
      'updatedAt',
    ]);

    const detail = await server.inject({
      method: 'GET',
      url: `/api/accounts/${fixture.account.id}`,
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().data.id, fixture.account.id);
    assert.equal(detail.json().data.loginStatus, 'READY');
  });

  await context.test('accounts distinguish invalid ids and missing entities', async () => {
    await assertValidationError(server, '/api/accounts/not-an-id');
    await assertNotFound(server, `/api/accounts/${UNKNOWN_UUID}`, 'ACCOUNT_NOT_FOUND');
  });

  await context.test('friends list, detail, and disabled state are readable', async () => {
    const list = await server.inject({
      method: 'GET',
      url: `/api/accounts/${fixture.account.id}/friends`,
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().data.length, 2);
    const disabled = list
      .json()
      .data.find((friend: { readonly id: string }) => friend.id === fixture.disabledFriend.id);
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.remarkName, null);
    assert.equal('matchKey' in disabled, false);
    assert.equal(disabled.secUid, null);

    const detail = await server.inject({
      method: 'GET',
      url: `/api/friends/${fixture.enabledFriend.id}`,
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().data.displayName, 'Fixture Friend A');
  });

  await context.test('friends validate ids and report missing entities', async () => {
    await assertValidationError(server, '/api/friends/not-an-id');
    await assertNotFound(server, `/api/friends/${UNKNOWN_UUID}`, 'FRIEND_NOT_FOUND');
  });

  await context.test(
    'schedule list respects the single-schedule schema and detail works',
    async () => {
      const list = await server.inject({
        method: 'GET',
        url: `/api/accounts/${fixture.account.id}/schedules`,
      });
      assert.equal(list.statusCode, 200);
      assert.equal(list.json().data.length, 1);
      assert.equal(list.json().data[0].maxAttempts, 3);

      const empty = await server.inject({
        method: 'GET',
        url: `/api/accounts/${fixture.secondAccount.id}/schedules`,
      });
      assert.equal(empty.statusCode, 200);
      assert.deepEqual(empty.json().data, []);

      const detail = await server.inject({
        method: 'GET',
        url: `/api/schedules/${fixture.schedule.id}`,
      });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().data.timezone, 'UTC');
      await assertNotFound(server, `/api/schedules/${UNKNOWN_UUID}`, 'SCHEDULE_NOT_FOUND');
    },
  );

  await context.test('run history supports bounded filters and limit', async () => {
    const all = await server.inject({ method: 'GET', url: '/api/runs' });
    assert.equal(all.statusCode, 200);
    assert.equal(all.json().data.length, 3);

    const accountFiltered = await server.inject({
      method: 'GET',
      url: `/api/runs?accountId=${fixture.account.id}`,
    });
    assert.equal(accountFiltered.json().data.length, 3);

    const dateFiltered = await server.inject({
      method: 'GET',
      url: '/api/runs?businessDate=2026-01-02',
    });
    assert.deepEqual(
      dateFiltered.json().data.map((run: { readonly id: string }) => run.id),
      [fixture.successRun.id],
    );

    const statusFiltered = await server.inject({
      method: 'GET',
      url: '/api/runs?status=FAILED',
    });
    assert.deepEqual(
      statusFiltered.json().data.map((run: { readonly id: string }) => run.id),
      [fixture.failedRun.id],
    );

    const limited = await server.inject({ method: 'GET', url: '/api/runs?limit=1' });
    assert.equal(limited.statusCode, 200);
    assert.equal(limited.json().data.length, 1);
    assert.equal(limited.json().data[0].id, fixture.failedRun.id);
  });

  await context.test(
    'run query validation rejects dates, statuses, limits, and extras',
    async () => {
      await assertValidationError(server, '/api/runs?businessDate=2026-02-30');
      await assertValidationError(server, '/api/runs?status=UNSUPPORTED');
      await assertValidationError(server, '/api/runs?limit=0');
      await assertValidationError(server, '/api/runs?limit=101');
      await assertValidationError(server, '/api/runs?unexpected=true');
    },
  );

  await context.test('run detail reports state and missing runs', async () => {
    const detail = await server.inject({
      method: 'GET',
      url: `/api/runs/${fixture.readyRun.id}`,
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().data.status, 'READY');
    await assertNotFound(server, `/api/runs/${UNKNOWN_UUID}`, 'RUN_NOT_FOUND');
  });

  await context.test('send records expose failure state but never message content', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/runs/${fixture.failedRun.id}/send-records`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.length, 1);
    assert.equal(response.json().data[0].id, fixture.failedRecord.id);
    assert.equal(response.json().data[0].status, 'FAILED');
    assert.equal(response.json().data[0].attempts, 1);
    assert.equal(response.json().data[0].failureCode, 'VERIFY_FAILED');
    assert.equal('messageText' in response.json().data[0], false);
    assert.equal('messageTemplateId' in response.json().data[0], false);
    assertSensitiveValuesAbsent(response.body, fixture);
  });

  await context.test('system events return safe messages and evidence booleans only', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/runs/${fixture.failedRun.id}/events`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.length, 1);
    assert.equal(response.json().data[0].message, 'Task finished with failure');
    assert.equal(response.json().data[0].screenshotEvidenceAvailable, true);
    assert.equal(response.json().data[0].traceEvidenceAvailable, true);
    assert.equal('screenshotPath' in response.json().data[0], false);
    assert.equal('tracePath' in response.json().data[0], false);
    assertSensitiveValuesAbsent(response.body, fixture);
  });

  await context.test('unknown routes use the stable error envelope', async () => {
    const response = await server.inject({ method: 'GET', url: '/files/private-artifact' });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      success: false,
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route was not found.' },
    });
  });

  await context.test('all representative responses exclude secrets and private paths', async () => {
    const urls = [
      '/api/health',
      '/api/runtime/status',
      '/api/accounts',
      `/api/accounts/${fixture.account.id}/friends`,
      `/api/runs/${fixture.failedRun.id}/send-records`,
      `/api/runs/${fixture.failedRun.id}/events`,
    ];
    for (const url of urls) {
      const response = await server.inject({
        method: 'GET',
        url,
        headers: { authorization: 'Bearer fixture-only-token', cookie: 'fixture-only-cookie' },
      });
      assert.equal(response.statusCode, 200);
      assertSensitiveValuesAbsent(response.body, fixture);
      assert.doesNotMatch(
        response.body,
        /fixture-only-token|fixture-only-cookie|"Authorization"\s*:/iu,
      );
      assert.doesNotMatch(response.body, /stack|messageText|chatText|databasePath/iu);
    }
  });
});

test('health explicitly reports database and migration degradation', async (context) => {
  const server = createServer({
    logger: false,
    services: {
      status: new StatusService({
        database: { ping: () => failProbe() },
        migrationReady: false,
        schedulerEnabled: false,
        realSendAuthorizationEnabled: false,
        timezone: 'UTC',
        observabilityReady: true,
        browserProfileConfigured: false,
        version: 'test-release',
        clock: () => FIXED_NOW,
      }),
      read: emptyReadService(),
      configuration: unavailableConfigurationService(),
    },
  });
  context.after(() => server.close());

  const response = await server.inject({ method: 'GET', url: '/api/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, 'DEGRADED');
  assert.equal(response.json().data.database.status, 'UNAVAILABLE');
  assert.equal(response.json().data.migration.status, 'NOT_READY');
});

test('unexpected exceptions return a safe 500 without raw diagnostics', async (context) => {
  const privateDiagnostic = 'SQL fixture failure at /private/runtime/location with token';
  const read = emptyReadService({
    listAccounts: () => {
      throw new Error(privateDiagnostic);
    },
  });
  const server = createServer({
    logger: false,
    services: {
      status: readyStatusService(),
      read,
      configuration: unavailableConfigurationService(),
    },
  });
  context.after(() => server.close());

  const response = await server.inject({ method: 'GET', url: '/api/accounts' });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred.',
    },
  });
  assert.doesNotMatch(response.body, /SQL fixture|private\/runtime|token|stack/iu);
});

test('API application closes Fastify and its owned database without a TCP listener', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-api-lifecycle-test-'));
  const databasePath = path.join(directory, 'fixture.db');
  const application = createApiApplication({
    databasePath,
    environment: disabledEnvironment(),
    logger: false,
  });
  try {
    const response = await application.server.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.equal(application.database.isOpen(), true);
    await application.close();
    assert.equal(application.database.isOpen(), false);
    await application.close();
  } finally {
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(context: TestContext): ApiFixture {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-api-test-'));
  const databasePath = path.join(directory, 'fixture.db');
  const profilePath = path.join(directory, 'profile-fixture-private');
  const application = createApiApplication({
    databasePath,
    environment: {
      ...disabledEnvironment(),
      APP_VERSION: 'test-release',
      APP_TIMEZONE: 'UTC',
      BROWSER_PROFILE_DIR: profilePath,
    },
    logger: false,
    clock: () => FIXED_NOW,
  });
  context.after(async () => {
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const accounts = new AccountRepository(application.database);
  const friends = new FriendRepository(application.database);
  const schedules = new ScheduleRepository(application.database);
  const runs = new DailyRunRepository(application.database);
  const records = new SendRecordRepository(application.database);
  const events = new SystemEventRepository(application.database);

  const account = accounts.create({ name: 'Fixture Account A', loginStatus: 'READY' });
  const secondAccount = accounts.create({ name: 'Fixture Account B', enabled: false });
  const enabledFriend = friends.create({
    accountId: account.id,
    displayName: 'Fixture Friend A',
    remarkName: 'Fixture Remark',
    shortId: 'fixture-short-a',
    uniqueId: 'fixture-unique-a',
  });
  const disabledFriend = friends.create({
    accountId: account.id,
    displayName: 'Fixture Friend B',
    enabled: false,
  });
  const schedule = schedules.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'UTC',
    now: FIXED_NOW,
  });
  const readyRun = runs.createOrGet({
    accountId: account.id,
    businessDate: parseBusinessDate('2026-01-01'),
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
  const successRun = runs.createOrGet({
    accountId: account.id,
    businessDate: parseBusinessDate('2026-01-02'),
    now: new Date('2026-01-02T00:00:00.000Z'),
  });
  runs.markRunning(successRun.id, new Date('2026-01-02T00:01:00.000Z'));
  const completedSuccessRun = runs.markSuccess(successRun.id, new Date('2026-01-02T00:02:00.000Z'));
  const failedRun = runs.createOrGet({
    accountId: account.id,
    businessDate: parseBusinessDate('2026-01-03'),
    now: new Date('2026-01-03T00:00:00.000Z'),
  });
  runs.markRunning(failedRun.id, new Date('2026-01-03T00:01:00.000Z'));
  const completedFailedRun = runs.markFailed(failedRun.id, new Date('2026-01-03T00:03:00.000Z'));

  const privateMessage = 'fixture-only-message-payload';
  const prepared = records.prepare({
    dailyRunId: failedRun.id,
    friendId: disabledFriend.id,
    businessDate: failedRun.businessDate,
    messageText: privateMessage,
    now: new Date('2026-01-03T00:00:30.000Z'),
  }).record;
  records.claimInitialAttempt(prepared.id, new Date('2026-01-03T00:01:30.000Z'), 3);
  const failedRecord = records.markFinalFailed(
    prepared.id,
    new Date('2026-01-03T00:02:30.000Z'),
    'VERIFY_FAILED',
  );

  const privateEventMessage = 'fixture-only-private-event-detail';
  const privateEvidencePath = 'fixture-evidence/private-artifact.bin';
  events.create({
    eventType: 'TASK_FAILED',
    level: 'ERROR',
    runId: failedRun.id,
    accountId: account.id,
    friendId: disabledFriend.id,
    attempt: 1,
    errorCode: 'VERIFY_FAILED',
    message: privateEventMessage,
    screenshotPath: privateEvidencePath,
    tracePath: privateEvidencePath,
    now: new Date('2026-01-03T00:02:45.000Z'),
  });

  return {
    application,
    directory,
    databasePath,
    profilePath,
    account,
    secondAccount,
    enabledFriend,
    disabledFriend,
    schedule,
    readyRun,
    successRun: completedSuccessRun,
    failedRun: completedFailedRun,
    failedRecord,
    privateMessage,
    privateEventMessage,
    privateEvidencePath,
  };
}

function disabledEnvironment(): ServerEnvironment {
  return {
    SCHEDULER_ENABLED: 'false',
    SCHEDULER_ALLOW_REAL_SEND: 'false',
    APP_TIMEZONE: 'UTC',
  };
}

function readyStatusService(): StatusService {
  return new StatusService({
    database: { ping: () => true },
    migrationReady: true,
    schedulerEnabled: false,
    realSendAuthorizationEnabled: false,
    timezone: 'UTC',
    observabilityReady: true,
    browserProfileConfigured: false,
    version: 'test-release',
    clock: () => FIXED_NOW,
  });
}

function emptyReadService(overrides: Partial<ApiServices['read']> = {}): ApiServices['read'] {
  const missing = (): never => {
    throw new Error('Fixture entity is unavailable.');
  };
  return {
    listAccounts: () => [],
    getAccount: missing,
    listFriends: () => [],
    getFriend: missing,
    listSchedules: () => [],
    getSchedule: missing,
    listRuns: () => [],
    getRun: missing,
    listSendRecords: () => [],
    listSystemEvents: () => [],
    ...overrides,
  };
}

function unavailableConfigurationService(): ApiServices['configuration'] {
  const unavailable = (): never => {
    throw new Error('Fixture configuration service is unavailable.');
  };
  return {
    createAccount: unavailable,
    updateAccount: unavailable,
    createFriend: unavailable,
    updateFriend: unavailable,
    listTemplates: () => [],
    getTemplate: unavailable,
    createTemplate: unavailable,
    updateTemplate: unavailable,
    configureSchedule: unavailable,
  };
}

function failProbe(): never {
  throw new Error('Fixture database is unavailable.');
}

async function assertValidationError(server: ApiApplication['server'], url: string): Promise<void> {
  const response = await server.inject({ method: 'GET', url });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), {
    success: false,
    error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.' },
  });
}

async function assertNotFound(
  server: ApiApplication['server'],
  url: string,
  code: string,
): Promise<void> {
  const response = await server.inject({ method: 'GET', url });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().success, false);
  assert.equal(response.json().error.code, code);
}

function assertSensitiveValuesAbsent(responseBody: string, fixture: ApiFixture): void {
  assert.equal(responseBody.includes(fixture.databasePath), false);
  assert.equal(responseBody.includes(fixture.profilePath), false);
  assert.equal(responseBody.includes(fixture.privateMessage), false);
  assert.equal(responseBody.includes(fixture.privateEventMessage), false);
  assert.equal(responseBody.includes(fixture.privateEvidencePath), false);
}
