import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountRepository,
  createDatabase,
  DailyRunRepository,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  SendRecordRepository,
} from '@sparkkeeper/database';
import { parseBusinessDate } from '@sparkkeeper/shared';

import {
  type AutomationSendResult,
  type ContactOpenResult,
  type DailyTaskAutomation,
} from '../src/application/DailyTaskAutomation.js';
import { DailyTaskRunner } from '../src/application/DailyTaskRunner.js';
import { ProductionRuntimeObserver } from '../src/observability/ProductionRuntimeObserver.js';
import {
  type RuntimeObservation,
  type RuntimeObserver,
  type RuntimeRunContext,
  type RuntimeRunResult,
} from '../src/observability/RuntimeObserver.js';
import { TaskScheduler } from '../src/scheduler/TaskScheduler.js';
import type { RealtimeEvent } from '../src/realtime/RealtimeEvent.js';
import { RuntimeEventHub } from '../src/realtime/RuntimeEventHub.js';

test('ProductionRuntimeObserver contains logger failure with a safe fallback', async () => {
  let fallbackCount = 0;
  const observer = observerFixture({
    logger: {
      emit: () => {
        throw new Error('fixture logger failed');
      },
    },
    fallback: () => {
      fallbackCount += 1;
    },
  });

  await observer.observe({ eventType: 'RUN_STARTED', level: 'info' });
  assert.equal(fallbackCount, 1);
});

test('ProductionRuntimeObserver contains SystemEvent persistence failure', async () => {
  const logged: string[] = [];
  const observer = observerFixture({
    logger: { emit: (_level, event) => logged.push(event.eventType) },
    systemEvents: {
      create: () => {
        throw new Error('fixture persistence failed');
      },
    },
  });

  await observer.observe({ eventType: 'AUTH_EXPIRED', level: 'error', persist: true });
  assert.deepEqual(logged, ['AUTH_EXPIRED', 'OBSERVABILITY_ERROR']);
});

test('ProductionRuntimeObserver contains screenshot failure and persists safe event', async () => {
  const persisted: Array<Record<string, unknown>> = [];
  const observer = observerFixture({
    systemEvents: { create: (input) => persisted.push({ ...input }) },
    screenshots: {
      capture: async () => ({ status: 'FAILED', errorCode: 'SCREENSHOT_CAPTURE_FAILED' }),
    },
  });

  await observer.observe({
    eventType: 'SELECTOR_FAILURE',
    level: 'error',
    accountId: 'account-id',
    runId: 'run-id',
    friendId: 'friend-id',
    attempt: 1,
    businessDate: parseBusinessDate('2026-08-23'),
    errorCode: 'SELECTOR_FAILURE',
  });
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0]?.message, 'Page selector resolution failed');
  assert.equal(persisted[0]?.screenshotPath, undefined);
});

test('ProductionRuntimeObserver contains trace start/save failure', async () => {
  const logged: string[] = [];
  const observer = observerFixture({
    logger: { emit: (_level, event) => logged.push(event.errorCode ?? event.eventType) },
    traces: {
      start: async () => ({ status: 'FAILED', errorCode: 'TRACE_START_FAILED' }),
      finish: async () => ({ status: 'FAILED', errorCode: 'TRACE_SAVE_FAILED' }),
    },
  });
  const context = {
    accountId: 'account-id',
    runId: 'run-id',
    businessDate: parseBusinessDate('2026-08-23'),
  };

  await observer.startRun(context);
  await observer.finishRun(context, 'FAILED', true);
  assert.ok(logged.includes('TRACE_START_FAILED'));
  assert.ok(logged.includes('TRACE_SAVE_FAILED'));
});

