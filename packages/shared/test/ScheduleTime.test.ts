import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseScheduleTime,
  scheduleTimeToMinutes,
  ScheduleTimeError,
  validateScheduleWindow,
} from '../src/index.js';

test('schedule time accepts strict valid HH:mm boundaries', () => {
  assert.equal(parseScheduleTime('00:00'), '00:00');
  assert.equal(parseScheduleTime('23:59'), '23:59');
});

for (const invalid of ['0:00', '24:00', '12:60', ' 09:00', '09:00 ', '', 'noon']) {
  test(`schedule time rejects ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => parseScheduleTime(invalid), ScheduleTimeError);
  });
}

test('schedule time converts to minutes and validates a same-day window', () => {
  assert.equal(scheduleTimeToMinutes(parseScheduleTime('09:30')), 570);
  assert.doesNotThrow(() =>
    validateScheduleWindow(parseScheduleTime('09:00'), parseScheduleTime('10:00')),
  );
});

test('schedule window rejects equal and overnight windows', () => {
  assert.throws(
    () => validateScheduleWindow(parseScheduleTime('09:00'), parseScheduleTime('09:00')),
    ScheduleTimeError,
  );
  assert.throws(
    () => validateScheduleWindow(parseScheduleTime('22:00'), parseScheduleTime('06:00')),
    ScheduleTimeError,
  );
});
