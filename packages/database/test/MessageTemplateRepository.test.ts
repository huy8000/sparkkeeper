import assert from 'node:assert/strict';
import test from 'node:test';

import BetterSqlite3 from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import {
  createDatabase,
  MessageTemplateDataError,
  MessageTemplateRepository,
  MessageTemplateRepositoryError,
  messageTemplates,
  type MessageProviderType,
} from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

test('creates a STATIC template with UUID, defaults, and UTC millisecond timestamps', (context) => {
  const { client } = createTemporaryDatabase(context);
  const template = new MessageTemplateRepository(client).create({
    name: ' Static Test Template ',
    providerType: 'STATIC',
    messages: ['Hello'],
  });

  assert.match(
    template.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(template.name, 'Static Test Template');
  assert.equal(template.providerType, 'STATIC');
  assert.deepEqual(template.messages, ['Hello']);
  assert.equal(template.enabled, true);
  assert.ok(template.createdAt instanceof Date);
  assert.ok(template.updatedAt instanceof Date);
  assert.equal(template.createdAt.getTime(), template.updatedAt.getTime());
});

test('creates a RANDOM template with multiple messages', (context) => {
  const { client } = createTemporaryDatabase(context);
  const template = new MessageTemplateRepository(client).create({
    name: 'Random Test Template',
    providerType: 'RANDOM',
    messages: ['Hello', 'Good morning', 'Test message'],
  });

  assert.equal(template.providerType, 'RANDOM');
  assert.deepEqual(template.messages, ['Hello', 'Good morning', 'Test message']);
});

test('persists content as a JSON string array without changing message text', (context) => {
  const { client } = createTemporaryDatabase(context);
  const template = new MessageTemplateRepository(client).create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: [' hello '],
  });
  const row = client.orm
    .select({ content: messageTemplates.content })
    .from(messageTemplates)
    .where(eq(messageTemplates.id, template.id))
    .get();

  assert.equal(row?.content, '[" hello "]');
  assert.deepEqual(template.messages, [' hello ']);
});

test('findById returns the persisted template', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  const created = repository.create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });

  assert.deepEqual(repository.findById(created.id), created);
});

test('findById returns undefined for an unknown template id', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.equal(new MessageTemplateRepository(client).findById('missing-template-id'), undefined);
});

test('list returns all persisted templates', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  repository.create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  repository.create({
    name: 'Random Test Template',
    providerType: 'RANDOM',
    messages: ['Message A', 'Message B'],
  });

  assert.deepEqual(
    new Set(repository.list().map((template) => template.name)),
    new Set(['Static Test Template', 'Random Test Template']),
  );
});

test('listEnabled excludes disabled templates', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  repository.create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  repository.create({
    name: 'Random Test Template',
    providerType: 'RANDOM',
    messages: ['Message A', 'Message B'],
    enabled: false,
  });

  assert.deepEqual(
    repository.listEnabled().map((template) => template.name),
    ['Static Test Template'],
  );
});

test('update changes a STATIC template name and message', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  const created = repository.create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  const updated = repository.update(created.id, {
    name: ' Updated Static Template ',
    messages: ['Test message'],
  });

  assert.equal(updated?.name, 'Updated Static Template');
  assert.equal(updated?.providerType, 'STATIC');
  assert.deepEqual(updated?.messages, ['Test message']);
  assert.ok((updated?.updatedAt.getTime() ?? 0) >= created.updatedAt.getTime());
});

test('update changes a template to RANDOM with fully validated messages', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  const created = repository.create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  const updated = repository.update(created.id, {
    providerType: 'RANDOM',
    messages: ['Message A', 'Message B'],
  });

  assert.equal(updated?.providerType, 'RANDOM');
  assert.deepEqual(updated?.messages, ['Message A', 'Message B']);
});

test('update can disable a template without changing content', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  const created = repository.create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  const updated = repository.update(created.id, { enabled: false });

  assert.equal(updated?.enabled, false);
  assert.equal(updated?.providerType, 'STATIC');
  assert.deepEqual(updated?.messages, ['Hello']);
});

test('update rejects an invalid provider/messages combination', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  const created = repository.create({
    name: 'Random Test Template',
    providerType: 'RANDOM',
    messages: ['Message A', 'Message B'],
  });

  assert.throws(
    () => repository.update(created.id, { providerType: 'STATIC' }),
    MessageTemplateRepositoryError,
  );
});

test('update returns undefined for an unknown template id', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.equal(
    new MessageTemplateRepository(client).update('missing-template-id', { enabled: false }),
    undefined,
  );
});

test('update rejects an empty patch', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  const created = repository.create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });

  assert.throws(() => repository.update(created.id, {}), MessageTemplateRepositoryError);
});

