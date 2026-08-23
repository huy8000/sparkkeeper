import assert from 'node:assert/strict';
import test from 'node:test';

import { MessageTemplateValidationError, StaticProvider } from '../src/index.js';
import { createTemplate } from './templateFixture.js';

test('StaticProvider builds the single configured message', async () => {
  const result = await new StaticProvider().build(createTemplate('STATIC', ['Hello']));
  assert.equal(result, 'Hello');
});

test('StaticProvider preserves the original message content', async () => {
  const result = await new StaticProvider().build(createTemplate('STATIC', [' hello ']));
  assert.equal(result, ' hello ');
});

test('StaticProvider rejects a blank message', async () => {
  await assert.rejects(
    new StaticProvider().build(createTemplate('STATIC', ['   '])),
    MessageTemplateValidationError,
  );
});

test('StaticProvider rejects multiple messages', async () => {
  await assert.rejects(
    new StaticProvider().build(createTemplate('STATIC', ['Message A', 'Message B'])),
    MessageTemplateValidationError,
  );
});
