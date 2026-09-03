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
import type { RealtimeEvent } from '../src/realtime/RealtimeEvent.js';
import { createAuthenticatedTestSession, type TestAuthSession } from './authFixture.js';

const API_HOST = '127.0.0.1:8080';
const ADMIN_ORIGIN = 'http://127.0.0.1:8080';
const WEBHOOK_URL = 'https://example.invalid/webhook';

test('notification configuration API persists validated local Admin configuration', async (context) => {
  const fixture = await createFixture(context);
  const events: RealtimeEvent[] = [];
  fixture.application.realtime.subscribe((event) => events.push(event));

  const initial = await fixture.application.server.inject({
    method: 'GET',
    url: '/api/notification-config',
    headers: { cookie: fixture.session.cookieHeader },
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

  const updated = await mutate(
    fixture.application,
    fixture.session,
    'PUT',
    '/api/notification-config',
    {
      enabled: true,
      provider: 'WEBHOOK',
      webhookUrl: `  ${WEBHOOK_URL}  `,
      notifyAuthExpired: true,
      notifyTaskFailed: false,
      notifyConsecutiveFailure: true,
      notifyDeliveryUnknown: true,
    },
  );
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
  const fixture = await createFixture(context);
  const invalid = await mutate(
    fixture.application,
    fixture.session,
    'PUT',
    '/api/notification-config',
    {
      enabled: true,
      provider: 'WEBHOOK',
      webhookUrl: 'not-a-webhook-url',
      notifyAuthExpired: true,
      notifyTaskFailed: true,
      notifyConsecutiveFailure: true,
      notifyDeliveryUnknown: true,
    },
  );
  assertError(invalid, 400, 'VALIDATION_ERROR');

  const blocked = await mutate(
    fixture.application,
    fixture.session,
    'PUT',
    '/api/notification-config',
    {
      enabled: true,
      provider: 'WEBHOOK',
      webhookUrl: 'http://blocked.example/hook',
      notifyAuthExpired: true,
      notifyTaskFailed: true,
      notifyConsecutiveFailure: true,
      notifyDeliveryUnknown: true,
    },
  );
  assertError(blocked, 400, 'WEBHOOK_DESTINATION_BLOCKED');

  const arbitrary = await mutate(
    fixture.application,
    fixture.session,
    'POST',
    '/api/notification-config/test',
    {
      text: 'PRIVATE_ARBITRARY_NOTIFICATION',
    },
  );
  assertError(arbitrary, 400, 'VALIDATION_ERROR');
  assert.equal(fixture.payloads.length, 0);
});

test('fixed test notification uses saved destination and server-generated content only', async (context) => {
  const fixture = await createFixture(context);
  await mutate(fixture.application, fixture.session, 'PUT', '/api/notification-config', {
    enabled: false,
    provider: 'WEBHOOK',
    webhookUrl: WEBHOOK_URL,
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  });

  const response = await mutate(
    fixture.application,
    fixture.session,
    'POST',
    '/api/notification-config/test',
    {},
  );
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
  const fixture = await createFixture(context);
  const body = {
    enabled: false,
    provider: 'WEBHOOK',
    webhookUrl: null,
    notifyAuthExpired: true,
    notifyTaskFailed: true,
    notifyConsecutiveFailure: true,
    notifyDeliveryUnknown: true,
  };
  const missingCsrf = await fixture.application.server.inject({
    method: 'PUT',
    url: '/api/notification-config',
    headers: {
      cookie: fixture.session.cookieHeader,
      host: API_HOST,
      origin: ADMIN_ORIGIN,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    payload: body,
  });
  assertError(missingCsrf, 403, 'CSRF_REJECTED');

  const wrongType = await fixture.application.server.inject({
    method: 'PUT',
    url: '/api/notification-config',
    headers: {
      cookie: fixture.session.cookieHeader,
      host: API_HOST,
      origin: ADMIN_ORIGIN,
      'sec-fetch-site': 'same-origin',
      'x-sparkkeeper-csrf': fixture.session.csrfToken,
      'content-type': 'text/plain',
    },
    payload: 'disabled=true',
  });
  assertError(wrongType, 400, 'VALIDATION_ERROR');

  const crossOrigin = await fixture.application.server.inject({
    method: 'PUT',
    url: '/api/notification-config',
    headers: mutationHeaders(fixture.session, { origin: 'https://example.test' }),
    payload: body,
  });
  assertError(crossOrigin, 403, 'ORIGIN_REJECTED');
  assert.equal(crossOrigin.headers['access-control-allow-origin'], undefined);
});

test('API shutdown drains bounded notification work before closing the database', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-notification-close-test-'));
  let resolveDelivery: (() => void) | undefined;
  let deliveryStarted = false;
  const application = createApiApplication({
    cwd: root,
    databasePath: path.join(root, 'fixture.db'),
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    },
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
  readonly session: TestAuthSession;
  readonly validatedUrls: string[];
  readonly payloads: NotificationPayload[];
  readonly urls: string[];
}

async function createFixture(context: TestContext): Promise<Fixture> {
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
    environment: {
      SPARKKEEPER_ADMIN_SECURITY_MODE: 'development',
      SPARKKEEPER_ADMIN_CANONICAL_ORIGIN: 'http://127.0.0.1:8080',
    },
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
  const session = await createAuthenticatedTestSession(application);
  return { application, session, validatedUrls, payloads, urls };
}

function mutate(
  application: ApiApplication,
  session: TestAuthSession,
  method: 'POST' | 'PUT',
  url: string,
  payload: object,
) {
  return application.server.inject({ method, url, headers: mutationHeaders(session), payload });
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

function assertError(
  response: { readonly statusCode: number; json(): unknown },
  statusCode: number,
  code: string,
): void {
  assert.equal(response.statusCode, statusCode);
  const payload = response.json() as { readonly error: { readonly code: string } };
  assert.equal(payload.error.code, code);
}
