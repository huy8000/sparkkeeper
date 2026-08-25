import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabase, NotificationConfigRepository } from '../src/index.js';
import { createTemporaryDatabase } from './testDatabase.js';

test('notification configuration persists as one replaceable WEBHOOK configuration', (context) => {
  const temporary = createTemporaryDatabase(context);
  const repository = new NotificationConfigRepository(temporary.client);
  const createdAt = new Date('2026-08-25T02:30:00.000Z');

  assert.equal(repository.get(), undefined);
  const created = repository.save({
    enabled: true,
    provider: 'WEBHOOK',
    webhookUrl: 'https://example.invalid/webhook',
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: false,
    notifyDeliveryUnknown: true,
    now: createdAt,
  });
  assert.deepEqual(created, {
    enabled: true,
    provider: 'WEBHOOK',
    webhookUrl: 'https://example.invalid/webhook',
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: false,
    notifyDeliveryUnknown: true,
    createdAt,
    updatedAt: createdAt,
  });

  const updatedAt = new Date('2026-08-25T02:31:00.000Z');
  const updated = repository.save({
    ...created,
    enabled: false,
    webhookUrl: null,
    notifyConsecutiveFailure: true,
    now: updatedAt,
  });
  assert.equal(updated.enabled, false);
  assert.equal(updated.webhookUrl, null);
  assert.equal(updated.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(updated.updatedAt.toISOString(), updatedAt.toISOString());

  temporary.client.close();
  const reopened = createDatabase({ databasePath: temporary.databasePath });
  context.after(() => reopened.close());
  reopened.migrate();
  assert.deepEqual(new NotificationConfigRepository(reopened).get(), updated);
});
