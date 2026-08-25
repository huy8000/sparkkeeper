import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { NotificationConfigRepository } from '@sparkkeeper/database';
import {
  WebhookDestinationError,
  type NotificationPayload,
  type NotificationProvider,
  type ValidatedWebhookDestination,
} from '@sparkkeeper/notifier';

import { createApiApplication, type ApiApplication } from '../src/http/ApiApplication.js';
import {
  ADMIN_MUTATION_HEADER,
  ADMIN_MUTATION_HEADER_VALUE,
} from '../src/http/plugins/MutationGuard.js';
import type { RealtimeEvent } from '../src/realtime/RealtimeEvent.js';

const API_HOST = '127.0.0.1:8080';
const ADMIN_ORIGIN = 'http://127.0.0.1:5173';
const WEBHOOK_URL = 'https://example.invalid/webhook';

test('notification configuration API persists validated local Admin configuration', async (context) => {
  const fixture = createFixture(context);
  const events: RealtimeEvent[] = [];
  fixture.application.realtime.subscribe((event) => events.push(event));

  const initial = await fixture.application.server.inject({
    method: 'GET',
    url: '/api/notification-config',
  });
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.json().data, {
    enabled: false,
    provider: 'WEBHOOK',
    webhookUrl: null,
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
    createdAt: null,
    updatedAt: null,
  });

  const updated = await mutate(fixture.application, 'PUT', '/api/notification-config', {
    enabled: true,
    provider: 'WEBHOOK',
    webhookUrl: `  ${WEBHOOK_URL}  `,
    notifyAuthExpired: true,
    notifyTaskFailed: false,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().data.webhookUrl, WEBHOOK_URL);
  assert.equal(updated.json().data.notifyTaskFailed, false);
  assert.equal(fixture.validatedUrls.at(-1), WEBHOOK_URL);
  assert.equal(
    events.some(
      (event) => event.type === 'CONFIG_CHANGED' && event.data.entityType === 'NOTIFICATION',
    ),
    true,
  );
});

test('notification configuration API rejects unsafe destinations and arbitrary test bodies', async (context) => {
  const fixture = createFixture(context);
  const invalid = await mutate(fixture.application, 'PUT', '/api/notification-config', {
    enabled: true,
    provider: 'WEBHOOK',
    webhookUrl: 'not-a-webhook-url',
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  });
  assertError(invalid, 400, 'VALIDATION_ERROR');

  const blocked = await mutate(fixture.application, 'PUT', '/api/notification-config', {
    enabled: true,
    provider: 'WEBHOOK',
    webhookUrl: 'http://blocked.example/hook',
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  });
  assertError(blocked, 400, 'WEBHOOK_DESTINATION_BLOCKED');

  const arbitrary = await mutate(fixture.application, 'POST', '/api/notification-config/test', {
    text: 'PRIVATE_ARBITRARY_NOTIFICATION',
  });
  assertError(arbitrary, 400, 'VALIDATION_ERROR');
  assert.equal(fixture.payloads.length, 0);
});

test('fixed test notification uses saved destination and server-generated content only', async (context) => {
  const fixture = createFixture(context);
  await mutate(fixture.application, 'PUT', '/api/notification-config', {
    enabled: false,
    provider: 'WEBHOOK',
    webhookUrl: WEBHOOK_URL,
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  });

  const response = await mutate(fixture.application, 'POST', '/api/notification-config/test', {});
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, { status: 'SENT', attempts: 1, httpStatus: 204 });
  assert.deepEqual(fixture.payloads, [
    {
      serviceName: 'SparkKeeper',
      eventType: 'NOTIFICATION_TEST',
      severity: 'WARN',
      message: 'SparkKeeper notification test',
      timestamp: '2026-08-25T03:00:00.000Z',
    },
  ]);
  assert.deepEqual(fixture.urls, [WEBHOOK_URL]);
});