test('ProductionRuntimeObserver contains retention failure', async () => {
  const logged: string[] = [];
  const observer = observerFixture({
    logger: { emit: (_level, event) => logged.push(event.errorCode ?? event.eventType) },
    retention: {
      cleanup: () => {
        throw new Error('fixture retention failed');
      },
    },
  });

  await observer.cleanup();
  assert.deepEqual(logged, ['RETENTION_CLEANUP_FAILED']);
});

test('ProductionRuntimeObserver broadcasts a whitelisted runtime DTO after persistence', async () => {
  const order: string[] = [];
  const realtimeEvents: RealtimeEvent[] = [];
  const hub = new RuntimeEventHub(() => new Date('2026-08-23T12:00:00.000Z'));
  hub.subscribe((event) => {
    order.push('broadcast');
    realtimeEvents.push(event);
  });
  const observer = observerFixture({
    logger: { emit: () => order.push('log') },
    systemEvents: { create: () => order.push('persist') },
    realtime: hub,
  });

  await observer.observe({
    eventType: 'AUTH_EXPIRED',
    level: 'error',
    persist: true,
    accountId: 'fixture-account-id',
    runId: 'fixture-run-id',
    businessDate: parseBusinessDate('2026-08-23'),
    errorCode: 'AUTH_EXPIRED',
    captureScreenshot: false,
    messageText: 'PRIVATE_MESSAGE_SENTINEL',
    cookie: 'PRIVATE_COOKIE_SENTINEL',
    stack: 'PRIVATE_STACK_SENTINEL',
    screenshotPath: '/private/evidence.png',
  } as RuntimeObservation & Record<string, unknown>);

  assert.deepEqual(order, ['log', 'persist', 'broadcast']);
  assert.equal(realtimeEvents.length, 1);
  const serialized = JSON.stringify(realtimeEvents[0]);
  assert.match(serialized, /AUTH_EXPIRED/u);
  assert.doesNotMatch(
    serialized,
    /PRIVATE_|messageText|cookie|stack|screenshotPath|tracePath|databasePath|browserProfile|SQL/u,
  );
});

test('ProductionRuntimeObserver contains realtime publisher failure without changing persistence', async () => {
  let persisted = 0;
  const logged: string[] = [];
  const observer = observerFixture({
    logger: { emit: (_level, event) => logged.push(event.errorCode ?? event.eventType) },
    systemEvents: {
      create: () => {
        persisted += 1;
      },
    },
    realtime: {
      publish: () => {
        throw new Error('fixture realtime failure');
      },
    },
  });

  await assert.doesNotReject(() =>
    observer.observe({ eventType: 'TASK_FAILED', level: 'error', persist: true }),
  );
  assert.equal(persisted, 1);
  assert.deepEqual(logged, ['TASK_FAILED', 'REALTIME_BROADCAST_FAILED']);
});

