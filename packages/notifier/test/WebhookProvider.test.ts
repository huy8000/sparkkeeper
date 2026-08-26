import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PublicDestinationPolicy,
  toNotificationPayload,
  WebhookProvider,
  WebhookTransportError,
  type HostAddressResolver,
  type SendableNotificationEventCandidate,
  type WebhookTransport,
  type WebhookTransportRequest,
} from '../src/index.js';

const resolver: HostAddressResolver = {
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
};

const event: SendableNotificationEventCandidate = {
  eventType: 'TASK_FAILED',
  severity: 'ERROR',
  safeMessage: 'Task finished with failure',
  timestamp: '2026-08-25T02:10:00.000Z',
  runId: '00000000-0000-4000-8000-000000000610',
  accountId: '00000000-0000-4000-8000-000000000611',
  errorCode: 'DEMO_FAILURE',
};

test('webhook provider sends a strict safe payload and reports a successful 2xx delivery', async () => {
  const requests: WebhookTransportRequest[] = [];
  const transport: WebhookTransport = {
    deliver: async (request) => {
      requests.push(request);
      return { statusCode: 204 };
    },
  };
  const provider = new WebhookProvider({
    addressPolicy: new PublicDestinationPolicy(resolver),
    transport,
    sleep: async () => undefined,
  });
  const malicious = {
    ...event,
    messageText: 'PRIVATE_MESSAGE_SENTINEL',
    contactName: 'PRIVATE_CONTACT_SENTINEL',
    token: 'PRIVATE_TOKEN_SENTINEL',
    screenshotPath: '/private/evidence.png',
    stack: 'PRIVATE_STACK_SENTINEL',
  } as SendableNotificationEventCandidate;

  const result = await provider.send(
    toNotificationPayload(malicious),
    'https://public.example/webhook',
  );

  assert.deepEqual(result, { status: 'SENT', attempts: 1, httpStatus: 204 });
  assert.deepEqual(requests[0]?.payload, {
    serviceName: 'SparkKeeper',
    eventType: 'TASK_FAILED',
    severity: 'ERROR',
    message: 'Task finished with failure',
    timestamp: '2026-08-25T02:10:00.000Z',
    runId: '00000000-0000-4000-8000-000000000610',
    accountId: '00000000-0000-4000-8000-000000000611',
    errorCode: 'DEMO_FAILURE',
  });
  assert.equal(JSON.stringify(requests[0]?.payload).includes('PRIVATE_'), false);
});

test('webhook provider retries only transient outcomes and bounds attempts', async () => {
  for (const outcome of [408, 429, 500] as const) {
    let calls = 0;
    const provider = providerWith(async () => {
      calls += 1;
      return { statusCode: calls === 1 ? outcome : 204 };
    });
    assert.equal(
      (await provider.send(toNotificationPayload(event), 'https://public.example/hook')).status,
      'SENT',
    );
    assert.equal(calls, 2);
  }

  for (const code of ['TIMEOUT', 'NETWORK_ERROR'] as const) {
    let calls = 0;
    const provider = providerWith(async () => {
      calls += 1;
      if (calls < 3) throw new WebhookTransportError(code);
      return { statusCode: 202 };
    });
    const result = await provider.send(toNotificationPayload(event), 'https://public.example/hook');
    assert.equal(result.status, 'SENT');
    assert.equal(result.attempts, 3);
  }

  let boundedCalls = 0;
  const bounded = providerWith(async () => {
    boundedCalls += 1;
    return { statusCode: 503 };
  });
  assert.deepEqual(
    await bounded.send(toNotificationPayload(event), 'https://public.example/hook'),
    {
      status: 'FAILED',
      attempts: 3,
      failureCode: 'HTTP_ERROR',
      httpStatus: 503,
    },
  );
  assert.equal(boundedCalls, 3);
});

test('webhook provider does not retry permanent HTTP errors, redirects, or blocked destinations', async () => {
  for (const statusCode of [301, 400, 401, 403, 404] as const) {
    let calls = 0;
    const result = await providerWith(async () => {
      calls += 1;
      return { statusCode };
    }).send(toNotificationPayload(event), 'https://public.example/hook');
    assert.deepEqual(result, {
      status: 'FAILED',
      attempts: 1,
      failureCode: 'HTTP_ERROR',
      httpStatus: statusCode,
    });
    assert.equal(calls, 1);
  }

  let deliveries = 0;
  const blocked = providerWith(async () => {
    deliveries += 1;
    return { statusCode: 204 };
  });
  assert.deepEqual(await blocked.send(toNotificationPayload(event), 'http://127.0.0.1/hook'), {
    status: 'BLOCKED',
    attempts: 0,
    failureCode: 'DESTINATION_BLOCKED',
  });
  assert.equal(deliveries, 0);
});

function providerWith(deliver: WebhookTransport['deliver']): WebhookProvider {
  return new WebhookProvider({
    addressPolicy: new PublicDestinationPolicy(resolver),
    transport: { deliver },
    sleep: async () => undefined,
    maxAttempts: 3,
  });
}
