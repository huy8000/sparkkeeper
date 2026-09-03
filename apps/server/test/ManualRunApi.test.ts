import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountRepository,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
  SystemEventRepository,
} from '@sparkkeeper/database';
import {
  parseBusinessDate,
  type DailyTaskRunResult,
  type DailyTaskExecutionMode,
  type BusinessDate,
  type SendTaskFailureCode,
} from '@sparkkeeper/shared';
import { RunExecutionCoordinator } from '../src/application/RunExecutionCoordinator.js';
import { resolveManualRunConfig } from '../src/config/ManualRunConfig.js';
import {
  createApiApplication,
  type ApiApplication,
  type ServerEnvironment,
} from '../src/http/ApiApplication.js';
import {
  ManualRunService,
  type ManualRunRunner,
  type ManualRunRunnerFactory,
} from '../src/http/services/ManualRunService.js';
import { TaskScheduler } from '../src/scheduler/TaskScheduler.js';
import { createAuthenticatedTestSession, type TestAuthSession } from './authFixture.js';

const FIXED_NOW = new Date('2026-02-03T04:05:06.000Z');
const BUSINESS_DATE = parseBusinessDate('2026-02-03');
const API_HOST = '127.0.0.1:8080';
const ADMIN_ORIGIN = 'http://127.0.0.1:8080';
const FIXTURE_MESSAGE = 'Fictional Manual Run template content.';

test('Manual Run server gate is strictly parsed and defaults false', () => {
  assert.equal(resolveManualRunConfig({}).enabled, false);
  assert.equal(resolveManualRunConfig({ MANUAL_RUN_ENABLED: 'false' }).enabled, false);
  assert.equal(resolveManualRunConfig({ MANUAL_RUN_ENABLED: 'true' }).enabled, true);
  assert.throws(() => resolveManualRunConfig({ MANUAL_RUN_ENABLED: 'enabled' }), /true or false/);
});

test('Manual Run config defaults false and runtime status exposes only a boolean gate', async (context) => {
  const fixture = await createFixture(context, disabledEnvironment());
  const status = await fixture.application.server.inject({
    method: 'GET',
    url: '/api/runtime/status',
    headers: { cookie: fixture.session.cookieHeader },
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().data.manualRunEnabled, false);
  assert.equal(status.json().data.realSendAuthorizationEnabled, false);

  const before = new DailyRunRepository(fixture.application.database).list().length;
  const preflight = await fixture.application.server.inject({
    method: 'GET',
    url: preflightUrl(fixture),
    headers: { cookie: fixture.session.cookieHeader },
  });
  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.json().data.canRun, false);
  assert.deepEqual(preflight.json().data.blockedReasons, [
    'MANUAL_RUN_DISABLED',
    'REAL_SEND_NOT_AUTHORIZED',
  ]);
  assert.equal(new DailyRunRepository(fixture.application.database).list().length, before);
  assert.equal(fixture.runnerFactory.createCount, 0);
});

