import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AccountRepository,
  createDatabase,
  FriendRepository,
  MessageTemplateRepository,
  ScheduleRepository,
} from '@sparkkeeper/database';

import { renderV1Preflight, runV1Preflight } from '../src/readiness/V1Preflight.js';

test('V1 preflight reports all controlled-validation prerequisites ready without enabling sending', (context) => {
  const fixture = readyFixture(context);

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });
  const output = renderV1Preflight(result);

  assert.equal(result.ready, true);
  assert.match(output, /Database: READY/);
  assert.match(output, /Migration: READY/);
  assert.match(output, /Account: READY/);
  assert.match(output, /Schedule: READY/);
  assert.match(output, /Template: READY/);
  assert.match(output, /Enabled friends: 2/);
  assert.match(output, /Browser profile path: CONFIGURED/);
  assert.match(output, /Scheduler: DISABLED/);
  assert.match(output, /Real send authorization: DISABLED/);
  assert.match(output, /Observability: READY/);
  assert.match(output, /Controlled validation: READY/);
  assert.equal(output.includes('Alice'), false);
  assert.equal(output.includes('Bob'), false);
  assert.equal(output.includes('Hello'), false);
});

test('V1 preflight blocks when the database is missing', (context) => {
  const fixture = readyFixture(context);
  const environment = { ...fixture.environment, DATA_DIR: path.join(fixture.root, 'missing-data') };

  const result = runV1Preflight({ environment, workingDirectory: fixture.root });

  assert.equal(result.database, 'MISSING');
  assert.equal(result.ready, false);
});

test('V1 preflight blocks when the immutable seven-entry V1 migration prefix is missing', (context) => {
  const fixture = readyFixture(context);
  const dataDirectory = path.join(fixture.root, 'empty-data');
  mkdirSync(dataDirectory, { recursive: true });
  createDatabase({ databasePath: path.join(dataDirectory, 'sparkkeeper.db') }).close();

  const result = runV1Preflight({
    environment: { ...fixture.environment, DATA_DIR: dataDirectory },
    workingDirectory: fixture.root,
  });

  assert.equal(result.migration, 'INVALID');
  assert.equal(result.ready, false);
});

test('V1 preflight blocks when the configured Account is missing', (context) => {
  const fixture = readyFixture(context);

  const result = runV1Preflight({
    environment: {
      ...fixture.environment,
      SCHEDULER_ACCOUNT_ID: '00000000-0000-4000-8000-000000000000',
    },
    workingDirectory: fixture.root,
  });

  assert.equal(result.account, 'MISSING');
  assert.equal(result.ready, false);
});

test('V1 preflight blocks when the configured Account is disabled', (context) => {
  const fixture = readyFixture(context);
  const client = createDatabase({ databasePath: fixture.databasePath });
  new AccountRepository(client).update(fixture.accountId, { enabled: false });
  client.close();

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });

  assert.equal(result.account, 'DISABLED');
  assert.equal(result.ready, false);
});

test('V1 preflight blocks when the configured Account has no Schedule', (context) => {
  const fixture = readyFixture(context);
  const client = createDatabase({ databasePath: fixture.databasePath });
  const account = new AccountRepository(client).create({ name: 'Second Test Account' });
  const friends = new FriendRepository(client);
  friends.create({ accountId: account.id, displayName: 'Test User 1' });
  friends.create({ accountId: account.id, displayName: 'Test User 2' });
  client.close();

  const result = runV1Preflight({
    environment: { ...fixture.environment, SCHEDULER_ACCOUNT_ID: account.id },
    workingDirectory: fixture.root,
  });

  assert.equal(result.schedule, 'MISSING');
  assert.equal(result.ready, false);
});

test('V1 preflight blocks when the configured Schedule is disabled', (context) => {
  const fixture = readyFixture(context);
  const client = createDatabase({ databasePath: fixture.databasePath });
  const schedules = new ScheduleRepository(client);
  const schedule = schedules.findByAccountId(fixture.accountId)!;
  schedules.update(schedule.id, { enabled: false, now: new Date() });
  client.close();

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });

  assert.equal(result.schedule, 'DISABLED');
  assert.equal(result.ready, false);
});

test('V1 preflight blocks when the configured MessageTemplate is missing', (context) => {
  const fixture = readyFixture(context);

  const result = runV1Preflight({
    environment: {
      ...fixture.environment,
      SCHEDULER_MESSAGE_TEMPLATE_ID: '00000000-0000-4000-8000-000000000000',
    },
    workingDirectory: fixture.root,
  });

  assert.equal(result.template, 'MISSING');
  assert.equal(result.ready, false);
});

test('V1 preflight blocks when the configured MessageTemplate is disabled', (context) => {
  const fixture = readyFixture(context);
  const client = createDatabase({ databasePath: fixture.databasePath });
  new MessageTemplateRepository(client).update(fixture.templateId, { enabled: false });
  client.close();

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });

  assert.equal(result.template, 'DISABLED');
  assert.equal(result.ready, false);
});

