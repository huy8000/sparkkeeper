import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBusinessDate, parseScheduleTime } from '@sparkkeeper/shared';

import { RetryPolicy } from '../src/application/retry/RetryPolicy.js';
import { classifyFailure } from '../src/application/retry/FailureClassifier.js';

const baseInput = {
  externalActionState: 'NOT_STARTED' as const,
  maxAttempts: 3,
  retryIntervalSeconds: 60,
  now: new Date('2026-08-23T12:00:00.000Z'),
  businessDate: parseBusinessDate('2026-08-23'),
  timezone: 'Asia/Shanghai',
  startTime: parseScheduleTime('19:30'),
  endTime: parseScheduleTime('21:00'),
};

test('retryable first Attempt schedules the fixed retry inside the same window', () => {
  const decision = new RetryPolicy().decide({
    ...baseInput,
    failureCode: 'NETWORK_TRANSIENT',
    attemptCount: 1,
  });

  assert.equal(decision.type, 'RETRY_SCHEDULED');
  if (decision.type === 'RETRY_SCHEDULED') {
    assert.equal(decision.nextRetryAt.toISOString(), '2026-08-23T12:01:00.000Z');
    assert.equal(decision.failureCode, 'NETWORK_TRANSIENT');
  }
});

test('the final allowed Attempt becomes MAX_ATTEMPTS_EXHAUSTED instead of Attempt 4', () => {
  const decision = new RetryPolicy().decide({
    ...baseInput,
    failureCode: 'PAGE_LOAD_TIMEOUT',
    attemptCount: 3,
  });

  assert.equal(decision.type, 'FINAL_FAILED');
  assert.equal(decision.failureCode, 'MAX_ATTEMPTS_EXHAUSTED');
  assert.equal(decision.causeCode, 'PAGE_LOAD_TIMEOUT');
});

test('a fixed retry crossing the end-exclusive window becomes RETRY_WINDOW_EXPIRED', () => {
  const decision = new RetryPolicy().decide({
    ...baseInput,
    failureCode: 'NETWORK_TRANSIENT',
    attemptCount: 1,
    now: new Date('2026-08-23T12:59:30.000Z'),
  });

  assert.equal(decision.type, 'FINAL_FAILED');
  assert.equal(decision.failureCode, 'RETRY_WINDOW_EXPIRED');
  assert.equal(decision.causeCode, 'NETWORK_TRANSIENT');
});

test('FailureClassifier allows only explicit pre-boundary transient codes to retry', () => {
  for (const code of [
    'NETWORK_TRANSIENT',
    'PAGE_LOAD_TIMEOUT',
    'CONTACT_LIST_NOT_READY',
    'BROWSER_TRANSIENT',
    'SEND_ACTION_FAILED',
    'PROCESS_INTERRUPTED_BEFORE_SEND',
  ] as const) {
    assert.equal(classifyFailure(code, 'NOT_TRIGGERED').retryable, true, code);
  }

  for (const code of [
    'CONTACT_NOT_FOUND',
    'AMBIGUOUS_CONTACT',
    'AUTH_EXPIRED',
    'AUTH_UNKNOWN',
    'SELECTOR_FAILURE',
    'CONVERSATION_VERIFICATION_FAILED',
    'MESSAGE_INPUT_FAILED',
    'VERIFY_FAILED',
    'DELIVERY_UNKNOWN',
  ] as const) {
    assert.equal(classifyFailure(code, 'NOT_STARTED').retryable, false, code);
  }
});

test('delivery uncertainty and auth expiry produce dedicated stop decisions', () => {
  const policy = new RetryPolicy();
  const uncertain = policy.decide({
    ...baseInput,
    failureCode: 'SEND_ACTION_FAILED',
    externalActionState: 'UNCERTAIN',
    attemptCount: 1,
  });
  assert.equal(uncertain.type, 'DELIVERY_UNKNOWN');
  assert.equal(uncertain.failureCode, 'DELIVERY_UNKNOWN');

  const authExpired = policy.decide({
    ...baseInput,
    failureCode: 'AUTH_EXPIRED',
    attemptCount: 1,
  });
  assert.equal(authExpired.type, 'STOP_AUTH_EXPIRED');
  assert.equal(authExpired.failureCode, 'AUTH_EXPIRED');
});

test('RetryPolicy rejects invalid Attempt and fixed-interval configuration', () => {
  const policy = new RetryPolicy();
  for (const overrides of [
    { attemptCount: -1 },
    { attemptCount: 1, maxAttempts: 0 },
    { attemptCount: 1, maxAttempts: 6 },
    { attemptCount: 1, retryIntervalSeconds: 0 },
    { attemptCount: 1, retryIntervalSeconds: 86_401 },
  ]) {
    assert.throws(() =>
      policy.decide({
        ...baseInput,
        failureCode: 'NETWORK_TRANSIENT',
        attemptCount: 1,
        ...overrides,
      }),
    );
  }
});

for (const failureCode of [
  'PAGE_LOAD_TIMEOUT',
  'CONTACT_LIST_NOT_READY',
  'BROWSER_TRANSIENT',
  'SEND_ACTION_FAILED',
  'PROCESS_INTERRUPTED_BEFORE_SEND',
] as const) {
  test(`RetryPolicy schedules explicit pre-boundary ${failureCode}`, () => {
    assert.equal(
      new RetryPolicy().decide({
        ...baseInput,
        failureCode,
        attemptCount: 1,
      }).type,
      'RETRY_SCHEDULED',
    );
  });
}

for (const failureCode of [
  'CONTACT_NOT_FOUND',
  'AMBIGUOUS_CONTACT',
  'AUTH_UNKNOWN',
  'SELECTOR_FAILURE',
  'CONVERSATION_VERIFICATION_FAILED',
  'MESSAGE_INPUT_FAILED',
  'TEMPLATE_INVALID',
  'CONFIG_INVALID',
] as const) {
  test(`RetryPolicy makes ${failureCode} final without retry`, () => {
    const decision = new RetryPolicy().decide({
      ...baseInput,
      failureCode,
      attemptCount: 1,
    });
    assert.equal(decision.type, 'FINAL_FAILED');
    assert.equal(decision.failureCode, failureCode);
  });
}

test('Attempt 2 of 3 may schedule the final bounded retry', () => {
  const decision = new RetryPolicy().decide({
    ...baseInput,
    failureCode: 'NETWORK_TRANSIENT',
    attemptCount: 2,
  });
  assert.equal(decision.type, 'RETRY_SCHEDULED');
});

test('post-send VERIFY_FAILED is delivery uncertainty rather than retry eligibility', () => {
  const decision = new RetryPolicy().decide({
    ...baseInput,
    failureCode: 'VERIFY_FAILED',
    externalActionState: 'UNCERTAIN',
    attemptCount: 1,
  });
  assert.equal(decision.type, 'DELIVERY_UNKNOWN');
});
