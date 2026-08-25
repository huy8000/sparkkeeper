import {
  resolveBusinessDate,
  scheduleTimeToMinutes,
  type BusinessDate,
  type ScheduleTime,
} from '@sparkkeeper/shared';

export type ScheduleWindowPosition = 'BEFORE_WINDOW' | 'IN_WINDOW' | 'AFTER_WINDOW';

export interface ScheduleWindowEvaluation {
  readonly position: ScheduleWindowPosition;
  readonly businessDate: BusinessDate;
  readonly localTime: ScheduleTime;
}

export function evaluateScheduleWindow(
  now: Date,
  timezone: string,
  startTime: ScheduleTime,
  endTime: ScheduleTime,
): ScheduleWindowEvaluation {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const hour = readPart(parts, 'hour');
  const minute = readPart(parts, 'minute');
  const localTime = `${hour}:${minute}` as ScheduleTime;
  const current = scheduleTimeToMinutes(localTime);
  const start = scheduleTimeToMinutes(startTime);
  const end = scheduleTimeToMinutes(endTime);
  return {
    businessDate: resolveBusinessDate(now, timezone),
    localTime,
    position: current < start ? 'BEFORE_WINDOW' : current >= end ? 'AFTER_WINDOW' : 'IN_WINDOW',
  };
}

function readPart(parts: readonly Intl.DateTimeFormatPart[], type: 'hour' | 'minute'): string {
  const value = parts.find((part) => part.type === type)?.value;
  if (value === undefined) {
    throw new Error(`Unable to resolve schedule ${type}.`);
  }
  return value;
}
