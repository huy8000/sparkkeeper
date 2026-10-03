import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDeliveryText,
  isDeliveryMessage,
  DELIVERY_VERIFICATION_REASONS,
} from '../src/DeliveryVerification.js';
test('delivery normalization changes CRLF only, retaining whitespace/case/Unicode', () => {
  assert.equal(normalizeDeliveryText('  A\r\nB\r \t'), '  A\nB\r \t');
  assert.notEqual(normalizeDeliveryText('é'), normalizeDeliveryText('e\u0301'));
});
test('known text has a bounded nonempty contract without silent trimming', () => {
  assert.equal(isDeliveryMessage(' a '), true);
  for (const value of ['', null, 1, 'x'.repeat(1001), 'a\0b'])
    assert.equal(isDeliveryMessage(value), false);
});
test('safe delivery reasons contain no arbitrary exception/identity/text payload', () => {
  assert.equal(Object.isFrozen(DELIVERY_VERIFICATION_REASONS), true);
  assert.ok(DELIVERY_VERIFICATION_REASONS.every((reason) => /^[A-Z_]+$/u.test(reason)));
  assert.equal(new Set(DELIVERY_VERIFICATION_REASONS).size, DELIVERY_VERIFICATION_REASONS.length);
});
