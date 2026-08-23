import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BusinessDateError,
  DEFAULT_APP_TIMEZONE,
  parseBusinessDate,
  resolveBusinessDate,
  resolveBusinessTimeZone,
} from '../src/index.js';

test('resolves a normal Asia/Shanghai business date', () => {
  assert.equal(
    resolveBusinessDate(new Date('2026-08-23T08:00:00.000Z'), 'Asia/Shanghai'),
    '2026-08-23',
  );
});

test('resolves Asia/Shanghai across UTC midnight', () => {
  assert.equal(resolveBusinessDate(new Date('2026-08-22T16:30:00.000Z'), 'UTC'), '2026-08-22');
  assert.equal(
    resolveBusinessDate(new Date('2026-08-22T16:30:00.000Z'), 'Asia/Shanghai'),
    '2026-08-23',
  );
});

test('the same instant can produce different business dates in two timezones', () => {
  const instant = new Date('2026-08-23T02:00:00.000Z');
  assert.equal(resolveBusinessDate(instant, 'Asia/Shanghai'), '2026-08-23');
  assert.equal(resolveBusinessDate(instant, 'America/Los_Angeles'), '2026-08-22');
});

test('resolves a month-end boundary', () => {
  assert.equal(
    resolveBusinessDate(new Date('2026-04-30T16:00:00.000Z'), 'Asia/Shanghai'),
    '2026-05-01',
  );
});

test('resolves a year-end boundary', () => {
  assert.equal(
    resolveBusinessDate(new Date('2026-12-31T16:00:00.000Z'), 'Asia/Shanghai'),
    '2027-01-01',
  );
});

test('resolves a leap day', () => {
  assert.equal(resolveBusinessDate(new Date('2024-02-29T12:00:00.000Z'), 'UTC'), '2024-02-29');
});

test('returns and accepts only strict YYYY-MM-DD values', () => {
  assert.match(
    resolveBusinessDate(new Date('2026-08-23T00:00:00.000Z'), 'UTC'),
    /^\d{4}-\d{2}-\d{2}$/,
  );
  assert.equal(parseBusinessDate('2026-08-23'), '2026-08-23');
  assert.throws(() => parseBusinessDate('2026-8-23'), BusinessDateError);
});

test('rejects impossible calendar dates', () => {
  assert.throws(() => parseBusinessDate('2026-02-29'), BusinessDateError);
  assert.throws(() => parseBusinessDate('2026-02-30'), BusinessDateError);
});

test('rejects an invalid timezone explicitly', () => {
  assert.throws(
    () => resolveBusinessDate(new Date('2026-08-23T00:00:00.000Z'), 'Invalid/Test-Zone'),
    (error: unknown) => {
      assert.ok(error instanceof BusinessDateError);
      assert.equal(error.code, 'INVALID_TIME_ZONE');
      return true;
    },
  );
});

test('business timezone config uses the default and supports an override', () => {
  assert.equal(resolveBusinessTimeZone(), DEFAULT_APP_TIMEZONE);
  assert.equal(resolveBusinessTimeZone('  UTC  '), 'UTC');
  assert.equal(resolveBusinessTimeZone('   '), DEFAULT_APP_TIMEZONE);
});
