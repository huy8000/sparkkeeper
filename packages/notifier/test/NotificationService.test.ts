import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NotificationService,
  type NotificationConfiguration,
  type NotificationDeliveryResult,
  type NotificationPayload,
  type NotificationProvider,
} from '../src/index.js';

const configuration: NotificationConfiguration = {
  enabled: true,
  provider: 'WEBHOOK',
  webhookUrl: 'https://example.invalid/webhook',
  notifyAuthExpired: true,
  notifyTaskFailed: true,
  notifyConsecutiveFailure: true,
  notifyDeliveryUnknown: true,
};

test('notification service schedules one non-critical delivery for a configured candidate', async () => {
  const delivered: NotificationPayload[] = [];
  const provider: NotificationProvider = {
    send: async (payload) => {
      delivered.push(payload);
      return { status: 'SENT', attempts: 1, httpStatus: 204 };
    },
  };
  const service = new NotificationService({
    configuration: { get: () => configuration },
    provider,
  });

  assert.doesNotThrow(() =>
    service.publish({
      eventType: 'AUTH_EXPIRED',
      severity: 'WARN',
      safeMessage: 'Authentication expired',
      timestamp: '2026-08-25T02:40:00.000Z',
    }),
  );
  service.publish({
    eventType: 'AUTH_CHECKING',
    severity: 'WARN',
    safeMessage: 'Authentication is being checked',
    timestamp: '2026-08-25T02:40:01.000Z',
  });
  await service.stop();

  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.eventType, 'AUTH_EXPIRED');
  assert.deepEqual(service.status().lastDelivery, {
    eventType: 'AUTH_EXPIRED',
    result: { status: 'SENT', attempts: 1, httpStatus: 204 },
    timestamp: '2026-08-25T02:40:00.000Z',
  });
});

test('notification service contains provider exceptions and drains active delivery on shutdown', async () => {
  let resolveDelivery: ((result: NotificationDeliveryResult) => void) | undefined;
  const pending = new Promise<NotificationDeliveryResult>((resolve) => {
    resolveDelivery = resolve;
  });
  let calls = 0;
  const service = new NotificationService({
    configuration: { get: () => configuration },
    provider: {
      send: async () => {
        calls += 1;
        if (calls === 1) return pending;
        throw new Error('PRIVATE_PROVIDER_EXCEPTION');
      },
    },
  });
  const candidate = {
    eventType: 'TASK_FAILED' as const,
    severity: 'ERROR' as const,
    safeMessage: 'Task finished with failure',
    timestamp: '2026-08-25T02:41:00.000Z',
  };

  service.publish(candidate);
  const stopping = service.stop();
  service.publish(candidate);
  assert.equal(calls, 1);
  resolveDelivery?.({ status: 'FAILED', attempts: 3, failureCode: 'TIMEOUT' });
  await stopping;
  assert.equal(calls, 1);

  const failingService = new NotificationService({
    configuration: { get: () => configuration },
    provider: { send: async () => Promise.reject(new Error('PRIVATE_PROVIDER_EXCEPTION')) },
  });
  assert.doesNotThrow(() => failingService.publish(candidate));
  await failingService.stop();
  assert.deepEqual(failingService.status().lastDelivery?.result, {
    status: 'FAILED',
    attempts: 1,
    failureCode: 'NETWORK_ERROR',
  });
});

test('test notification uses a server-generated fixed payload and saved destination only', async () => {
  const calls: Array<{ payload: NotificationPayload; url: string }> = [];
  const service = new NotificationService({
    configuration: { get: () => ({ ...configuration, enabled: false }) },
    provider: {
      send: async (payload, url) => {
        calls.push({ payload, url });
        return { status: 'SENT', attempts: 1, httpStatus: 200 };
      },
    },
    clock: () => new Date('2026-08-25T02:42:00.000Z'),
  });

  const result = await service.sendTest();

  assert.equal(result.status, 'SENT');
  assert.deepEqual(calls, [
    {
      url: 'https://example.invalid/webhook',
      payload: {
        serviceName: 'SparkKeeper',
        eventType: 'NOTIFICATION_TEST',
        severity: 'WARN',
        message: 'SparkKeeper notification test',
        timestamp: '2026-08-25T02:42:00.000Z',
      },
    },
  ]);
  await service.stop();
});