test('duplicate template names are allowed', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  repository.create({
    name: 'Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  repository.create({
    name: 'Test Template',
    providerType: 'RANDOM',
    messages: ['Message A', 'Message B'],
  });

  assert.equal(repository.list().length, 2);
});

test('create rejects STATIC templates with more than one message', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.throws(
    () =>
      new MessageTemplateRepository(client).create({
        name: 'Static Test Template',
        providerType: 'STATIC',
        messages: ['Message A', 'Message B'],
      }),
    MessageTemplateRepositoryError,
  );
});

test('create rejects RANDOM templates with empty or blank messages', (context) => {
  const { client } = createTemporaryDatabase(context);
  const repository = new MessageTemplateRepository(client);
  assert.throws(
    () =>
      repository.create({
        name: 'Random Test Template',
        providerType: 'RANDOM',
        messages: [],
      }),
    MessageTemplateRepositoryError,
  );
  assert.throws(
    () =>
      repository.create({
        name: 'Random Test Template',
        providerType: 'RANDOM',
        messages: ['Hello', '   '],
      }),
    MessageTemplateRepositoryError,
  );
});

test('create rejects a blank template name', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.throws(
    () =>
      new MessageTemplateRepository(client).create({
        name: '   ',
        providerType: 'STATIC',
        messages: ['Hello'],
      }),
    MessageTemplateRepositoryError,
  );
});

test('create rejects an unsupported runtime provider type', (context) => {
  const { client } = createTemporaryDatabase(context);
  assert.throws(
    () =>
      new MessageTemplateRepository(client).create({
        name: 'Test Template',
        providerType: 'UNSUPPORTED' as MessageProviderType,
        messages: ['Hello'],
      }),
    MessageTemplateRepositoryError,
  );
});

test('malformed content JSON fails with MessageTemplateDataError', (context) => {
  const temporary = createTemporaryDatabase(context);
  const created = new MessageTemplateRepository(temporary.client).create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  temporary.client.close();
  updateStoredTemplate(temporary.databasePath, created.id, 'content', '{not-json');

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  assert.throws(
    () => new MessageTemplateRepository(reopened).findById(created.id),
    MessageTemplateDataError,
  );
  reopened.close();
});

test('valid JSON with invalid template content fails safely on read', (context) => {
  const temporary = createTemporaryDatabase(context);
  const created = new MessageTemplateRepository(temporary.client).create({
    name: 'Random Test Template',
    providerType: 'RANDOM',
    messages: ['Hello'],
  });
  temporary.client.close();
  updateStoredTemplate(temporary.databasePath, created.id, 'content', '["Hello",42]');

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  assert.throws(
    () => new MessageTemplateRepository(reopened).findById(created.id),
    MessageTemplateDataError,
  );
  reopened.close();
});

test('unsupported stored provider data fails instead of falling back', (context) => {
  const temporary = createTemporaryDatabase(context);
  const created = new MessageTemplateRepository(temporary.client).create({
    name: 'Static Test Template',
    providerType: 'STATIC',
    messages: ['Hello'],
  });
  temporary.client.close();
  updateStoredTemplate(temporary.databasePath, created.id, 'provider_type', 'UNSUPPORTED', true);

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  assert.throws(
    () => new MessageTemplateRepository(reopened).findById(created.id),
    MessageTemplateDataError,
  );
  reopened.close();
});

test('template persists after close, reopen, and repeated migration', (context) => {
  const temporary = createTemporaryDatabase(context);
  const created = new MessageTemplateRepository(temporary.client).create({
    name: 'Random Test Template',
    providerType: 'RANDOM',
    messages: ['Message A', 'Message B'],
    enabled: false,
  });
  temporary.client.close();

  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  const migration = reopened.migrate();
  const persisted = new MessageTemplateRepository(reopened).findById(created.id);

  assert.equal(migration.appliedMigrationCount, 5);
  assert.equal(persisted?.name, 'Random Test Template');
  assert.equal(persisted?.providerType, 'RANDOM');
  assert.deepEqual(persisted?.messages, ['Message A', 'Message B']);
  assert.equal(persisted?.enabled, false);
  reopened.close();
});

function updateStoredTemplate(
  databasePath: string,
  id: string,
  column: 'content' | 'provider_type',
  value: string,
  ignoreCheckConstraints = false,
): void {
  const sqlite = new BetterSqlite3(databasePath);
  try {
    if (ignoreCheckConstraints) {
      sqlite.pragma('ignore_check_constraints = ON');
    }
    sqlite.prepare(`update message_templates set ${column} = ? where id = ?`).run(value, id);
  } finally {
    sqlite.close();
  }
}
