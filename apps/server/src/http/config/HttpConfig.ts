import { resolveBusinessTimeZone } from '@sparkkeeper/shared';

export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 8080;
export const DEFAULT_RELEASE_VERSION = 'development';

export interface HttpEnvironment {
  readonly HOST?: string;
  readonly PORT?: string;
  readonly APP_VERSION?: string;
  readonly APP_TIMEZONE?: string;
  readonly DATA_DIR?: string;
  readonly BROWSER_PROFILE_DIR?: string;
}

export interface HttpConfig {
  readonly host: string;
  readonly port: number;
  readonly version: string;
  readonly timezone: string;
  readonly browserProfileConfigured: boolean;
}

export class HttpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpConfigError';
  }
}

export function resolveHttpConfig(environment: HttpEnvironment = process.env): HttpConfig {
  return {
    host: optional(environment.HOST) ?? DEFAULT_HTTP_HOST,
    port: parsePort(environment.PORT),
    version: optional(environment.APP_VERSION) ?? DEFAULT_RELEASE_VERSION,
    timezone: resolveBusinessTimeZone(environment.APP_TIMEZONE),
    browserProfileConfigured:
      optional(environment.BROWSER_PROFILE_DIR) !== undefined ||
      optional(environment.DATA_DIR) !== undefined,
  };
}

function parsePort(value: string | undefined): number {
  const normalized = optional(value);
  if (normalized === undefined) return DEFAULT_HTTP_PORT;
  if (!/^\d+$/.test(normalized)) {
    throw new HttpConfigError('PORT must be an integer between 1 and 65535.');
  }
  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new HttpConfigError('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}
