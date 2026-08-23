import path from 'node:path';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export const TRACE_MODES = ['off', 'on-failure', 'always'] as const;
export const DEFAULT_LOG_RETENTION_DAYS = 14;
export const DEFAULT_SCREENSHOT_RETENTION_DAYS = 14;
export const DEFAULT_TRACE_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 365;

export type LogLevel = (typeof LOG_LEVELS)[number];
export type TraceMode = (typeof TRACE_MODES)[number];

export interface ObservabilityEnvironment {
  readonly DATA_DIR?: string;
  readonly LOG_DIR?: string;
  readonly LOG_LEVEL?: string;
  readonly LOG_RETENTION_DAYS?: string;
  readonly SCREENSHOT_RETENTION_DAYS?: string;
  readonly TRACE_MODE?: string;
  readonly TRACE_RETENTION_DAYS?: string;
}

export interface ObservabilityConfig {
  readonly dataDirectory: string;
  readonly logDirectory: string;
  readonly screenshotRoot: string;
  readonly traceRoot: string;
  readonly logLevel: LogLevel;
  readonly logRetentionDays: number;
  readonly screenshotRetentionDays: number;
  readonly traceMode: TraceMode;
  readonly traceRetentionDays: number;
}

export class ObservabilityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObservabilityConfigError';
  }
}

export function resolveObservabilityConfig(
  environment: ObservabilityEnvironment = process.env,
  workingDirectory = process.cwd(),
): ObservabilityConfig {
  const logLevel = environment.LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
    throw new ObservabilityConfigError(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`);
  }
  const traceMode = environment.TRACE_MODE ?? 'off';
  if (!TRACE_MODES.includes(traceMode as TraceMode)) {
    throw new ObservabilityConfigError(`TRACE_MODE must be one of: ${TRACE_MODES.join(', ')}.`);
  }

  const dataDirectory = path.resolve(workingDirectory, environment.DATA_DIR ?? 'data');
  return {
    dataDirectory,
    logDirectory: path.resolve(workingDirectory, environment.LOG_DIR ?? 'logs'),
    screenshotRoot: path.join(dataDirectory, 'screenshots'),
    traceRoot: path.join(dataDirectory, 'traces'),
    logLevel: logLevel as LogLevel,
    logRetentionDays: parseRetentionDays(
      'LOG_RETENTION_DAYS',
      environment.LOG_RETENTION_DAYS,
      DEFAULT_LOG_RETENTION_DAYS,
    ),
    screenshotRetentionDays: parseRetentionDays(
      'SCREENSHOT_RETENTION_DAYS',
      environment.SCREENSHOT_RETENTION_DAYS,
      DEFAULT_SCREENSHOT_RETENTION_DAYS,
    ),
    traceMode: traceMode as TraceMode,
    traceRetentionDays: parseRetentionDays(
      'TRACE_RETENTION_DAYS',
      environment.TRACE_RETENTION_DAYS,
      DEFAULT_TRACE_RETENTION_DAYS,
    ),
  };
}

function parseRetentionDays(name: string, value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ObservabilityConfigError(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_RETENTION_DAYS) {
    throw new ObservabilityConfigError(`${name} must be between 1 and ${MAX_RETENTION_DAYS} days.`);
  }
  return parsed;
}
