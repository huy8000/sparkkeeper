import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AccountRepository,
  FriendRepository,
  ContactRepository,
  MessageTemplateRepository,
  ScheduleRepository,
  DailyRunRepository,
  SendRecordRepository,
  SystemEventRepository,
  legacyFriendBindings,
  legacyScheduleImports,
  MigrationRepository,
  UnifiedRunRepository,
} from '@sparkkeeper/database';
import { parseBusinessDate } from '@sparkkeeper/shared';
import { createApiApplication } from '../src/http/ApiApplication.js';
import { createAuthenticatedTestSession, injectAuthenticated } from './authFixture.js';
import { V4SafeEventRelay } from '../src/observability/V4SafeEventRelay.js';
import { RuntimeEventHub } from '../src/realtime/RuntimeEventHub.js';

test('migration API S/R + CSRF/recent auth, explicit binding, disabled import, UNKNOWN append without resend; safe read/audit', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sparkkeeper-v49-api-'));
  let now = new Date();
  const app = createApiApplication({
    databasePath: path.join(root, 'sparkkeeper.db'),
    environment: {
      DATA_DIR: root,
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:3000',
    },
    logger: false,
    clock: () => now,
  });
  t.after(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });
  const auth = await createAuthenticatedTestSession(app),
    a = new AccountRepository(app.database).create({ name: 'Synthetic' }),
    friend = new FriendRepository(app.database).create({
      accountId: a.id,
      displayName: 'Synthetic legacy',
    }),
    contact = new ContactRepository(app.database).createWithPreferredIdentity({
      accountId: a.id,
      type: 'PERSON',
      displayName: 'Same name',
      initialIdentity: { kind: 'SEC_UID', value: 'Synthetic private identity', source: 'DOM' },
    }).contact;
  const template = new MessageTemplateRepository(app.database).create({
      name: 'Synthetic',
      providerType: 'STATIC',
      messages: ['Synthetic private message'],
    }),
    schedule = new ScheduleRepository(app.database).create({
      accountId: a.id,
      startTime: '09:00',
      endTime: '12:00',
      timezone: 'UTC',
      enabled: true,
      now,
    });
  const bindingId = randomUUID(),
    importId = randomUUID();
  app.database.orm
    .insert(legacyFriendBindings)
    .values({
      id: bindingId,
      friendId: friend.id,
      accountId: a.id,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  app.database.orm
    .insert(legacyScheduleImports)
    .values({
      id: importId,
      scheduleId: schedule.id,
      accountId: a.id,
      status: 'PENDING',
      startTime: '09:00',
      endTime: '12:00',
      timezone: 'UTC',
      maxAttempts: 2,
      retryIntervalSeconds: 60,
      legacyEnabledSnapshot: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  for (const url of [
    `/api/accounts/${a.id}/legacy-friend-bindings`,
    '/api/legacy-schedule-imports',
    '/api/system/audit-events',
    '/api/system/migration-status',
  ])
    assert.equal(
      (await app.server.inject({ url, headers: { host: app.config.canonicalAuthority } }))
        .statusCode,
      401,
    );
  const payload = {
      contactId: contact.id,
      expectedUpdatedAt: now.toISOString(),
      confirmationText: 'BIND',
    },
    url = `/api/legacy-friend-bindings/${bindingId}/bind`;
  assert.equal(
    (
      await injectAuthenticated(app, auth, {
        method: 'POST',
        url,
        payload,
        headers: { 'x-sparkkeeper-csrf': 'wrong' },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await injectAuthenticated(app, auth, {
        method: 'POST',
        url,
        payload: { ...payload, confirmationText: 'AUTO' },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await injectAuthenticated(app, auth, { method: 'POST', url, payload })).statusCode,
    200,
  );
  assert.equal(
    (await injectAuthenticated(app, auth, { method: 'POST', url, payload })).statusCode,
    409,
  );
  const converted = await injectAuthenticated(app, auth, {
    method: 'POST',
    url: `/api/legacy-schedule-imports/${importId}/convert`,
    payload: {
      name: 'Imported disabled',
      templateId: template.id,
      contactIds: [contact.id],
      expectedUpdatedAt: now.toISOString(),
      confirmationText: 'IMPORT DISABLED',
    },
  });
  assert.equal(converted.statusCode, 201, converted.body);
  assert.equal(converted.json().data.task.enabled, false);
  const run = new DailyRunRepository(app.database).createOrGet({
      accountId: a.id,
      businessDate: parseBusinessDate('2026-10-03'),
      now,
    }),
    repo = new SendRecordRepository(app.database),
    record = repo.prepare({
      dailyRunId: run.id,
      friendId: friend.id,
      businessDate: parseBusinessDate('2026-10-03'),
      messageTemplateId: template.id,
      messageText: 'Synthetic private message',
      now,
    }).record;
  repo.claimInitialAttempt(record.id, now, 2);
  repo.markSendActionStarted(record.id, now);
  repo.markDeliveryUnknown(record.id, now);
  new SystemEventRepository(app.database).create({
    runId: run.id,
    accountId: a.id,
    eventType: 'DELIVERY_UNKNOWN',
    level: 'WARN',
    message: 'Synthetic private message',
    errorCode: 'Synthetic private identity',
  });
  const body = {
      resolution: 'INCONCLUSIVE',
      note: 'Synthetic private note',
      expectedLatestResolutionId: null,
      confirmationText: 'RESOLVE WITHOUT RESEND',
    },
    resolutionUrl = `/api/send-records/${record.id}/resolutions`;
  const resolved = await injectAuthenticated(app, auth, {
    method: 'POST',
    url: resolutionUrl,
    payload: body,
  });
  assert.equal(resolved.statusCode, 201, resolved.body);
  assert.equal(resolved.json().data.note, 'Synthetic private note');
  assert.equal(new UnifiedRunRepository(app.database).record(record.id).status, 'DELIVERY_UNKNOWN');
  assert.equal(
    (await injectAuthenticated(app, auth, { method: 'POST', url: resolutionUrl, payload: body }))
      .statusCode,
    409,
  );
  for (const url of [
    '/api/runs',
    `/api/runs/${run.id}/send-records`,
    `/api/runs/${run.id}/events`,
    '/api/system/audit-events',
  ]) {
    const read = await injectAuthenticated(app, auth, { url });
    assert.equal(read.statusCode, 200, read.body);
    assert.doesNotMatch(
      read.body,
      /Synthetic private|messageText|identityValue|correlationDigest|profilePath/,
    );
  }
  assert.equal(
    (
      await injectAuthenticated(app, auth, {
        method: 'POST',
        url: '/api/accounts',
        payload: { name: 'Must remain closed' },
      })
    ).statusCode,
    404,
  );
  now = new Date(now.getTime() + 300001);
  assert.equal(
    (
      await injectAuthenticated(app, auth, {
        method: 'POST',
        url: resolutionUrl,
        payload: { ...body, expectedLatestResolutionId: resolved.json().data.id },
      })
    ).json().error.code,
    'REAUTH_REQUIRED',
  );
  assert.equal(new MigrationRepository(app.database).status().automaticTaskEnable, false);
});
test('safe event relay skips history, emits fixed payloads, advances independently of failing observer, no durable replay', () => {
  const hub = new RuntimeEventHub(),
    received: unknown[] = [],
    notifications: unknown[] = [];
  hub.subscribe((e) => received.push(e));
  let rows: Array<{
    sequence: number;
    runId: string;
    accountId: string;
    recordId: null;
    eventType: 'DELIVERY_UNKNOWN';
    createdAt: Date;
  }> = [];
  const source = {
    highWater: () => 10,
    after: (sequence: number) => rows.filter((r) => r.sequence > sequence),
  };
  const relay = new V4SafeEventRelay(source, hub, {
    publish: (n) => {
      notifications.push(n);
      throw new Error('Fixture failure');
    },
  });
  rows = [
    {
      sequence: 9,
      runId: randomUUID(),
      accountId: randomUUID(),
      recordId: null,
      eventType: 'DELIVERY_UNKNOWN',
      createdAt: new Date(),
    },
    {
      sequence: 11,
      runId: randomUUID(),
      accountId: randomUUID(),
      recordId: null,
      eventType: 'DELIVERY_UNKNOWN',
      createdAt: new Date(),
    },
  ];
  relay.poll();
  relay.poll();
  assert.equal(received.length, 1);
  assert.equal(notifications.length, 1);
  assert.doesNotMatch(JSON.stringify(received), /messageText|identity|profilePath|note|token/);
  hub.publish({
    type: 'RUNTIME_EVENT',
    data: {
      eventType: 'DELIVERY_UNKNOWN',
      level: 'warn',
      message: 'Synthetic private body',
      errorCode: 'Synthetic private identity',
    },
  });
  assert.doesNotMatch(JSON.stringify(received), /Synthetic private/);
});
