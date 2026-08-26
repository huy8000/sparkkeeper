import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PublicDestinationPolicy,
  WebhookDestinationError,
  type HostAddressResolver,
} from '../src/index.js';

const answers: Record<string, readonly { address: string; family: 4 | 6 }[]> = {
  'public.example': [{ address: '93.184.216.34', family: 4 }],
  'mixed.example': [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.8', family: 4 },
  ],
  'private.example': [{ address: '192.168.1.8', family: 4 }],
  'ipv6.example': [{ address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }],
};

const resolver: HostAddressResolver = {
  lookup: async (hostname) => answers[hostname] ?? [],
};

test('public destination policy allows only credential-free HTTP(S) destinations with public DNS answers', async () => {
  const policy = new PublicDestinationPolicy(resolver);

  const destination = await policy.resolve('https://public.example/webhook');
  assert.equal(destination.url.href, 'https://public.example/webhook');
  assert.deepEqual(destination.addresses, [{ address: '93.184.216.34', family: 4 }]);

  const ipv6 = await policy.resolve('https://ipv6.example/hook');
  assert.equal(ipv6.addresses[0]?.family, 6);
});

test('public destination policy blocks private, local, ambiguous, and unsupported destinations', async () => {
  const policy = new PublicDestinationPolicy(resolver);
  const blocked = [
    'http://localhost/hook',
    'http://service.localhost/hook',
    'http://127.0.0.1/hook',
    'http://127.42.0.1/hook',
    'http://2130706433/hook',
    'http://0x7f000001/hook',
    'http://0177.0.0.1/hook',
    'http://127.1/hook',
    'http://0.0.0.0/hook',
    'http://10.0.0.1/hook',
    'http://172.16.0.1/hook',
    'http://192.168.0.1/hook',
    'http://169.254.169.254/latest',
    'http://100.64.0.1/hook',
    'http://198.18.0.1/hook',
    'http://192.0.2.1/hook',
    'http://198.51.100.1/hook',
    'http://203.0.113.1/hook',
    'http://224.0.0.1/hook',
    'http://[::1]/hook',
    'http://[::]/hook',
    'http://[fc00::1]/hook',
    'http://[fe80::1]/hook',
    'http://[2001:db8::1]/hook',
    'http://[::ffff:127.0.0.1]/hook',
    'http://[::ffff:7f00:1]/hook',
    'http://user:password@public.example/hook',
    'file:///tmp/hook',
    'ftp://public.example/hook',
    'javascript:alert(1)',
    'https://private.example/hook',
    'https://mixed.example/hook',
  ];

  for (const url of blocked) {
    await assert.rejects(
      policy.resolve(url),
      (error: unknown) =>
        error instanceof WebhookDestinationError && error.code === 'DESTINATION_BLOCKED',
      url,
    );
  }
});

test('public destination policy bounds DNS resolution time', async () => {
  const neverResolving: HostAddressResolver = {
    lookup: () => new Promise(() => undefined),
  };
  const policy = new PublicDestinationPolicy(neverResolving, 10);

  await assert.rejects(
    policy.resolve('https://public.example/webhook'),
    (error: unknown) =>
      error instanceof WebhookDestinationError && error.code === 'DESTINATION_BLOCKED',
  );
});