test('notification mutations retain the centralized local Admin guard and safe errors', async (context) => {
  const fixture = createFixture(context);
  const body = {
    enabled: false,
    provider: 'WEBHOOK',
    webhookUrl: null,
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  };
  const missingHeader = await fixture.application.server.inject({
    method: 'PUT',
    url: '/api/notification-config',
    headers: {
      host: API_HOST,
      origin: ADMIN_ORIGIN,
      'content-type': 'application/json',
    },
    payload: body,
  });
  assertError(missingHeader, 403, 'ADMIN_REQUEST_REQUIRED');

  const wrongType = await fixture.application.server.inject({
    method: 'PUT',
    url: '/api/notification-config',
    headers: {
      host: API_HOST,
      origin: ADMIN_ORIGIN,
      [ADMIN_MUTATION_HEADER]: ADMIN_MUTATION_HEADER_VALUE,
      'content-type': 'text/plain',
    },
    payload: 'disabled=true',
  });
  assertError(wrongType, 415, 'UNSUPPORTED_MEDIA_TYPE');

  const crossOrigin = await fixture.application.server.inject({
    method: 'PUT',
    url: '/api/notification-config',
    headers: mutationHeaders({ origin: 'https://example.test' }),
    payload: body,
  });
  assertError(crossOrigin, 403, 'ADMIN_REQUEST_REJECTED');
  assert.equal(crossOrigin.headers['access-control-allow-origin'], undefined);
});

test('API shutdown drains bounded notification work before closing the database', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-notification-close-test-'));
  let resolveDelivery: (() => void) | undefined;
  let deliveryStarted = false;
  const application = createApiApplication({
    cwd: root,
    databasePath: path.join(root, 'fixture.db'),
    environment: {},
    logger: false,
    notificationProvider: {
      send: async () => {
        deliveryStarted = true;
        await new Promise<void>((resolve) => {
          resolveDelivery = resolve;
        });
        return { status: 'SENT', attempts: 1, httpStatus: 204 };
      },
    },
  });
  context.after(async () => {
    resolveDelivery?.();
    await application.close();
    rmSync(root, { recursive: true, force: true });
  });
  new NotificationConfigRepository(application.database).save({
    enabled: true,
    provider: 'WEBHOOK',
    webhookUrl: WEBHOOK_URL,
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  });
  application.notifications.publish({
    eventType: 'AUTH_EXPIRED',
    severity: 'WARN',
    safeMessage: 'Authentication expired',
    timestamp: '2026-08-25T03:01:00.000Z',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(deliveryStarted, true);

  const closing = application.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(application.database.isOpen(), true);
  resolveDelivery?.();
  await closing;
  assert.equal(application.database.isOpen(), false);
});

interface Fixture {
  readonly application: ApiApplication;
  readonly validatedUrls: string[];
  readonly payloads: NotificationPayload[];
  readonly urls: string[];
}

function createFixture(context: TestContext): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-notification-api-test-'));
  const payloads: NotificationPayload[] = [];
  const urls: string[] = [];
  const validatedUrls: string[] = [];
  const provider: NotificationProvider = {
    send: async (payload, url) => {
      payloads.push(payload);
      urls.push(url);
      return { status: 'SENT', attempts: 1, httpStatus: 204 };
    },
  };
  const application = createApiApplication({
    cwd: root,
    databasePath: path.join(root, 'fixture.db'),
    environment: {},
    logger: false,
    clock: () => new Date('2026-08-25T03:00:00.000Z'),
    notificationProvider: provider,
    notificationAddressPolicy: {
      resolve: async (value): Promise<ValidatedWebhookDestination> => {
        const trimmed = value.trim();
        let url: URL;
        try {
          url = new URL(trimmed);
        } catch (error) {
          throw new WebhookDestinationError(
            'INVALID_CONFIG',
            'Webhook destination is invalid.',
            error,
          );
        }
        if (trimmed.includes('blocked.example')) {
          throw new WebhookDestinationError(
            'DESTINATION_BLOCKED',
            'Webhook destination is not permitted.',
          );
        }
        validatedUrls.push(trimmed);
        return {
          url,
          addresses: [{ address: '93.184.216.34', family: 4 }],
        };
      },
    },
  });
  context.after(async () => {
    await application.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { application, validatedUrls, payloads, urls };
}

function mutate(application: ApiApplication, method: 'POST' | 'PUT', url: string, payload: object) {
  return application.server.inject({ method, url, headers: mutationHeaders(), payload });
}

function mutationHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    host: API_HOST,
    origin: ADMIN_ORIGIN,
    'content-type': 'application/json',
    [ADMIN_MUTATION_HEADER]: ADMIN_MUTATION_HEADER_VALUE,
    ...overrides,
  };
}

function assertError(
  response: { readonly statusCode: number; json(): unknown },
  statusCode: number,
  code: string,
): void {
  assert.equal(response.statusCode, statusCode);
  const payload = response.json() as { readonly error: { readonly code: string } };
  assert.equal(payload.error.code, code);
}
