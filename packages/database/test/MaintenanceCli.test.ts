import assert from 'node:assert/strict';
import test from 'node:test';

import { executeMaintenanceCommand } from '../src/maintenance/MaintenanceCli.js';
import { createTemporaryDatabase } from './testDatabase.js';

test('maintenance command accepts the pnpm argument separator', (context) => {
  const { client } = createTemporaryDatabase(context);

  const output = executeMaintenanceCommand(client, [
    '--',
    'account',
    'create',
    '--name',
    'Test Account',
  ]);

  assert.equal(output.entity, 'Account');
  assert.equal(output.action, 'CREATED');
});

test('Account maintenance creates an Account and returns only its safe operational summary', (context) => {
  const { client } = createTemporaryDatabase(context);

  const output = executeMaintenanceCommand(client, ['account', 'create', '--name', 'Test Account']);

  assert.match(output.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(output, {
    entity: 'Account',
    action: 'CREATED',
    id: output.id,
    name: 'Test Account',
    enabled: true,
    loginStatus: 'UNKNOWN',
  });
});

test('Account maintenance lists safe Account summaries with internal identifiers', (context) => {
  const { client } = createTemporaryDatabase(context);
  const created = executeMaintenanceCommand(client, [
    'account',
    'create',
    '--name',
    'Test Account',
  ]);

  const output = executeMaintenanceCommand(client, ['account', 'list']);

  assert.deepEqual(output, {
    entity: 'Account',
    action: 'LISTED',
    accounts: [
      {
        id: created.id,
        name: 'Test Account',
        enabled: true,
        loginStatus: 'UNKNOWN',
      },
    ],
  });
});

test('Account maintenance explicitly disables and re-enables an Account', (context) => {
  const { client } = createTemporaryDatabase(context);
  const created = executeMaintenanceCommand(client, [
    'account',
    'create',
    '--name',
    'Test Account',
  ]);

  const disabled = executeMaintenanceCommand(client, [
    'account',
    'set-enabled',
    '--id',
    created.id,
    '--enabled',
    'false',
  ]);
  const enabled = executeMaintenanceCommand(client, [
    'account',
    'set-enabled',
    '--id',
    created.id,
    '--enabled',
    'true',
  ]);

  assert.equal(disabled.enabled, false);
  assert.equal(enabled.enabled, true);
});

test('Friend maintenance creates a Friend for an explicit Account with a safe summary', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = executeMaintenanceCommand(client, [
    'account',
    'create',
    '--name',
    'Test Account',
  ]);

  const output = executeMaintenanceCommand(client, [
    'friend',
    'create',
    '--account-id',
    account.id,
    '--display-name',
    'Alice',
  ]);

  assert.equal(output.entity, 'Friend');
  assert.equal(output.action, 'CREATED');
  assert.equal(output.accountId, account.id);
  assert.equal(output.displayName, 'Alice');
  assert.equal(output.matchField, 'displayName');
  assert.equal(output.enabled, true);
});

test('Friend maintenance lists only safe Friend summaries for one explicit Account', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = executeMaintenanceCommand(client, [
    'account',
    'create',
    '--name',
    'Test Account',
  ]);
  const friend = executeMaintenanceCommand(client, [
    'friend',
    'create',
    '--account-id',
    account.id,
    '--display-name',
    'Alice',
    '--sec-uid',
    'synthetic-sec-id',
  ]);

  const output = executeMaintenanceCommand(client, ['friend', 'list', '--account-id', account.id]);

  assert.deepEqual(output, {
    entity: 'Friend',
    action: 'LISTED',
    accountId: account.id,
    friends: [
      {
        id: friend.id,
        displayName: 'Alice',
        matchField: 'secUid',
        enabled: true,
      },
    ],
  });
  assert.equal(JSON.stringify(output).includes('synthetic-sec-id'), false);
});

test('Friend maintenance updates identity and recomputes the preferred match field', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = executeMaintenanceCommand(client, [
    'account',
    'create',
    '--name',
    'Test Account',
  ]);
  const friend = executeMaintenanceCommand(client, [
    'friend',
    'create',
    '--account-id',
    account.id,
    '--display-name',
    'Alice',
  ]);

  const output = executeMaintenanceCommand(client, [
    'friend',
    'update',
    '--id',
    friend.id,
    '--unique-id',
    'synthetic-unique-id',
  ]);

  assert.equal(output.action, 'UPDATED');
  assert.equal(output.matchField, 'uniqueId');
  assert.equal(JSON.stringify(output).includes('synthetic-unique-id'), false);
});

test('MessageTemplate maintenance creates a STATIC template without echoing message content', (context) => {
  const { client } = createTemporaryDatabase(context);

  const output = executeMaintenanceCommand(client, [
    'template',
    'create',
    '--name',
    'Test Template',
    '--provider',
    'STATIC',
    '--message',
    'Hello',
  ]);

  assert.equal(output.entity, 'MessageTemplate');
  assert.equal(output.action, 'CREATED');
  assert.equal(output.name, 'Test Template');
  assert.equal(output.providerType, 'STATIC');
  assert.equal(output.messageCount, 1);
  assert.equal(output.enabled, true);
  assert.equal(JSON.stringify(output).includes('Hello'), false);
});

test('MessageTemplate maintenance creates RANDOM with repeated message arguments', (context) => {
  const { client } = createTemporaryDatabase(context);

  const output = executeMaintenanceCommand(client, [
    'template',
    'create',
    '--name',
    'Test Random Template',
    '--provider',
    'RANDOM',
    '--message',
    'Message A',
    '--message',
    'Message B',
  ]);

  assert.equal(output.providerType, 'RANDOM');
  assert.equal(output.messageCount, 2);
  assert.equal(JSON.stringify(output).includes('Message A'), false);
});

