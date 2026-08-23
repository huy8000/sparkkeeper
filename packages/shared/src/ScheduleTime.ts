declare const scheduleTimeBrand: unique symbol;

export type ScheduleTime = string & { readonly [scheduleTimeBrand]: true };

export class ScheduleTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleTimeError';
  }
}

export function parseScheduleTime(value: unknown): ScheduleTime {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ScheduleTimeError('Schedule time must use the strict HH:mm format.');
  }
  return value as ScheduleTime;
}

export function scheduleTimeToMinutes(value: ScheduleTime): number {
  const validated = parseScheduleTime(value);
  const [hours, minutes] = validated.split(':').map(Number);
  if (hours === undefined || minutes === undefined) {
    throw new ScheduleTimeError('Schedule time could not be converted to minutes.');
  }
  return hours * 60 + minutes;
}

export function validateScheduleWindow(startTime: ScheduleTime, endTime: ScheduleTime): void {
  if (scheduleTimeToMinutes(startTime) >= scheduleTimeToMinutes(endTime)) {
    throw new ScheduleTimeError(
      'Schedule start time must be earlier than end time; overnight windows are not supported.',
    );
  }
}