test('ProductionRuntimeObserver publishes one safe notification candidate after persistence and realtime', async () => {
  const order: string[] = [];
  const candidates: unknown[] = [];
  const observer = observerFixture({
    logger: { emit: () => order.push('log') },
    systemEvents: { create: () => order.push('persist') },
    realtime: { publish: () => order.push('realtime') },
    notifications: {
      publish: (candidate) => {
        order.push('notification');
        candidates.push(candidate);
      },
    },
  });

  await observer.observe({
    eventType: 'DELIVERY_UNKNOWN',
    level: 'error',
    accountId: 'fixture-account-id',
    runId: 'fixture-run-id',
    friendId: 'fixture-friend-id',
    businessDate: parseBusinessDate('2026-08-23'),
    errorCode: 'DELIVERY_UNKNOWN',
    captureScreenshot: false,
    messageText: 'PRIVATE_MESSAGE_SENTINEL',
    token: 'PRIVATE_TOKEN_SENTINEL',
    screenshotPath: '/private/evidence.png',
  } as RuntimeObservation & Record<string, unknown>);

  assert.deepEqual(order, ['log', 'persist', 'realtime', 'notification']);
  assert.deepEqual(candidates, [
    {
      eventType: 'DELIVERY_UNKNOWN',
      severity: 'ERROR',
      safeMessage: 'Delivery result is uncertain',
      timestamp: '2026-08-23T12:00:00.000Z',
      accountId: 'fixture-account-id',
      runId: 'fixture-run-id',
      businessDate: '2026-08-23',
      errorCode: 'DELIVERY_UNKNOWN',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(candidates), /friend|PRIVATE_|messageText|token|screenshot/u);
});

test('ProductionRuntimeObserver contains notification publisher failure', async () => {
  const observer = observerFixture({
    notifications: {
      publish: () => {
        throw new Error('PRIVATE_NOTIFICATION_FAILURE');
      },
    },
  });

  await assert.doesNotReject(() =>
    observer.observe({ eventType: 'TASK_FAILED', level: 'error', captureScreenshot: false }),
  );
});

function observerFixture(
  overrides: Partial<ConstructorParameters<typeof ProductionRuntimeObserver>[0]> = {},
): ProductionRuntimeObserver {
  return new ProductionRuntimeObserver({
    logger: { emit: () => undefined },
    systemEvents: { create: () => undefined },
    screenshots: {
      capture: async () => ({ status: 'FAILED', errorCode: 'SCREENSHOT_CAPTURE_FAILED' }),
    },
    traces: {
      start: async () => ({ status: 'DISABLED' }),
      finish: async () => ({ status: 'NOT_STARTED' }),
    },
    retention: { cleanup: () => ({ removedFiles: [], errorCount: 0 }) },
    fallback: () => undefined,
    clock: () => new Date('2026-08-23T12:00:00.000Z'),
    ...overrides,
  });
}

class RecordingObserver implements RuntimeObserver {
  readonly events: RuntimeObservation[] = [];
  readonly starts: RuntimeRunContext[] = [];
  readonly finishes: Array<{
    context: RuntimeRunContext;
    result: RuntimeRunResult;
    evidenceFailed: boolean;
  }> = [];
  throwEverywhere = false;

  async observe(event: RuntimeObservation): Promise<void> {
    if (this.throwEverywhere) throw new Error('fixture observer failed');
    this.events.push(event);
  }

  async startRun(context: RuntimeRunContext): Promise<void> {
    if (this.throwEverywhere) throw new Error('fixture trace start failed');
    this.starts.push(context);
  }

  async finishRun(
    context: RuntimeRunContext,
    result: RuntimeRunResult,
    evidenceFailed: boolean,
  ): Promise<void> {
    if (this.throwEverywhere) throw new Error('fixture trace finish failed');
    this.finishes.push({ context, result, evidenceFailed });
  }

  async cleanup(): Promise<void> {
    if (this.throwEverywhere) throw new Error('fixture retention failed');
  }
}

class ControlledAutomation implements DailyTaskAutomation {
  startCount = 0;
  sendCount = 0;
  closeCount = 0;
  startError: Error | undefined;
  openResult: ContactOpenResult = { status: 'VERIFIED' };
  sendResult: AutomationSendResult = { status: 'SUCCESS', sendAction: 'TRIGGERED' };

  async start(): Promise<void> {
    this.startCount += 1;
    if (this.startError !== undefined) throw this.startError;
  }
  async checkAuth(): Promise<'READY'> {
    return 'READY';
  }
  async resolveAndOpen(): Promise<ContactOpenResult> {
    return this.openResult;
  }
  async sendAndVerify(): Promise<AutomationSendResult> {
    this.sendCount += 1;
    return this.sendResult;
  }
  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

function runnerFixture(context: TestContext, observer: RuntimeObserver) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-observer-runner-test-'));
  const client = createDatabase({ databasePath: path.join(directory, 'sparkkeeper.db') });
  client.migrate();
  context.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const accounts = new AccountRepository(client);
  const friends = new FriendRepository(client);
  const templates = new MessageTemplateRepository(client);
  const schedules = new ScheduleRepository(client);
  const dailyRuns = new DailyRunRepository(client);
  const sendRecords = new SendRecordRepository(client);
  const account = accounts.create({ name: 'Test Account', loginStatus: 'READY' });
  const friend = friends.create({ accountId: account.id, displayName: 'Test User' });
  const template = templates.create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Test message'],
  });
  schedules.create({
    accountId: account.id,
    startTime: '19:30',
    endTime: '21:00',
    timezone: 'Asia/Shanghai',
    now: new Date('2026-08-23T12:00:00.000Z'),
  });
  const automation = new ControlledAutomation();
  const runner = new DailyTaskRunner({
    accountId: account.id,
    messageTemplateId: template.id,
    allowRealSend: true,
    automation,
    accounts,
    schedules,
    friends,
    templates,
    dailyRuns,
    sendRecords,
    observer,
    now: () => new Date('2026-08-23T12:00:00.000Z'),
  });
  return {
    runner,
    automation,
    sendRecords,
    friends,
    templates,
    dailyRuns,
    template,
    friend,
    account,
    schedules,
    businessDate: parseBusinessDate('2026-08-23'),
  };
}

