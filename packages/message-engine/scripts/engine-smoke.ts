import assert from 'node:assert/strict';

import type { MessageTemplate } from '@sparkkeeper/shared';

import { MessageEngine, RandomProvider, StaticProvider } from '../src/index.js';

const timestamp = new Date('2026-01-01T00:00:00.000Z');
const staticTemplate: MessageTemplate = {
  id: 'static-test-template',
  name: 'Static Test Template',
  providerType: 'STATIC',
  messages: ['Hello'],
  enabled: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const randomTemplate: MessageTemplate = {
  id: 'random-test-template',
  name: 'Random Test Template',
  providerType: 'RANDOM',
  messages: ['Message A', 'Message B'],
  enabled: true,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const engine = new MessageEngine([new StaticProvider(), new RandomProvider(() => 0.75)]);

assert.equal(await engine.build(staticTemplate), 'Hello');
assert.equal(await engine.build(randomTemplate), 'Message B');

console.log(
  JSON.stringify({
    staticTemplate: 'VERIFIED',
    randomTemplate: 'VERIFIED',
    messageEngine: 'VERIFIED',
    networkAccess: 'NONE',
  }),
);