test('Manual Run preflight is server-calculated, safe, and permits a disabled Schedule', async (context) => {
  const fixture = await createFixture(context, enabledEnvironment(), { scheduleEnabled: false });
  const response = await fixture.application.server.inject({
    method: 'GET',
    url: preflightUrl(fixture),
    headers: { cookie: fixture.session.cookieHeader },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, {
    accountId: fixture.accountId,
    templateId: fixture.templateId,
    businessDate: BUSINESS_DATE,
    manualRunEnabled: true,
    realSendAuthorizationEnabled: true,
    accountEnabled: true,
    templateEnabled: true,
    enabledFriendCount: 1,
    scheduleConfigured: true,
    currentDailyRunStatus: null,
    successfulFriendCount: 0,
    pendingFriendCount: 1,
    canRun: true,
    blockedReasons: [],
  });
  assert.doesNotMatch(
    response.body,
    /Fictional Manual Run template content|Demo Contact Manual|cookie|token|browser|database|messageText/iu,
  );
  assert.equal(fixture.runnerFactory.createCount, 0);
  assert.equal(new DailyRunRepository(fixture.application.database).list().length, 0);
});

test('Manual Run preflight reports every safe configuration and lifecycle blocker', async (context) => {
  const cases = [
    { name: 'disabled account', options: { accountEnabled: false }, reason: 'ACCOUNT_DISABLED' },
    { name: 'disabled template', options: { templateEnabled: false }, reason: 'TEMPLATE_DISABLED' },
    { name: 'no enabled friends', options: { friendEnabled: false }, reason: 'NO_ENABLED_FRIENDS' },
    {
      name: 'missing schedule',
      options: { createSchedule: false },
      reason: 'SCHEDULE_NOT_CONFIGURED',
    },
  ] as const;
  for (const item of cases) {
    await context.test(item.name, async (child) => {
      const fixture = await createFixture(child, enabledEnvironment(), item.options);
      const response = await fixture.application.server.inject({
        method: 'GET',
        url: preflightUrl(fixture),
        headers: { cookie: fixture.session.cookieHeader },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().data.canRun, false);
      assert.ok(response.json().data.blockedReasons.includes(item.reason));
      assert.equal(fixture.runnerFactory.createCount, 0);
    });
  }

  await context.test('active execution', async (child) => {
    const fixture = await createFixture(child, enabledEnvironment());
    const lease = fixture.coordinator.tryAcquire(fixture.accountId, BUSINESS_DATE)!;
    const response = await fixture.application.server.inject({
      method: 'GET',
      url: preflightUrl(fixture),
      headers: { cookie: fixture.session.cookieHeader },
    });
    assert.ok(response.json().data.blockedReasons.includes('RUN_IN_PROGRESS'));
    lease.release();
  });
});

test('Manual Run POST revalidates state after a successful preflight', async (context) => {
  const fixture = await createFixture(context, enabledEnvironment());
  const ready = await fixture.application.server.inject({
    method: 'GET',
    url: preflightUrl(fixture),
    headers: { cookie: fixture.session.cookieHeader },
  });
  assert.equal(ready.json().data.canRun, true);
  new AccountRepository(fixture.application.database).update(fixture.accountId, { enabled: false });
  const response = await post(fixture, {
    templateId: fixture.templateId,
    acknowledgeRealSend: true,
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, 'MANUAL_RUN_BLOCKED');
  assert.equal(fixture.runnerFactory.createCount, 0);
});

test('Manual Run refuses an original BusinessDate when the revalidation date changes', async (context) => {
  const fixture = await createFixture(context, enabledEnvironment());
  let step = 0;
  fixture.application.manualRun['clock'] = () => {
    if (step++ === 0) return new Date('2026-02-03T23:59:59.999Z');
    return new Date('2026-02-04T00:00:00.000Z');
  };
  const response = await post(fixture, {
    templateId: fixture.templateId,
    acknowledgeRealSend: true,
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, 'MANUAL_RUN_BLOCKED');
  assert.equal(new DailyRunRepository(fixture.application.database).list().length, 0);
  assert.equal(fixture.runnerFactory.createCount, 0);
});

test('Manual Run POST retains centralized mutation security', async (context) => {
  const fixture = await createFixture(context, enabledEnvironment());
  const payload = { templateId: fixture.templateId, acknowledgeRealSend: true };

  for (const headers of [
    mutationHeaders(fixture.session, { 'x-sparkkeeper-csrf': '' }),
    mutationHeaders(fixture.session, { 'x-sparkkeeper-csrf': 'wrong' }),
    mutationHeaders(fixture.session, { origin: 'http://127.0.0.1.evil.test:8080' }),
    mutationHeaders(fixture.session, { host: '127.0.0.1.evil.test:8080' }),
  ]) {
    const response = await fixture.application.server.inject({
      method: 'POST',
      url: postUrl(fixture),
      headers,
      payload,
    });
    assert.equal(response.statusCode, 403, response.body);
  }

  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
    const response = await fixture.application.server.inject({
      method: 'POST',
      url: postUrl(fixture),
      headers: mutationHeaders(fixture.session, { 'content-type': contentType }),
      payload: JSON.stringify(payload),
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  const read = await fixture.application.server.inject({
    method: 'GET',
    url: preflightUrl(fixture),
    headers: { cookie: fixture.session.cookieHeader },
  });
  assert.equal(read.statusCode, 200);
  assert.equal(read.headers['access-control-allow-origin'], undefined);
});

test('both server-side gates are independently mandatory for POST', async (context) => {
  for (const environment of [
    { ...enabledEnvironment(), MANUAL_RUN_ENABLED: 'false' },
    { ...enabledEnvironment(), SCHEDULER_ALLOW_REAL_SEND: 'false' },
  ]) {
    const fixture = await createFixture(context, environment);
    const response = await post(fixture, {
      templateId: fixture.templateId,
      acknowledgeRealSend: true,
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(response.json().error.code, 'MANUAL_RUN_FORBIDDEN');
    assert.equal(fixture.runnerFactory.createCount, 0);
  }
});

test('Manual Run POST requires acknowledgement and rejects arbitrary execution inputs', async (context) => {
  const fixture = await createFixture(context, enabledEnvironment());
  for (const acknowledgeRealSend of [undefined, false]) {
    const payload =
      acknowledgeRealSend === undefined
        ? { templateId: fixture.templateId }
        : { templateId: fixture.templateId, acknowledgeRealSend };
    const response = await post(fixture, payload);
    assert.equal(response.statusCode, 400, response.body);
  }
  for (const extra of [
    { businessDate: '2026-02-02' },
    { recipients: ['00000000-0000-4000-8000-000000000099'] },
    { message: 'Arbitrary content' },
  ]) {
    const response = await post(fixture, {
      templateId: fixture.templateId,
      acknowledgeRealSend: true,
      ...extra,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(fixture.runnerFactory.createCount, 0);
});

test('Manual Run routes distinguish malformed and missing entities safely', async (context) => {
  const fixture = await createFixture(context, enabledEnvironment());
  const malformed = await fixture.application.server.inject({
    method: 'GET',
    url: `/api/accounts/not-an-id/manual-run/preflight?templateId=${fixture.templateId}`,
    headers: { cookie: fixture.session.cookieHeader },
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.code, 'VALIDATION_ERROR');

  const unknownId = '00000000-0000-4000-8000-000000000000';
  const missingAccount = await fixture.application.server.inject({
    method: 'GET',
    url: `/api/accounts/${unknownId}/manual-run/preflight?templateId=${fixture.templateId}`,
    headers: { cookie: fixture.session.cookieHeader },
  });
  assert.equal(missingAccount.statusCode, 404);
  assert.equal(missingAccount.json().error.code, 'ACCOUNT_NOT_FOUND');
  const missingTemplate = await fixture.application.server.inject({
    method: 'GET',
    url: `/api/accounts/${fixture.accountId}/manual-run/preflight?templateId=${unknownId}`,
    headers: { cookie: fixture.session.cookieHeader },
  });
  assert.equal(missingTemplate.statusCode, 404);
  assert.equal(missingTemplate.json().error.code, 'TEMPLATE_NOT_FOUND');
  assert.doesNotMatch(
    `${malformed.body}${missingAccount.body}${missingTemplate.body}`,
    /stack|SQL|filesystem|cookie|token|browser profile/iu,
  );
});

test('Manual Run returns 202 before completion and blocks a concurrent duplicate', async (context) => {
  const deferred = createDeferred<DailyTaskRunResult>();
  const fixture = await createFixture(context, enabledEnvironment(), {
    run: async () => deferred.promise,
  });
  const first = await post(fixture, {
    templateId: fixture.templateId,
    acknowledgeRealSend: true,
  });
  assert.equal(first.statusCode, 202, first.body);
  assert.equal(first.json().data.status, 'ACCEPTED');
  assert.equal(first.json().data.businessDate, BUSINESS_DATE);
  assert.equal(typeof first.json().data.runId, 'string');

  const second = await post(fixture, {
    templateId: fixture.templateId,
    acknowledgeRealSend: true,
  });
  assert.equal(second.statusCode, 409, second.body);
  assert.equal(second.json().error.code, 'RUN_ALREADY_IN_PROGRESS');
  assert.equal(fixture.runnerFactory.createCount, 1);
  assert.deepEqual(fixture.runnerFactory.calls, [
    { accountId: fixture.accountId, businessDate: BUSINESS_DATE, mode: 'MANUAL' },
  ]);

  deferred.resolve('SUCCESS');
  await waitFor(() => fixture.application.manualRun.activeCount === 0);
  assert.equal(fixture.coordinator.activeCount, 0);
});

test('disconnecting the HTTP client after acceptance does not cancel the server-owned run', async (context) => {
  const deferred = createDeferred<DailyTaskRunResult>();
  const fixture = await createFixture(context, enabledEnvironment(), {
    run: async () => deferred.promise,
  });
  const controller = new AbortController();
  const response = await fixture.application.server.inject({
    method: 'POST',
    url: postUrl(fixture),
    headers: mutationHeaders(fixture.session),
    payload: {
      templateId: fixture.templateId,
      acknowledgeRealSend: true,
    },
    signal: controller.signal,
  });
  assert.equal(response.statusCode, 202);
  controller.abort();

  assert.equal(fixture.application.manualRun.activeCount, 1);
  assert.equal(fixture.runnerFactory.createCount, 1);
  deferred.resolve('SUCCESS');
  await waitFor(() => fixture.application.manualRun.activeCount === 0);
  assert.equal(fixture.coordinator.activeCount, 0);
  assert.equal(fixture.runnerFactory.calls.length, 1);
});

test('Manual Run releases coordination after background failure and shutdown awaits work', async (context) => {
  const deferred = createDeferred<DailyTaskRunResult>();
  let failures = 0;
  const fixture = await createFixture(context, enabledEnvironment(), {
    run: async () => deferred.promise,
    onBackgroundFailure: () => failures++,
  });
  const response = await post(fixture, {
    templateId: fixture.templateId,
    acknowledgeRealSend: true,
  });
  assert.equal(response.statusCode, 202);
  let stopped = false;
  const stopping = fixture.application.stopManualRuns().then(() => (stopped = true));
  await Promise.resolve();
  assert.equal(stopped, false);
  deferred.reject(new Error('Private background failure sentinel'));
  await stopping;
  assert.equal(failures, 1);
  assert.equal(fixture.coordinator.activeCount, 0);
  assert.equal(fixture.runnerFactory.closed, true);
  assert.equal(new DailyRunRepository(fixture.application.database).list()[0]?.status, 'FAILED');
  const rejected = await post(fixture, {
    templateId: fixture.templateId,
    acknowledgeRealSend: true,
  });
  assert.equal(rejected.statusCode, 503);
  assert.doesNotMatch(rejected.body, /Private background failure sentinel|stack/iu);
});

test('unexpected background failure persists a safe terminal event and emits SSE invalidation', async (context) => {
  const fixture = await createFixture(context, enabledEnvironment(), {
    run: async () => Promise.reject(new Error('Private unexpected diagnostic')),
  });
  const realtimeEvents: unknown[] = [];
  const unsubscribe = fixture.application.realtime.subscribe((event) => realtimeEvents.push(event));
  const response = await post(fixture, {
    templateId: fixture.templateId,
    acknowledgeRealSend: true,
  });
  assert.equal(response.statusCode, 202);
  await waitFor(() => fixture.application.manualRun.activeCount === 0);
  unsubscribe();
  const run = new DailyRunRepository(fixture.application.database).list()[0]!;
  assert.equal(run.status, 'FAILED');
  const events = new SystemEventRepository(fixture.application.database).listByRunId(run.id);
  assert.equal(events.at(-1)?.eventType, 'TASK_FAILED');
  assert.equal(events.at(-1)?.errorCode, 'MANUAL_RUN_BACKGROUND_FAILED');
  const serialized = JSON.stringify({ events, realtimeEvents });
  assert.match(serialized, /RUN_FINISHED/);
  assert.doesNotMatch(serialized, /Private unexpected diagnostic|messageText|cookie|token|stack/iu);
});

test('terminal SUCCESS is never executed or resent', async (context) => {
  const fixture = await createFixture(context, enabledEnvironment());
  const runs = new DailyRunRepository(fixture.application.database);
  const run = runs.createOrGet({
    accountId: fixture.accountId,
    businessDate: BUSINESS_DATE,
    now: FIXED_NOW,
  });
  const claim = runs.claimForExecution(run.id, FIXED_NOW);
  assert.equal(claim.type, 'CLAIMED');
  runs.markSuccess(run.id, FIXED_NOW);
  const response = await post(fixture, {
    templateId: fixture.templateId,
    acknowledgeRealSend: true,
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().error.code, 'RUN_ALREADY_COMPLETE');
  assert.equal(fixture.runnerFactory.createCount, 0);
});

test('shared coordinator serializes scheduler and manual entry points', async () => {
  const coordinator = new RunExecutionCoordinator();
  const schedule = {
    accountId: '00000000-0000-4000-8000-000000000011',
    timezone: 'UTC',
    startTime: '00:00',
    endTime: '23:59',
    enabled: true,
  };
  const manualLease = coordinator.tryAcquire(schedule.accountId, BUSINESS_DATE);
  assert.ok(manualLease);
  let schedulerExecutions = 0;
  const scheduler = new TaskScheduler(
    schedule.accountId,
    { findByAccountId: () => schedule as never },
    {
      run: async () => {
        schedulerExecutions++;
        return 'SUCCESS';
      },
    },
    { now: () => FIXED_NOW },
    { setInterval: () => 1, clearInterval: () => undefined },
    60_000,
    () => undefined,
    { cleanup: async () => undefined },
    coordinator,
  );
  assert.equal(await scheduler.tick(), 'SKIPPED');
  assert.equal(schedulerExecutions, 0);
  manualLease.release();
  assert.equal(await scheduler.tick(), 'TRIGGERED');
  assert.equal(schedulerExecutions, 1);
  assert.equal(coordinator.activeCount, 0);
});

test('shared coordinator serializes different Accounts that use one persistent Browser profile', () => {
  const coordinator = new RunExecutionCoordinator();
  const first = coordinator.tryAcquire('account-a', BUSINESS_DATE);
  assert.ok(first);
  assert.equal(coordinator.tryAcquire('account-b', BUSINESS_DATE), undefined);
  first.release();
  const second = coordinator.tryAcquire('account-b', BUSINESS_DATE);
  assert.ok(second);
  second.release();
  assert.equal(coordinator.activeCount, 0);
});

test('out-of-window Scheduler cleanup cannot mutate an active Manual Run', async () => {
  const coordinator = new RunExecutionCoordinator();
  const accountId = '00000000-0000-4000-8000-000000000011';
  const lease = coordinator.tryAcquire(accountId, BUSINESS_DATE)!;
  let cleanupCalls = 0;
  const scheduler = new TaskScheduler(
    accountId,
    {
      findByAccountId: () =>
        ({
          accountId,
          enabled: true,
          timezone: 'UTC',
          startTime: '09:00',
          endTime: '10:00',
        }) as never,
    },
    {
      run: async () => 'SUCCESS',
      finalizeExpired: async () => {
        cleanupCalls++;
      },
    },
    { now: () => FIXED_NOW },
    { setInterval: () => 1, clearInterval: () => undefined },
    60_000,
    () => undefined,
    { cleanup: async () => undefined },
    coordinator,
  );
  assert.equal(await scheduler.tick(), 'SKIPPED');
  assert.equal(cleanupCalls, 0);
  lease.release();
  assert.equal(await scheduler.tick(), 'SKIPPED');
  assert.equal(cleanupCalls, 1);
});

test('ManualRunService delegates existing auth, failure, retry, delivery, and idempotency semantics', async (context) => {
  await context.test('AUTH_EXPIRED safe stop', async (child) => {
    const fixture = integratedManualFixture(child);
    fixture.automation.auth = 'AUTH_EXPIRED';
    fixture.service.start(fixture.accountId, acknowledged(fixture.templateId));
    await waitFor(() => fixture.service.activeCount === 0);
    assert.equal(fixture.runs.list()[0]?.status, 'AUTH_EXPIRED');
    assert.equal(fixture.automation.sends, 0);
  });

  await context.test('ambiguous contact remains final without send', async (child) => {
    const fixture = integratedManualFixture(child);
    fixture.automation.open = { status: 'FAILED', failureCode: 'AMBIGUOUS_CONTACT' };
    fixture.service.start(fixture.accountId, acknowledged(fixture.templateId));
    await waitFor(() => fixture.service.activeCount === 0);
    assert.equal(fixture.runs.list()[0]?.status, 'FAILED');
    assert.equal(fixture.automation.sends, 0);
  });

  await context.test('delivery uncertainty remains terminal and conservative', async (child) => {
    const fixture = integratedManualFixture(child);
    fixture.automation.sendResults = [
      {
        status: 'DELIVERY_UNKNOWN',
        failureCode: 'DELIVERY_UNKNOWN',
        sendAction: 'TRIGGERED',
      },
    ];
    fixture.service.start(fixture.accountId, acknowledged(fixture.templateId));
    await waitFor(() => fixture.service.activeCount === 0);
    assert.equal(fixture.runs.list()[0]?.status, 'FAILED');
    assert.equal(
      fixture.records.listByDailyRunId(fixture.runs.list()[0]!.id)[0]?.status,
      'DELIVERY_UNKNOWN',
    );
  });

  await context.test(
    'bounded retry resumes through the same runner and snapshot',
    async (child) => {
      const fixture = integratedManualFixture(child);
      fixture.automation.sendResults = [
        { status: 'FAILED', failureCode: 'SEND_ACTION_FAILED', sendAction: 'NOT_TRIGGERED' },
        { status: 'SUCCESS', sendAction: 'TRIGGERED' },
      ];
      fixture.service.start(fixture.accountId, acknowledged(fixture.templateId));
      await waitFor(() => fixture.service.activeCount === 0);
      assert.equal(fixture.runs.list()[0]?.status, 'RUNNING');
      fixture.advanceClock(60_000);
      fixture.service.start(fixture.accountId, acknowledged(fixture.templateId));
      await waitFor(() => fixture.service.activeCount === 0);
      assert.equal(fixture.runs.list()[0]?.status, 'SUCCESS');
      assert.equal(fixture.automation.sends, 2);
    },
  );

  await context.test('SUCCESS cannot be requested or sent twice', async (child) => {
    const fixture = integratedManualFixture(child);
    fixture.service.start(fixture.accountId, acknowledged(fixture.templateId));
    await waitFor(() => fixture.service.activeCount === 0);
    assert.equal(fixture.automation.sends, 1);
    assert.throws(
      () => fixture.service.start(fixture.accountId, acknowledged(fixture.templateId)),
      /already complete|terminal run state/,
    );
    assert.equal(fixture.automation.sends, 1);
  });
});

interface FixtureOptions {
  readonly scheduleEnabled?: boolean;
  readonly accountEnabled?: boolean;
  readonly templateEnabled?: boolean;
  readonly friendEnabled?: boolean;
  readonly createSchedule?: boolean;
  readonly run?: (
    accountId: string,
    businessDate: BusinessDate,
    mode: DailyTaskExecutionMode,
  ) => Promise<DailyTaskRunResult>;
  readonly onBackgroundFailure?: () => void;
  readonly clock?: () => Date;
}

interface Fixture {
  readonly application: ApiApplication;
  readonly session: TestAuthSession;
  readonly accountId: string;
  readonly templateId: string;
  readonly coordinator: RunExecutionCoordinator;
  readonly runnerFactory: TestRunnerFactory;
}

class TestRunnerFactory implements ManualRunRunnerFactory {
  public createCount = 0;
  public closed = false;
  public readonly calls: Array<{
    readonly accountId: string;
    readonly businessDate: string;
    readonly mode: string;
  }> = [];

  constructor(
    private readonly runner: (
      accountId: string,
      businessDate: BusinessDate,
      mode: DailyTaskExecutionMode,
    ) => Promise<DailyTaskRunResult> = async () => 'SUCCESS',
    private readonly onBackgroundFailure?: () => void,
  ) {}

  public create(): ManualRunRunner {
    this.createCount++;
    return {
      run: async (accId, bDate, mode) => {
        this.calls.push({ accountId: accId, businessDate: bDate, mode });
        return this.runner(accId, bDate, mode);
      },
    };
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

async function createFixture(
  context: TestContext,
  environment: ServerEnvironment,
  options: Partial<FixtureOptions> = {},
): Promise<Fixture> {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-manual-run-api-test-'));
  const databasePath = path.join(directory, 'fixture.db');
  const coordinator = new RunExecutionCoordinator();
  const runnerFactory = new TestRunnerFactory(options.run, options.onBackgroundFailure);
  const application = createApiApplication({
    databasePath,
    environment,
    logger: false,
    clock: options.clock ?? (() => FIXED_NOW),
    coordinator,
    manualRunRunnerFactory: runnerFactory,
    onManualRunBackgroundFailure: options.onBackgroundFailure,
  });
  context.after(async () => {
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const session = await createAuthenticatedTestSession(application);

  const accounts = new AccountRepository(application.database);
  const friends = new FriendRepository(application.database);
  const schedules = new ScheduleRepository(application.database);
  const templates = new MessageTemplateRepository(application.database);
  const account = accounts.create({
    name: 'Demo Manual Account',
    loginStatus: 'READY',
    enabled: options.accountEnabled ?? true,
  });
  friends.create({
    accountId: account.id,
    displayName: 'Demo Contact Manual',
    shortId: 'demo-manual',
    matchField: 'shortId',
    enabled: options.friendEnabled ?? true,
  });
  if (options.createSchedule !== false) {
    schedules.create({
      accountId: account.id,
      startTime: '09:00',
      endTime: '10:00',
      timezone: 'UTC',
      enabled: options.scheduleEnabled ?? true,
      maxAttempts: 3,
      retryIntervalSeconds: 60,
      now: FIXED_NOW,
    });
  }
  const template = templates.create({
    name: 'Demo Manual Template',
    providerType: 'STATIC',
    messages: [FIXTURE_MESSAGE],
    enabled: options.templateEnabled ?? true,
  });
  return {
    application,
    session,
    accountId: account.id,
    templateId: template.id,
    coordinator,
    runnerFactory,
  };
}

function disabledEnvironment(): ServerEnvironment {
  return {
    APP_TIMEZONE: 'UTC',
    SCHEDULER_ENABLED: 'false',
    SCHEDULER_ALLOW_REAL_SEND: 'false',
    MANUAL_RUN_ENABLED: 'false',
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
  };
}

function enabledEnvironment(): ServerEnvironment {
  return {
    APP_TIMEZONE: 'UTC',
    SCHEDULER_ENABLED: 'false',
    SCHEDULER_ALLOW_REAL_SEND: 'true',
    MANUAL_RUN_ENABLED: 'true',
    SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
    SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
  };
}

function mutationHeaders(
  session: TestAuthSession,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    cookie: session.cookieHeader,
    host: API_HOST,
    origin: ADMIN_ORIGIN,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    'x-sparkkeeper-csrf': session.csrfToken,
    ...overrides,
  };
}

function preflightUrl(fixture: Fixture): string {
  return `/api/accounts/${fixture.accountId}/manual-run/preflight?templateId=${fixture.templateId}`;
}

function postUrl(fixture: Fixture): string {
  return `/api/accounts/${fixture.accountId}/manual-runs`;
}

async function post(fixture: Fixture, payload: unknown) {
  return fixture.application.server.inject({
    method: 'POST',
    url: postUrl(fixture),
    headers: mutationHeaders(fixture.session),
    payload,
  });
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for local test state.');
}

function acknowledged(templateId: string) {
  return { templateId, acknowledgeRealSend: true };
}

interface IntegratedFixture {
  readonly service: ManualRunService;
  readonly accountId: string;
  readonly templateId: string;
  readonly runs: DailyRunRepository;
  readonly records: SendRecordRepository;
  readonly automation: {
    auth: 'READY' | 'AUTH_EXPIRED';
    open: { status: 'SUCCESS' } | { status: 'FAILED'; failureCode: string };
    sendResults: Array<{
      status: 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN';
      failureCode?: string;
      sendAction: 'TRIGGERED' | 'NOT_TRIGGERED';
    }>;
    sends: number;
  };
  readonly advanceClock: (ms: number) => void;
}

function integratedManualFixture(context: TestContext): IntegratedFixture {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-manual-service-test-'));
  const databasePath = path.join(directory, 'fixture.db');
  let simulatedNow = new Date('2026-02-03T04:05:06.000Z');
  const clock = () => simulatedNow;

  const app = createApiApplication({
    databasePath,
    environment: enabledEnvironment(),
    logger: false,
    clock,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const accounts = new AccountRepository(app.database);
  const friends = new FriendRepository(app.database);
  const schedules = new ScheduleRepository(app.database);
  const templates = new MessageTemplateRepository(app.database);
  const runs = new DailyRunRepository(app.database);
  const records = new SendRecordRepository(app.database);

  const account = accounts.create({ name: 'Service Demo Account', loginStatus: 'READY' });
  const friend = friends.create({
    accountId: account.id,
    displayName: 'Contact Alpha',
    shortId: 'alpha',
    matchField: 'shortId',
  });
  schedules.create({
    accountId: account.id,
    startTime: '00:00',
    endTime: '23:59',
    timezone: 'UTC',
    now: simulatedNow,
  });
  const template = templates.create({
    name: 'Service Template',
    providerType: 'STATIC',
    messages: ['Static service message'],
  });

  const automation = {
    auth: 'READY' as const,
    open: { status: 'SUCCESS' as const },
    sendResults: [] as Array<{
      status: 'SUCCESS' | 'FAILED' | 'DELIVERY_UNKNOWN';
      failureCode?: string;
      sendAction: 'TRIGGERED' | 'NOT_TRIGGERED';
    }>,
    sends: 0,
  };

  const coordinator = new RunExecutionCoordinator();
  const runnerFactory: ManualRunRunnerFactory = {
    create: () => ({
      run: async (): Promise<DailyTaskRunResult> => {
        if (automation.auth === 'AUTH_EXPIRED') {
          const run = runs.createOrGet({
            accountId: account.id,
            businessDate: BUSINESS_DATE,
            now: simulatedNow,
          });
          runs.markAuthExpired(run.id, simulatedNow);
          return 'AUTH_EXPIRED';
        }
        const run = runs.createOrGet({
          accountId: account.id,
          businessDate: BUSINESS_DATE,
          now: simulatedNow,
        });
        runs.claimForExecution(run.id, simulatedNow);

        const prepared = records.prepare({
          dailyRunId: run.id,
          friendId: friend.id,
          businessDate: BUSINESS_DATE,
          messageText: 'Private message text sentinel',
          now: simulatedNow,
        });
        const recordId = prepared.record.id;

        if (automation.open.status === 'FAILED') {
          records.markFailedBeforeSend(recordId, simulatedNow);
          runs.markFailed(run.id, simulatedNow);
          return 'FAILED';
        }

        const nextResult = automation.sendResults.shift() ?? {
          status: 'SUCCESS',
          sendAction: 'TRIGGERED',
        };
        automation.sends++;

        const claimInitial = records.claimInitialAttempt(recordId, simulatedNow, 3);
        if (claimInitial.type !== 'CLAIMED') {
          records.claimRetryAttempt(recordId, simulatedNow, 3);
        }

        if (nextResult.status === 'SUCCESS') {
          records.markSendActionStarted(recordId, simulatedNow);
          records.markSuccess(recordId, simulatedNow);
          runs.markSuccess(run.id, simulatedNow);
          return 'SUCCESS';
        }

        if (nextResult.status === 'DELIVERY_UNKNOWN') {
          records.markSendActionStarted(recordId, simulatedNow);
          records.recoverInterruptedAfterSendBoundary(recordId, simulatedNow);
          runs.markFailed(run.id, simulatedNow);
          return 'FAILED';
        }

        records.scheduleRetry(recordId, {
          failureCode:
            (nextResult.failureCode as SendTaskFailureCode | undefined) ?? 'SEND_ACTION_FAILED',
          maxAttempts: 3,
          nextRetryAt: new Date(simulatedNow.getTime() + 60_000),
          now: simulatedNow,
          externalActionConfirmedAbsent: true,
        });
        return 'RUNNING';
      },
    }),
    close: async () => undefined,
  };

  const service = new ManualRunService({
    repositories: {
      accounts,
      friends,
      schedules,
      templates,
      dailyRuns: runs,
      sendRecords: records,
    },
    manualRunEnabled: true,
    realSendAuthorizationEnabled: true,
    coordinator,
    runnerFactory,
    clock,
  });

  return {
    service,
    accountId: account.id,
    templateId: template.id,
    runs,
    records,
    automation,
    advanceClock: (ms: number) => {
      simulatedNow = new Date(simulatedNow.getTime() + ms);
    },
  };
}
