import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NotificationPolicy,
  type NotificationConfiguration,
  type NotificationEventCandidate,
} from '../src/index.js';

const enabledConfig: NotificationConfiguration = {
  enabled: true,
  provider: 'WEBHOOK',
  webhookUrl: 'https://example.invalid/webhook',
  notifyAuthExpired: true,
  notifyTaskFailed: true,
  notifyConsecutiveFailure: true,
  notifyDeliveryUnknown: true,
};

const candidate = (
  eventType: NotificationEventCandidate['eventType'],
): NotificationEventCandidate => ({
  eventType,
  severity: eventType === 'AUTH_EXPIRED' ? 'WARN' : 'ERROR',
  safeMessage: 'Safe notification summary.',
  timestamp: '2026-08-25T02:00:00.000Z',
});

test('notification policy sends only configured high-value failure events', () => {
  const policy = new NotificationPolicy();

  for (const eventType of [
    'AUTH_EXPIRED',
    'TASK_FAILED',
    'CONSECUTIVE_RUN_FAILURE',
    'DELIVERY_UNKNOWN',
  ] as const) {
    assert.equal(policy.decide(candidate(eventType), enabledConfig), 'SEND');
  }

  for (const eventType of [
    'RUN_FINISHED',
    'AUTH_CHECKING',
    'MESSAGE_BUILDING',
    'FRIEND_RESOLVING',
    'MESSAGE_SENDING',
    'VERIFYING',
  ] as const) {
    assert.equal(policy.decide(candidate(eventType), enabledConfig), 'IGNORE');
  }
  assert.equal(
    policy.decide(candidate('AUTH_EXPIRED'), { ...enabledConfig, enabled: false }),
    'IGNORE',
  );
  for (const [eventType, preference] of [
    ['AUTH_EXPIRED', 'notifyAuthExpired'],
    ['TASK_FAILED', 'notifyTaskFailed'],
    ['CONSECUTIVE_RUN_FAILURE', 'notifyConsecutiveFailure'],
    ['DELIVERY_UNKNOWN', 'notifyDeliveryUnknown'],
  ] as const) {
    assert.equal(
      policy.decide(candidate(eventType), { ...enabledConfig, [preference]: false }),
      'IGNORE',
    );
  }
});
