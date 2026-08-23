import assert from 'node:assert/strict';
import test from 'node:test';

import { MessageTemplateValidationError, RandomProvider, RandomSourceError } from '../src/index.js';
import { createTemplate } from './templateFixture.js';

test('RandomProvider builds the only item in a single-message template', async () => {
  const result = await new RandomProvider(() => 0.5).build(createTemplate('RANDOM', ['Hello']));
  assert.equal(result, 'Hello');
});

test('RandomProvider selects the first item when random source returns zero', async () => {
  const result = await new RandomProvider(() => 0).build(
    createTemplate('RANDOM', ['Message A', 'Message B']),
  );
  assert.equal(result, 'Message A');
});

test('RandomProvider selects the last item for a value approaching one', async () => {
  const result = await new RandomProvider(() => 0.999_999).build(
    createTemplate('RANDOM', ['Message A', 'Message B']),
  );
  assert.equal(result, 'Message B');
});

test('RandomProvider results always come from the original messages', async () => {
  const messages = ['Hello', 'Good morning', 'Test message'] as const;
  for (const randomValue of [0, 0.2, 0.34, 0.67, 0.999]) {
    const result = await new RandomProvider(() => randomValue).build(
      createTemplate('RANDOM', messages),
    );
    assert.equal(messages.includes(result), true);
  }
});

test('RandomProvider rejects an empty messages array', async () => {
  await assert.rejects(
    new RandomProvider(() => 0).build(createTemplate('RANDOM', [])),
    MessageTemplateValidationError,
  );
});

test('RandomProvider rejects a blank message item', async () => {
  await assert.rejects(
    new RandomProvider(() => 0).build(createTemplate('RANDOM', ['Hello', '   '])),
    MessageTemplateValidationError,
  );
});

test('RandomProvider rejects NaN from the random source', async () => {
  await assert.rejects(
    new RandomProvider(() => Number.NaN).build(createTemplate('RANDOM', ['Hello'])),
    RandomSourceError,
  );
});

test('RandomProvider rejects a negative random value', async () => {
  await assert.rejects(
    new RandomProvider(() => -0.1).build(createTemplate('RANDOM', ['Hello'])),
    RandomSourceError,
  );
});

test('RandomProvider rejects a random value equal to or above one', async () => {
  await assert.rejects(
    new RandomProvider(() => 1).build(createTemplate('RANDOM', ['Hello'])),
    RandomSourceError,
  );
  await assert.rejects(
    new RandomProvider(() => 2).build(createTemplate('RANDOM', ['Hello'])),
    RandomSourceError,
  );
});

test('RandomProvider rejects infinite random values', async () => {
  await assert.rejects(
    new RandomProvider(() => Number.POSITIVE_INFINITY).build(createTemplate('RANDOM', ['Hello'])),
    RandomSourceError,
  );
});