test('DailyTaskRunner emits structured phase events with internal Attempt context', async (context) => {
  const observer = new RecordingObserver();
  const fixture = runnerFixture(context, observer);

  assert.equal(await fixture.runner.run(fixture.account.id, fixture.businessDate), 'SUCCESS');
  const eventTypes = observer.events.map((event) => event.eventType);
  for (const expected of [
    'RUN_STARTED',
    'AUTH_CHECKING',
    'MESSAGE_BUILDING',
    'FRIEND_RESOLVING',
    'MESSAGE_SENDING',
    'VERIFYING',
    'VERIFY_SUCCESS',
  ]) {
    assert.ok(eventTypes.includes(expected as RuntimeObservation['eventType']));
  }
  const resolving = observer.events.find((event) => event.eventType === 'FRIEND_RESOLVING');
  assert.equal(resolving?.accountId, fixture.account.id);
  assert.equal(resolving?.friendId, fixture.friend.id);
  assert.equal(resolving?.attempt, 1);
  assert.equal(observer.starts.length, 1);
  assert.deepEqual(
    observer.finishes.map(({ result, evidenceFailed }) => ({
      result,
      evidenceFailed,
    })),
    [{ result: 'SUCCESS', evidenceFailed: false }],
  );
});

test('DailyTaskRunner records RETRY_WAIT with internal context and no message text', async (context) => {
  const observer = new RecordingObserver();
  const fixture = runnerFixture(context, observer);
  fixture.automation.openResult = { status: 'FAILED', failureCode: 'BROWSER_TRANSIENT' };

  assert.equal(await fixture.runner.run(fixture.account.id, fixture.businessDate), 'RETRY_WAIT');
  const retry = observer.events.find((event) => event.eventType === 'RETRY_WAIT');
  assert.equal(retry?.accountId, fixture.account.id);
  assert.equal(retry?.friendId, fixture.friend.id);
  assert.equal(retry?.attempt, 1);
  assert.equal(retry?.errorCode, 'BROWSER_TRANSIENT');
  assert.equal('messageText' in (retry ?? {}), false);
  assert.deepEqual(
    observer.finishes.map(({ result, evidenceFailed }) => ({ result, evidenceFailed })),
    [{ result: 'RETRY_WAIT', evidenceFailed: true }],
  );
});

test('DailyTaskRunner records final failure when Browser startup fails before Trace starts', async (context) => {
  const observer = new RecordingObserver();
  const fixture = runnerFixture(context, observer);
  fixture.automation.startError = new Error('controlled startup failure');

  await assert.rejects(() => fixture.runner.run(fixture.account.id, fixture.businessDate));
  assert.equal(observer.starts.length, 0);
  assert.deepEqual(
    observer.finishes.map(({ result, evidenceFailed }) => ({ result, evidenceFailed })),
    [{ result: 'FAILED', evidenceFailed: true }],
  );
});

