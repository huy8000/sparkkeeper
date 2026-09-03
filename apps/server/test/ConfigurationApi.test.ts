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
  ScheduleRepositoryError,
  type Account,
  type Friend,
  type Schedule,
} from '@sparkkeeper/database';

import {
  createApiApplication,
  type ApiApplication,
  type ServerEnvironment,
} from '../src/http/ApiApplication.js';
import { ApiError } from '../src/http/errors/ApiError.js';
import { ApiConfigurationService } from '../src/http/services/ApiConfigurationService.js';
import type { RealtimeEvent } from '../src/realtime/RealtimeEvent.js';
import { createAuthenticatedTestSession, type TestAuthSession } from './authFixture.js';

const FIXED_NOW = new Date('2026-02-03T04:05:06.000Z');
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';
const API_HOST = '127.0.0.1:8080';
const ADMIN_ORIGIN = 'http://127.0.0.1:8080';
const STATIC_MESSAGE = 'Fictional static template content.';
const RANDOM_MESSAGE_A = 'Fictional random template alpha.';
const RANDOM_MESSAGE_B = 'Fictional random template beta.';

interface Fixture {
  readonly application: ApiApplication;
  readonly session: TestAuthSession;
  readonly account: Account;
  readonly friend: Friend;
  readonly schedule: Schedule;
  readonly logs: () => string;
}

test('centralized local Admin mutation guard', async (context) => {
  const fixture = await createFixture(context);
  const { server } = fixture.application;
  const payload = { name: 'Guard Demo Account', enabled: true };

  await context.test('accepts exact same-origin JSON with session and CSRF', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: mutationHeaders(fixture.session),
      payload,
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().success, true);
  });

  await context.test('blocks missing and incorrect CSRF tokens', async () => {
    for (const value of [undefined, '0', 'true', 'a'.repeat(43)]) {
      const headers = mutationHeaders(fixture.session);
      if (value === undefined) delete headers['x-sparkkeeper-csrf'];
      else headers['x-sparkkeeper-csrf'] = value;
      const response = await server.inject({
        method: 'POST',
        url: '/api/accounts',
        headers,
        payload,
      });
      assertError(response, 403, 'CSRF_REJECTED');
    }
  });

  await context.test('blocks cross-origin and spoof-like origins exactly', async () => {
    for (const origin of [
      'https://example.test',
      'http://127.0.0.1.evil.test:8080',
      'http://127.0.0.1:8080.evil.test',
      'null',
    ]) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: mutationHeaders(fixture.session, { origin }),
        payload,
      });
      assertError(response, 403, 'ORIGIN_REJECTED');
    }
  });

  await context.test('blocks untrusted and spoof-like Host values exactly', async () => {
    for (const host of ['example.test', '127.0.0.1.evil.test:8080', 'localhost.evil:5173']) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: mutationHeaders(fixture.session, { host }),
        payload,
      });
      assertError(response, 403, 'ORIGIN_REJECTED');
    }
  });

  await context.test('blocks non-JSON mutation media types', async () => {
    for (const contentType of ['application/x-www-form-urlencoded', 'text/plain']) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: mutationHeaders(fixture.session, { 'content-type': contentType }),
        payload: 'name=Unsafe',
      });
      assertError(response, 400, 'VALIDATION_ERROR');
    }
  });

  await context.test('does not apply CSRF requirements to GET routes', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { cookie: fixture.session.cookieHeader },
    });
    assert.equal(response.statusCode, 200);
  });

  await context.test('does not add permissive CORS response headers', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  });
});

