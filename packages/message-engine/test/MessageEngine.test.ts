import assert from 'node:assert/strict';
import test from 'node:test';

import type { MessageTemplate } from '@sparkkeeper/shared';

import {
  MessageEngine,
  MessageEngineError,
  RandomProvider,
  StaticProvider,
  type MessageProvider,
} from '../src/index.js';
import { createTemplate } from './templateFixture.js';

test('MessageEngine dispatches STATIC templates to StaticProvider', async () => {
  const result = await new MessageEngine().build(createTemplate('STATIC', ['Hello']));
  assert.equal(result, 'Hello');
});

test('MessageEngine dispatches RANDOM templates to RandomProvider', async () => {
  const engine = new MessageEngine([new StaticProvider(), new RandomProvider(() => 0.75)]);
  const result = await engine.build(createTemplate('RANDOM', ['Message A', 'Message B']));
  assert.equal(result, 'Message B');
});

test('MessageEngine rejects a disabled template', async () => {
  await assert.rejects(
    new MessageEngine().build(createTemplate('STATIC', ['Hello'], { enabled: false })),
    (error: unknown) => {
      assert.ok(error instanceof MessageEngineError);
      assert.equal(error.code, 'TEMPLATE_DISABLED');
      return true;
    },
  );
});

test('MessageEngine rejects an unknown runtime provider instead of falling back', async () => {
  const invalidTemplate = {
    ...createTemplate('STATIC', ['Hello']),
    providerType: 'UNSUPPORTED',
  } as unknown as MessageTemplate;

  await assert.rejects(new MessageEngine().build(invalidTemplate), (error: unknown) => {
    assert.ok(error instanceof MessageEngineError);
    assert.equal(error.code, 'UNKNOWN_PROVIDER');
    return true;
  });
});

test('MessageEngine rejects a blank final message returned by a provider', async () => {
  const blankProvider: MessageProvider = {
    type: 'STATIC',
    async build() {
      return '   ';
    },
  };

  await assert.rejects(
    new MessageEngine([blankProvider]).build(createTemplate('STATIC', ['Hello'])),
    (error: unknown) => {
      assert.ok(error instanceof MessageEngineError);
      assert.equal(error.code, 'INVALID_MESSAGE');
      return true;
    },
  );
});

test('MessageEngine preserves final message whitespace', async () => {
  const result = await new MessageEngine().build(createTemplate('STATIC', [' hello ']));
  assert.equal(result, ' hello ');
});

test('MessageEngine propagates provider failures without replacing them', async () => {
  const providerFailure = new Error('Controlled provider failure.');
  const failingProvider: MessageProvider = {
    type: 'STATIC',
    async build() {
      throw providerFailure;
    },
  };

  await assert.rejects(
    new MessageEngine([failingProvider]).build(createTemplate('STATIC', ['Hello'])),
    (error: unknown) => error === providerFailure,
  );
});