test('MessageTemplate maintenance lists counts without template content', (context) => {
  const { client } = createTemporaryDatabase(context);
  const created = executeMaintenanceCommand(client, [
    'template',
    'create',
    '--name',
    'Test Template',
    '--provider',
    'STATIC',
    '--message',
    'Hello',
  ]);

  const output = executeMaintenanceCommand(client, ['template', 'list']);

  assert.deepEqual(output, {
    entity: 'MessageTemplate',
    action: 'LISTED',
    templates: [
      {
        id: created.id,
        name: 'Test Template',
        providerType: 'STATIC',
        enabled: true,
        messageCount: 1,
      },
    ],
  });
  assert.equal(JSON.stringify(output).includes('Hello'), false);
});

test('MessageTemplate maintenance updates provider, messages, name, and enabled state', (context) => {
  const { client } = createTemporaryDatabase(context);
  const created = executeMaintenanceCommand(client, [
    'template',
    'create',
    '--name',
    'Test Template',
    '--provider',
    'STATIC',
    '--message',
    'Hello',
  ]);

  const output = executeMaintenanceCommand(client, [
    'template',
    'update',
    '--id',
    created.id,
    '--name',
    'Updated Template',
    '--provider',
    'RANDOM',
    '--message',
    'Message A',
    '--message',
    'Message B',
    '--enabled',
    'false',
  ]);

  assert.equal(output.action, 'UPDATED');
  assert.equal(output.name, 'Updated Template');
  assert.equal(output.providerType, 'RANDOM');
  assert.equal(output.messageCount, 2);
  assert.equal(output.enabled, false);
  assert.equal(JSON.stringify(output).includes('Message A'), false);
});

test('Schedule maintenance configures all bounded fields for an explicit Account', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = executeMaintenanceCommand(client, [
    'account',
    'create',
    '--name',
    'Test Account',
  ]);

  const output = executeMaintenanceCommand(client, [
    'schedule',
    'configure',
    '--account-id',
    account.id,
    '--start-time',
    '09:00',
    '--end-time',
    '10:00',
    '--timezone',
    'Asia/Shanghai',
    '--enabled',
    'true',
    '--max-attempts',
    '3',
    '--retry-interval-seconds',
    '60',
  ]);

  assert.equal(output.entity, 'Schedule');
  assert.equal(output.action, 'CONFIGURED');
  assert.equal(output.accountId, account.id);
  assert.equal(output.startTime, '09:00');
  assert.equal(output.endTime, '10:00');
  assert.equal(output.timezone, 'Asia/Shanghai');
  assert.equal(output.enabled, true);
  assert.equal(output.maxAttempts, 3);
  assert.equal(output.retryIntervalSeconds, 60);
});

test('Friend maintenance explicitly disables and re-enables a Friend', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = executeMaintenanceCommand(client, [
    'account',
    'create',
    '--name',
    'Test Account',
  ]);
  const friend = executeMaintenanceCommand(client, [
    'friend',
    'create',
    '--account-id',
    account.id,
    '--display-name',
    'Alice',
  ]);

  const disabled = executeMaintenanceCommand(client, [
    'friend',
    'set-enabled',
    '--id',
    friend.id,
    '--enabled',
    'false',
  ]);
  const enabled = executeMaintenanceCommand(client, [
    'friend',
    'set-enabled',
    '--id',
    friend.id,
    '--enabled',
    'true',
  ]);

  assert.equal(disabled.enabled, false);
  assert.equal(enabled.enabled, true);
});

test('maintenance commands fail clearly for unknown internal identifiers', (context) => {
  const { client } = createTemporaryDatabase(context);

  assert.throws(
    () =>
      executeMaintenanceCommand(client, [
        'account',
        'set-enabled',
        '--id',
        '00000000-0000-4000-8000-000000000000',
        '--enabled',
        'false',
      ]),
    /Account was not found/,
  );
});

test('MessageTemplate maintenance rejects invalid provider-specific content', (context) => {
  const { client } = createTemporaryDatabase(context);

  assert.throws(
    () =>
      executeMaintenanceCommand(client, [
        'template',
        'create',
        '--name',
        'Invalid Template',
        '--provider',
        'STATIC',
        '--message',
        'Message A',
        '--message',
        'Message B',
      ]),
    /exactly one message/,
  );
});

test('Schedule maintenance rejects an invalid execution window', (context) => {
  const { client } = createTemporaryDatabase(context);
  const account = executeMaintenanceCommand(client, [
    'account',
    'create',
    '--name',
    'Test Account',
  ]);

  assert.throws(
    () =>
      executeMaintenanceCommand(client, [
        'schedule',
        'configure',
        '--account-id',
        account.id,
        '--start-time',
        '10:00',
        '--end-time',
        '09:00',
      ]),
    /start time must be before end time/,
  );
});

test('maintenance commands reject missing, duplicate, and invalid boolean arguments', (context) => {
  const { client } = createTemporaryDatabase(context);

  assert.throws(() => executeMaintenanceCommand(client, ['account', 'create']), /--name/);
  assert.throws(
    () =>
      executeMaintenanceCommand(client, ['account', 'create', '--name', 'One', '--name', 'Two']),
    /exactly once/,
  );
  assert.throws(
    () =>
      executeMaintenanceCommand(client, [
        'account',
        'set-enabled',
        '--id',
        '00000000-0000-4000-8000-000000000000',
        '--enabled',
        'yes',
      ]),
    /true or false/,
  );
  assert.throws(
    () =>
      executeMaintenanceCommand(client, [
        'account',
        'create',
        '--name',
        'Test Account',
        '--unknown',
        'value',
      ]),
    /Unsupported option/,
  );
});