test('Account configuration API', async (context) => {
  const fixture = await createFixture(context);
  const { server } = fixture.application;

  await context.test('creates and trims an Account without writable runtime state', async () => {
    const response = await mutate(server, fixture.session, 'POST', '/api/accounts', {
      name: '  Configured Demo Account  ',
      enabled: false,
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().data.name, 'Configured Demo Account');
    assert.equal(response.json().data.enabled, false);
    assert.equal(response.json().data.loginStatus, 'UNKNOWN');
  });

  await context.test('updates name and enabled with exact PATCH semantics', async () => {
    const response = await mutate(
      server,
      fixture.session,
      'PATCH',
      `/api/accounts/${fixture.account.id}`,
      {
        name: 'Renamed Demo Account',
        enabled: false,
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.name, 'Renamed Demo Account');
    assert.equal(response.json().data.enabled, false);
  });

  await context.test(
    'rejects invalid names, loginStatus, empty patches, and unknown fields',
    async () => {
      for (const body of [
        { name: '   ' },
        { loginStatus: 'READY' },
        {},
        { name: 'Demo', unexpected: true },
      ]) {
        const response = await mutate(
          server,
          fixture.session,
          'PATCH',
          `/api/accounts/${fixture.account.id}`,
          body,
        );
        assertError(response, 400, 'VALIDATION_ERROR');
      }
    },
  );

  await context.test('reports a missing Account', async () => {
    const response = await mutate(
      server,
      fixture.session,
      'PATCH',
      `/api/accounts/${UNKNOWN_UUID}`,
      {
        enabled: false,
      },
    );
    assertError(response, 404, 'ACCOUNT_NOT_FOUND');
  });
});

test('Friend configuration API', async (context) => {
  const fixture = await createFixture(context);
  const { server } = fixture.application;

  await context.test('creates configurations for every supported match field', async () => {
    const cases = [
      { matchField: 'displayName', displayName: 'Demo Contact Display' },
      {
        matchField: 'remarkName',
        displayName: 'Demo Contact Remark',
        remarkName: 'Demo Remark',
      },
      { matchField: 'shortId', displayName: 'Demo Contact Short', shortId: 'demo-short' },
      { matchField: 'uniqueId', displayName: 'Demo Contact Unique', uniqueId: 'demo-unique' },
      { matchField: 'secUid', displayName: 'Demo Contact Stable', secUid: 'demo-sec-uid' },
    ] as const;
    for (const body of cases) {
      const response = await mutate(
        server,
        fixture.session,
        'POST',
        `/api/accounts/${fixture.account.id}/friends`,
        body,
      );
      assert.equal(response.statusCode, 201);
      assert.equal(response.json().data.matchField, body.matchField);
    }
  });

  await context.test(
    'updates identity and enabled state without automation side effects',
    async () => {
      const response = await mutate(
        server,
        fixture.session,
        'PATCH',
        `/api/friends/${fixture.friend.id}`,
        {
          remarkName: 'Updated Demo Remark',
          matchField: 'remarkName',
          enabled: false,
        },
      );
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().data.remarkName, 'Updated Demo Remark');
      assert.equal(response.json().data.enabled, false);
      assert.equal(response.json().data.matchField, 'remarkName');
    },
  );

  await context.test('preserves an omitted matchField during identity-only PATCH', async () => {
    const before = await server.inject({
      method: 'GET',
      url: `/api/friends/${fixture.friend.id}`,
      headers: { cookie: fixture.session.cookieHeader },
    });
    const response = await mutate(
      server,
      fixture.session,
      'PATCH',
      `/api/friends/${fixture.friend.id}`,
      {
        uniqueId: 'stronger-demo-identity',
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.matchField, before.json().data.matchField);
    assert.equal(response.json().data.uniqueId, 'stronger-demo-identity');
  });

  await context.test('rejects a missing selected identity and invalid match fields', async () => {
    const missingIdentity = await mutate(
      server,
      fixture.session,
      'POST',
      `/api/accounts/${fixture.account.id}/friends`,
      { displayName: 'Demo Missing Identity', matchField: 'uniqueId' },
    );
    assertError(missingIdentity, 400, 'VALIDATION_ERROR');

    const invalidField = await mutate(
      server,
      fixture.session,
      'PATCH',
      `/api/friends/${fixture.friend.id}`,
      {
        matchField: 'firstResult',
      },
    );
    assertError(invalidField, 400, 'VALIDATION_ERROR');
  });

  await context.test('reports missing Account and Friend relationships', async () => {
    const missingAccount = await mutate(
      server,
      fixture.session,
      'POST',
      `/api/accounts/${UNKNOWN_UUID}/friends`,
      {
        displayName: 'Demo Orphan Contact',
      },
    );
    assertError(missingAccount, 404, 'ACCOUNT_NOT_FOUND');

    const missingFriend = await mutate(
      server,
      fixture.session,
      'PATCH',
      `/api/friends/${UNKNOWN_UUID}`,
      {
        enabled: false,
      },
    );
    assertError(missingFriend, 404, 'FRIEND_NOT_FOUND');
  });
});

test('MessageTemplate configuration API', async (context) => {
  const fixture = await createFixture(context);
  const { server } = fixture.application;

  await context.test('creates STATIC and RANDOM templates', async () => {
    const staticResponse = await mutate(server, fixture.session, 'POST', '/api/templates', {
      name: 'Demo Static Template',
      providerType: 'STATIC',
      messages: [STATIC_MESSAGE],
      enabled: true,
    });
    assert.equal(staticResponse.statusCode, 201);
    assert.deepEqual(staticResponse.json().data.messages, [STATIC_MESSAGE]);

    const randomResponse = await mutate(server, fixture.session, 'POST', '/api/templates', {
      name: 'Demo Random Template',
      providerType: 'RANDOM',
      messages: [RANDOM_MESSAGE_A, RANDOM_MESSAGE_B],
      enabled: false,
    });
    assert.equal(randomResponse.statusCode, 201);
    assert.equal(randomResponse.json().data.providerType, 'RANDOM');
  });

  await context.test('lists summaries without content and returns detail for editing', async () => {
    const repository = new MessageTemplateRepository(fixture.application.database);
    const template = repository.create({
      name: 'Demo Summary Template',
      providerType: 'STATIC',
      messages: [STATIC_MESSAGE],
    });
    const list = await server.inject({
      method: 'GET',
      url: '/api/templates',
      headers: { cookie: fixture.session.cookieHeader },
    });
    assert.equal(list.statusCode, 200);
    const summary = list
      .json()
      .data.find((item: { readonly id: string }) => item.id === template.id);
    assert.equal(summary.messageCount, 1);
    assert.equal('messages' in summary, false);
    assert.doesNotMatch(list.body, new RegExp(STATIC_MESSAGE, 'u'));

    const detail = await server.inject({
      method: 'GET',
      url: `/api/templates/${template.id}`,
      headers: { cookie: fixture.session.cookieHeader },
    });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(detail.json().data.messages, [STATIC_MESSAGE]);
  });

  await context.test('updates provider content and enabled state', async () => {
    const repository = new MessageTemplateRepository(fixture.application.database);
    const template = repository.create({
      name: 'Demo Editable Template',
      providerType: 'STATIC',
      messages: [STATIC_MESSAGE],
    });
    const response = await mutate(
      server,
      fixture.session,
      'PATCH',
      `/api/templates/${template.id}`,
      {
        providerType: 'RANDOM',
        messages: [RANDOM_MESSAGE_A, RANDOM_MESSAGE_B],
        enabled: false,
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.messageCount, 2);
    assert.equal(response.json().data.enabled, false);
  });

  await context.test('rejects provider and message configuration errors safely', async () => {
    for (const body of [
      { name: 'Invalid Provider', providerType: 'REMOTE', messages: [STATIC_MESSAGE] },
      { name: 'Invalid Static', providerType: 'STATIC', messages: [STATIC_MESSAGE, 'Extra'] },
      { name: 'Empty Messages', providerType: 'RANDOM', messages: [] },
      { name: 'Blank Message', providerType: 'RANDOM', messages: ['   '] },
    ]) {
      const response = await mutate(server, fixture.session, 'POST', '/api/templates', body);
      assertError(response, 400, 'VALIDATION_ERROR');
      assert.doesNotMatch(response.body, /Fictional|Blank Message/iu);
    }
  });

  await context.test('reports missing templates and does not log message bodies', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/templates/${UNKNOWN_UUID}`,
      headers: { cookie: fixture.session.cookieHeader },
    });
    assertError(response, 404, 'TEMPLATE_NOT_FOUND');
    assert.doesNotMatch(fixture.logs(), /Fictional static|Fictional random/iu);
  });

  await context.test('preserves intentional message whitespace', async () => {
    const message = '  Fictional message with intentional spacing.  ';
    const response = await mutate(server, fixture.session, 'POST', '/api/templates', {
      name: 'Whitespace Demo Template',
      providerType: 'STATIC',
      messages: [message],
    });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json().data.messages, [message]);
  });
});

test('Schedule configuration API and forbidden capability boundary', async (context) => {
  const fixture = await createFixture(context);
  const { server } = fixture.application;

  await context.test('updates an existing account-scoped Schedule', async () => {
    const response = await mutate(
      server,
      fixture.session,
      'PUT',
      `/api/accounts/${fixture.account.id}/schedule`,
      scheduleBody({ enabled: false, maxAttempts: 5 }),
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.id, fixture.schedule.id);
    assert.equal(response.json().data.enabled, false);
    assert.equal(response.json().data.maxAttempts, 5);
  });

  await context.test('creates a Schedule when the Account has none', async () => {
    const accounts = new AccountRepository(fixture.application.database);
    const account = accounts.create({ name: 'Schedule Demo Account' });
    const response = await mutate(
      server,
      fixture.session,
      'PUT',
      `/api/accounts/${account.id}/schedule`,
      scheduleBody(),
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.accountId, account.id);
  });

  await context.test('rejects invalid time, timezone, and bounded retry values', async () => {
    for (const body of [
      scheduleBody({ startTime: '9:00' }),
      scheduleBody({ startTime: '11:00', endTime: '10:00' }),
      scheduleBody({ timezone: 'Invalid/Timezone' }),
      scheduleBody({ maxAttempts: 0 }),
      scheduleBody({ retryIntervalSeconds: -1 }),
    ]) {
      const response = await mutate(
        server,
        fixture.session,
        'PUT',
        `/api/accounts/${fixture.account.id}/schedule`,
        body,
      );
      assertError(response, 400, 'VALIDATION_ERROR');
    }
  });

  await context.test(
    'cannot write runtime scheduler or real-send authorization fields',
    async () => {
      const response = await mutate(
        server,
        fixture.session,
        'PUT',
        `/api/accounts/${fixture.account.id}/schedule`,
        {
          ...scheduleBody(),
          schedulerEnabled: true,
          allowRealSend: true,
        },
      );
      assertError(response, 400, 'VALIDATION_ERROR');
    },
  );

  await context.test('reports a missing Account relationship', async () => {
    const response = await mutate(
      server,
      fixture.session,
      'PUT',
      `/api/accounts/${UNKNOWN_UUID}/schedule`,
      scheduleBody(),
    );
    assertError(response, 404, 'ACCOUNT_NOT_FOUND');
  });

  await context.test(
    'does not expose execution, send, browser, or evidence mutations',
    async () => {
      const forbiddenPaths = [
        '/api/run',
        '/api/send',
        '/api/scheduler/start',
        '/api/runtime/real-send',
        '/api/browser/session',
        '/api/evidence/file',
      ];
      for (const url of forbiddenPaths) {
        const response = await mutate(server, fixture.session, 'POST', url, {});
        assertError(response, 404, 'ROUTE_NOT_FOUND');
      }
    },
  );

  await context.test(
    'configuration mutations create no DailyRun and preserve runtime safety',
    async () => {
      const runs = new DailyRunRepository(fixture.application.database);
      assert.deepEqual(runs.list(), []);
      const runtime = await server.inject({
        method: 'GET',
        url: '/api/runtime/status',
        headers: { cookie: fixture.session.cookieHeader },
      });
      assert.equal(runtime.json().data.schedulerEnabled, false);
      assert.equal(runtime.json().data.realSendAuthorizationEnabled, false);
    },
  );

  await context.test('maps a concurrent account-schedule uniqueness race to conflict', () => {
    const conflict = Object.assign(new Error('fixture constraint'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    const service = new ApiConfigurationService({
      accounts: new AccountRepository(fixture.application.database),
      friends: new FriendRepository(fixture.application.database),
      templates: new MessageTemplateRepository(fixture.application.database),
      schedules: {
        findByAccountId: () => undefined,
        create: () => {
          throw new ScheduleRepositoryError(
            'create',
            'DATABASE_OPERATION_FAILED',
            'Fixture constraint failure.',
            conflict,
          );
        },
        update: () => undefined,
      },
    });
    assert.throws(
      () =>
        service.configureSchedule(fixture.account.id, {
          startTime: '09:00',
          endTime: '10:00',
          timezone: 'UTC',
          enabled: true,
          maxAttempts: 3,
          retryIntervalSeconds: 60,
        }),
      (error: unknown) =>
        error instanceof ApiError && error.statusCode === 409 && error.code === 'CONFLICT',
    );
  });
});

test('successful configuration mutations emit only safe CONFIG_CHANGED invalidations', async (context) => {
  const fixture = await createFixture(context);
  const events: RealtimeEvent[] = [];
  const unsubscribe = fixture.application.realtime.subscribe((event) => events.push(event));
  context.after(unsubscribe);

  const account = await mutate(
    fixture.application.server,
    fixture.session,
    'POST',
    '/api/accounts',
    {
      name: 'Realtime Demo Account',
    },
  );
  const friend = await mutate(
    fixture.application.server,
    fixture.session,
    'POST',
    `/api/accounts/${fixture.account.id}/friends`,
    { displayName: 'Realtime Demo Contact', shortId: 'realtime-demo', matchField: 'shortId' },
  );
  const template = await mutate(
    fixture.application.server,
    fixture.session,
    'POST',
    '/api/templates',
    {
      name: 'Realtime Demo Template',
      providerType: 'STATIC',
      messages: ['PRIVATE_TEMPLATE_BODY_SENTINEL'],
    },
  );
  const schedule = await mutate(
    fixture.application.server,
    fixture.session,
    'PUT',
    `/api/accounts/${fixture.account.id}/schedule`,
    scheduleBody({ enabled: false }),
  );
  for (const response of [account, friend, template, schedule]) {
    assert.ok(response.statusCode === 200 || response.statusCode === 201);
  }

  assert.deepEqual(
    events.map((event) =>
      event.type === 'CONFIG_CHANGED'
        ? { type: event.type, entityType: event.data.entityType }
        : { type: event.type },
    ),
    [
      { type: 'CONFIG_CHANGED', entityType: 'ACCOUNT' },
      { type: 'CONFIG_CHANGED', entityType: 'FRIEND' },
      { type: 'CONFIG_CHANGED', entityType: 'TEMPLATE' },
      { type: 'CONFIG_CHANGED', entityType: 'SCHEDULE' },
    ],
  );
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(
    serialized,
    /PRIVATE_TEMPLATE_BODY_SENTINEL|Realtime Demo Contact|messages|displayName|mutation/u,
  );

  const eventCount = events.length;
  const failed = await mutate(
    fixture.application.server,
    fixture.session,
    'POST',
    '/api/templates',
    {
      name: 'Invalid Realtime Template',
      providerType: 'STATIC',
      messages: [],
    },
  );
  assertError(failed, 400, 'VALIDATION_ERROR');
  assert.equal(events.length, eventCount);
});

async function createFixture(context: TestContext): Promise<Fixture> {
  const directory = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-config-api-test-'));
  const databasePath = path.join(directory, 'fixture.db');
  let logs = '';
  const application = createApiApplication({
    databasePath,
    environment: disabledEnvironment(),
    logger: {
      level: 'info',
      stream: { write: (chunk: string) => (logs += chunk) },
    },
    clock: () => FIXED_NOW,
  });
  context.after(async () => {
    await application.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const session = await createAuthenticatedTestSession(application);

  const accounts = new AccountRepository(application.database);
  const friends = new FriendRepository(application.database);
  const schedules = new ScheduleRepository(application.database);
  const account = accounts.create({ name: 'Demo Configuration Account', loginStatus: 'READY' });
  const friend = friends.create({
    accountId: account.id,
    displayName: 'Demo Contact Alpha',
    shortId: 'demo-alpha',
    matchField: 'shortId',
  });
  const schedule = schedules.create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'UTC',
    now: FIXED_NOW,
  });
  return { application, session, account, friend, schedule, logs: () => logs };
}

function disabledEnvironment(): ServerEnvironment {
  return {
    SCHEDULER_ENABLED: 'false',
    SCHEDULER_ALLOW_REAL_SEND: 'false',
    APP_TIMEZONE: 'UTC',
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

async function mutate(
  server: ApiApplication['server'],
  session: TestAuthSession,
  method: 'POST' | 'PATCH' | 'PUT',
  url: string,
  payload: unknown,
) {
  return server.inject({ method, url, headers: mutationHeaders(session), payload });
}

function scheduleBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'UTC',
    enabled: true,
    maxAttempts: 3,
    retryIntervalSeconds: 60,
    ...overrides,
  };
}

function assertError(
  response: { readonly statusCode: number; json(): unknown; readonly body: string },
  statusCode: number,
  code: string,
): void {
  assert.equal(response.statusCode, statusCode, response.body);
  assert.deepEqual(response.json(), {
    success: false,
    error: {
      code,
      message: (response.json() as { error: { message: string } }).error.message,
    },
  });
  assert.doesNotMatch(
    response.body,
    /stack|SQL|filesystem|cookie|rawToken|tokenDigest|browser profile/iu,
  );
}