test('RUN_FINISHED uses the aggregate result for mixed Friend outcomes', async (context) => {
  const observer = new RecordingObserver();
  const fixture = runnerFixture(context, observer);
  fixture.friends.create({ accountId: fixture.account.id, displayName: 'Second Test User' });
  const run = fixture.dailyRuns.createOrGet({
    accountId: fixture.account.id,
    businessDate: fixture.businessDate,
    now: new Date('2026-08-23T12:00:00.000Z'),
  });
  const failed = fixture.sendRecords.prepare({
    dailyRunId: run.id,
    friendId: fixture.friend.id,
    businessDate: fixture.businessDate,
    messageTemplateId: fixture.template.id,
    messageText: 'Test message',
    now: new Date('2026-08-23T12:00:00.000Z'),
  }).record;
  fixture.sendRecords.markFailedBeforeSend(
    failed.id,
    new Date('2026-08-23T12:00:00.000Z'),
    'CONTACT_NOT_FOUND',
  );

  assert.equal(await fixture.runner.run(fixture.account.id, fixture.businessDate), 'FAILED');
  assert.deepEqual(
    observer.finishes.map(({ result, evidenceFailed }) => ({ result, evidenceFailed })),
    [{ result: 'FAILED', evidenceFailed: false }],
  );
});

test('TaskScheduler runs retention cleanup at most once per business date', async (context) => {
  const observer = new RecordingObserver();
  const fixture = runnerFixture(context, observer);
  let now = new Date('2026-08-23T12:00:00.000Z');
  let cleanupCount = 0;
  let runCount = 0;
  const scheduler = new TaskScheduler(
    fixture.account.id,
    fixture.schedules,
    {
      run: async () => {
        runCount += 1;
        return 'SUCCESS';
      },
    },
    { now: () => now },
    {
      setInterval: () => 1,
      clearInterval: () => undefined,
    },
    60_000,
    () => undefined,
    {
      cleanup: async () => {
        cleanupCount += 1;
      },
    },
  );

  await scheduler.tick();
  await scheduler.tick();
  now = new Date('2026-08-24T12:00:00.000Z');
  await scheduler.tick();
  assert.equal(runCount, 3);
  assert.equal(cleanupCount, 2);
});

test('observability failure never adds a Send Attempt or changes SUCCESS', async (context) => {
  const observer = new RecordingObserver();
  observer.throwEverywhere = true;
  const fixture = runnerFixture(context, observer);

  assert.equal(await fixture.runner.run(fixture.account.id, fixture.businessDate), 'SUCCESS');
  assert.equal(fixture.automation.sendCount, 1);
  const record = fixture.sendRecords.findByFriendAndBusinessDate(
    fixture.friend.id,
    fixture.businessDate,
  );
  assert.equal(record?.status, 'SUCCESS');
  assert.equal(record?.attemptCount, 1);
});

test('observability failure never retries DELIVERY_UNKNOWN', async (context) => {
  const observer = new RecordingObserver();
  observer.throwEverywhere = true;
  const fixture = runnerFixture(context, observer);
  fixture.automation.sendResult = {
    status: 'DELIVERY_UNKNOWN',
    failureCode: 'DELIVERY_UNKNOWN',
    sendAction: 'TRIGGERED',
  };

  assert.equal(await fixture.runner.run(fixture.account.id, fixture.businessDate), 'FAILED');
  assert.equal(fixture.automation.sendCount, 1);
  const record = fixture.sendRecords.findByFriendAndBusinessDate(
    fixture.friend.id,
    fixture.businessDate,
  );
  assert.equal(record?.status, 'DELIVERY_UNKNOWN');
  assert.equal(record?.attemptCount, 1);
});