test('V1 preflight blocks with zero enabled Friends', (context) => {
  const fixture = readyFixture(context);
  const client = createDatabase({ databasePath: fixture.databasePath });
  const friends = new FriendRepository(client);
  for (const friendId of fixture.friendIds) friends.update(friendId, { enabled: false });
  client.close();

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });

  assert.equal(result.enabledFriendCount, 0);
  assert.equal(result.ready, false);
});

test('V1 preflight blocks with only one enabled Friend', (context) => {
  const fixture = readyFixture(context);
  const client = createDatabase({ databasePath: fixture.databasePath });
  new FriendRepository(client).update(fixture.friendIds[0]!, { enabled: false });
  client.close();

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });

  assert.equal(result.enabledFriendCount, 1);
  assert.equal(result.ready, false);
});

test('V1 preflight accepts exactly two enabled Friends', (context) => {
  const fixture = readyFixture(context);

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });

  assert.equal(result.enabledFriendCount, 2);
  assert.equal(result.ready, true);
});

test('V1 preflight blocks when the Browser Profile path is missing', (context) => {
  const fixture = readyFixture(context);

  const result = runV1Preflight({
    environment: {
      ...fixture.environment,
      BROWSER_PROFILE_DIR: path.join(fixture.root, 'missing-profile'),
    },
    workingDirectory: fixture.root,
  });

  assert.equal(result.browserProfile, 'MISSING');
  assert.equal(result.ready, false);
});

test('V1 preflight reports Scheduler disabled as the required Phase A state', (context) => {
  const fixture = readyFixture(context);

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });

  assert.equal(result.scheduler, 'DISABLED');
  assert.equal(result.ready, true);
});

test('V1 preflight reports real-send authorization disabled as the required Phase A state', (context) => {
  const fixture = readyFixture(context);

  const result = runV1Preflight({
    environment: fixture.environment,
    workingDirectory: fixture.root,
  });

  assert.equal(result.realSendAuthorization, 'DISABLED');
  assert.equal(result.ready, true);
});

test('V1 preflight blocks invalid runtime configuration', (context) => {
  const fixture = readyFixture(context);

  const result = runV1Preflight({
    environment: { ...fixture.environment, LOG_LEVEL: 'verbose' },
    workingDirectory: fixture.root,
  });

  assert.equal(result.observability, 'INVALID');
  assert.equal(result.ready, false);
});

test('V1 preflight output never exposes injected secrets, message text, or Friend identities', (context) => {
  const fixture = readyFixture(context);
  const environment = {
    ...fixture.environment,
    COOKIE: 'synthetic-cookie-secret',
    TOKEN: 'synthetic-token-secret',
    MESSAGE_TEXT: 'Synthetic private message',
  };

  const output = renderV1Preflight(runV1Preflight({ environment, workingDirectory: fixture.root }));

  assert.equal(output.includes('synthetic-cookie-secret'), false);
  assert.equal(output.includes('synthetic-token-secret'), false);
  assert.equal(output.includes('Synthetic private message'), false);
  assert.equal(output.includes('Alice'), false);
});

interface ReadyFixture {
  readonly root: string;
  readonly databasePath: string;
  readonly accountId: string;
  readonly templateId: string;
  readonly friendIds: readonly [string, string];
  readonly environment: Record<string, string>;
}

function readyFixture(context: TestContext): ReadyFixture {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-v1-preflight-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const dataDirectory = path.join(root, 'data');
  const profileDirectory = path.join(dataDirectory, 'browser-profile');
  mkdirSync(profileDirectory, { recursive: true });
  const databasePath = path.join(dataDirectory, 'sparkkeeper.db');
  const client = createDatabase({ databasePath });
  client.migrate();
  const account = new AccountRepository(client).create({
    name: 'Test Account',
    enabled: true,
    loginStatus: 'READY',
  });
  const friends = new FriendRepository(client);
  const alice = friends.create({ accountId: account.id, displayName: 'Alice', enabled: true });
  const bob = friends.create({ accountId: account.id, displayName: 'Bob', enabled: true });
  const template = new MessageTemplateRepository(client).create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
    enabled: true,
  });
  new ScheduleRepository(client).create({
    accountId: account.id,
    startTime: '09:00',
    endTime: '10:00',
    timezone: 'Asia/Shanghai',
    enabled: true,
    maxAttempts: 3,
    retryIntervalSeconds: 60,
    now: new Date('2026-08-23T00:00:00.000Z'),
  });
  client.close();
  return {
    root,
    databasePath,
    accountId: account.id,
    templateId: template.id,
    friendIds: [alice.id, bob.id],
    environment: {
      DATA_DIR: dataDirectory,
      BROWSER_PROFILE_DIR: profileDirectory,
      LOG_DIR: path.join(root, 'logs'),
      LOG_LEVEL: 'info',
      TRACE_MODE: 'off',
      SCHEDULER_ENABLED: 'false',
      SCHEDULER_ALLOW_REAL_SEND: 'false',
      SCHEDULER_ACCOUNT_ID: account.id,
      SCHEDULER_MESSAGE_TEMPLATE_ID: template.id,
    },
  };
}
