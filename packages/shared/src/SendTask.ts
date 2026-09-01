import { resolveBusinessTimeZone } from './BusinessDate.js';
import { parseScheduleTime, validateScheduleWindow, type ScheduleTime } from './ScheduleTime.js';

export const SEND_TASK_SCHEDULE_TYPES = ['DAILY_WINDOW'] as const;
export type SendTaskScheduleType = (typeof SEND_TASK_SCHEDULE_TYPES)[number];

export function isSendTaskScheduleType(value: unknown): value is SendTaskScheduleType {
  return (
    typeof value === 'string' && SEND_TASK_SCHEDULE_TYPES.includes(value as SendTaskScheduleType)
  );
}

export const MIN_TASK_MAX_ATTEMPTS = 1;
export const MAX_TASK_MAX_ATTEMPTS = 5;
export const DEFAULT_TASK_MAX_ATTEMPTS = 3;

export const MIN_TASK_RETRY_INTERVAL_SECONDS = 1;
export const MAX_TASK_RETRY_INTERVAL_SECONDS = 86_400;
export const DEFAULT_TASK_RETRY_INTERVAL_SECONDS = 60;

export class SendTaskValidationError extends Error {
  readonly code:
    | 'INVALID_TASK_NAME'
    | 'INVALID_SCHEDULE_TYPE'
    | 'INVALID_SCHEDULE_WINDOW'
    | 'INVALID_TIMEZONE'
    | 'INVALID_MAX_ATTEMPTS'
    | 'INVALID_RETRY_INTERVAL';

  constructor(code: SendTaskValidationError['code'], message: string) {
    super(message);
    this.name = 'SendTaskValidationError';
    this.code = code;
  }
}

export function validateSendTaskName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new SendTaskValidationError('INVALID_TASK_NAME', 'SendTask name must not be empty.');
  }
  return trimmed;
}

export function validateSendTaskScheduleWindow(
  startTime: string | ScheduleTime,
  endTime: string | ScheduleTime,
): { startTime: ScheduleTime; endTime: ScheduleTime } {
  let parsedStart: ScheduleTime;
  let parsedEnd: ScheduleTime;
  try {
    parsedStart = parseScheduleTime(startTime);
    parsedEnd = parseScheduleTime(endTime);
    validateScheduleWindow(parsedStart, parsedEnd);
  } catch (error) {
    throw new SendTaskValidationError(
      'INVALID_SCHEDULE_WINDOW',
      error instanceof Error ? error.message : 'Invalid schedule window.',
    );
  }
  return { startTime: parsedStart, endTime: parsedEnd };
}

export function validateSendTaskTimeZone(timeZone: string): string {
  const trimmed = timeZone.trim();
  if (trimmed.length === 0) {
    throw new SendTaskValidationError('INVALID_TIMEZONE', 'Timezone must not be empty.');
  }
  try {
    return resolveBusinessTimeZone(trimmed);
  } catch (error) {
    throw new SendTaskValidationError(
      'INVALID_TIMEZONE',
      error instanceof Error ? error.message : 'Invalid IANA timezone.',
    );
  }
}

export function validateSendTaskMaxAttempts(maxAttempts: number): number {
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < MIN_TASK_MAX_ATTEMPTS ||
    maxAttempts > MAX_TASK_MAX_ATTEMPTS
  ) {
    throw new SendTaskValidationError(
      'INVALID_MAX_ATTEMPTS',
      `maxAttempts must be an integer between ${MIN_TASK_MAX_ATTEMPTS} and ${MAX_TASK_MAX_ATTEMPTS}.`,
    );
  }
  return maxAttempts;
}

export function validateSendTaskRetryIntervalSeconds(retryIntervalSeconds: number): number {
  if (
    !Number.isInteger(retryIntervalSeconds) ||
    retryIntervalSeconds < MIN_TASK_RETRY_INTERVAL_SECONDS ||
    retryIntervalSeconds > MAX_TASK_RETRY_INTERVAL_SECONDS
  ) {
    throw new SendTaskValidationError(
      'INVALID_RETRY_INTERVAL',
      `retryIntervalSeconds must be an integer between ${MIN_TASK_RETRY_INTERVAL_SECONDS} and ${MAX_TASK_RETRY_INTERVAL_SECONDS}.`,
    );
  }
  return retryIntervalSeconds;
}
