import { isIPv6 } from 'node:net';
import { resolveBusinessTimeZone } from '@sparkkeeper/shared';

export const DEFAULT_HTTP_HOST = '127.0.0.1';
export const DEFAULT_HTTP_PORT = 8080;
export const DEFAULT_RELEASE_VERSION = 'development';

export const PRODUCTION_COOKIE_NAME = '__Host-sparkkeeper_session';
export const DEVELOPMENT_COOKIE_NAME = 'sparkkeeper_dev_session';
export const SESSION_MAX_AGE_SECONDS = 43200; // 12 hours

export type AdminSecurityMode = 'production' | 'development';

export interface HttpEnvironment {
  readonly HOST?: string;
  readonly PORT?: string;
  readonly APP_VERSION?: string;
  readonly APP_TIMEZONE?: string;
  readonly DATA_DIR?: string;
  readonly BROWSER_PROFILE_DIR?: string;
  readonly SPARKKEEPER_ADMIN_SECURITY_MODE?: string;
  readonly SPARKKEEPER_ADMIN_CANONICAL_ORIGIN?: string;
  readonly SPARKKEEPER_ADMIN_TRUSTED_PROXY_CIDRS?: string;
}

export interface CookieConfig {
  readonly name: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: 'strict';
  readonly path: string;
  readonly maxAge: number;
}

export interface HttpConfig {
  readonly host: string;
  readonly port: number;
  readonly version: string;
  readonly timezone: string;
  readonly browserProfileConfigured: boolean;
  readonly securityMode: AdminSecurityMode;
  readonly canonicalOrigin: string;
  readonly canonicalAuthority: string;
  readonly canonicalProtocol: string;
  readonly trustedProxyCidrs: readonly string[];
  readonly trustProxy: false | readonly string[];
  readonly cookie: CookieConfig;
}

export class HttpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpConfigError';
  }
}

function parseAndValidateIPv4(ip: string): {
  valid: boolean;
  isAllZero: boolean;
  canonical: string;
} {
  const parts = ip.split('.');
  if (parts.length !== 4) return { valid: false, isAllZero: false, canonical: '' };
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return { valid: false, isAllZero: false, canonical: '' };
    if (part.length > 1 && part.startsWith('0'))
      return { valid: false, isAllZero: false, canonical: '' };
    const num = Number.parseInt(part, 10);
    if (num < 0 || num > 255) return { valid: false, isAllZero: false, canonical: '' };
    octets.push(num);
  }
  const isAllZero = octets.every((o) => o === 0);
  return { valid: true, isAllZero, canonical: octets.join('.') };
}

function parseAndValidateIPv6(ip: string): {
  valid: boolean;
  isAllZero: boolean;
  canonical: string;
} {
  if (!isIPv6(ip)) return { valid: false, isAllZero: false, canonical: '' };

  let normalized = ip.toLowerCase();
  if (normalized.includes('::')) {
    const halves = normalized.split('::');
    if (halves.length !== 2) return { valid: false, isAllZero: false, canonical: '' };
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return { valid: false, isAllZero: false, canonical: '' };
    const zeros = Array(missing).fill('0');
    normalized = [...left, ...zeros, ...right].join(':');
  }

  const groups = normalized.split(':');
  if (groups.length !== 8) return { valid: false, isAllZero: false, canonical: '' };

  const nums: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return { valid: false, isAllZero: false, canonical: '' };
    const num = Number.parseInt(g, 16);
    nums.push(num);
  }
  const isAllZero = nums.every((n) => n === 0);
  return { valid: true, isAllZero, canonical: ip.trim() };
}

export function validateTrustedProxyEntry(rawEntry: string): string {
  const entry = rawEntry.trim();
  if (!entry) {
    throw new HttpConfigError('Trusted proxy entry cannot be empty.');
  }

  // CIDR notation
  if (entry.includes('/')) {
    const parts = entry.split('/');
    if (parts.length !== 2) {
      throw new HttpConfigError(`Invalid CIDR notation: "${entry}".`);
    }
    const ip = parts[0] ?? '';
    const prefixStr = parts[1] ?? '';
    if (!/^\d+$/.test(prefixStr)) {
      throw new HttpConfigError(`Invalid CIDR prefix in "${entry}".`);
    }
    const prefix = Number.parseInt(prefixStr, 10);

    const v4 = parseAndValidateIPv4(ip);
    if (v4.valid) {
      if (prefix < 1 || prefix > 32) {
        throw new HttpConfigError(`IPv4 CIDR prefix must be between 1 and 32 in "${entry}".`);
      }
      if (v4.isAllZero) {
        throw new HttpConfigError(`Wildcard IPv4 CIDR "${entry}" is rejected.`);
      }
      return `${v4.canonical}/${prefix}`;
    }

    const v6 = parseAndValidateIPv6(ip);
    if (v6.valid) {
      if (prefix < 1 || prefix > 128) {
        throw new HttpConfigError(`IPv6 CIDR prefix must be between 1 and 128 in "${entry}".`);
      }
      if (v6.isAllZero) {
        throw new HttpConfigError(`Wildcard IPv6 CIDR "${entry}" is rejected.`);
      }
      return `${ip}/${prefix}`;
    }

    throw new HttpConfigError(`Invalid IP address in CIDR "${entry}".`);
  }

  // Standalone IP
  const v4 = parseAndValidateIPv4(entry);
  if (v4.valid) {
    if (v4.isAllZero) {
      throw new HttpConfigError(`Wildcard IPv4 address "${entry}" is rejected.`);
    }
    return v4.canonical;
  }

  const v6 = parseAndValidateIPv6(entry);
  if (v6.valid) {
    if (v6.isAllZero) {
      throw new HttpConfigError(`Wildcard IPv6 address "${entry}" is rejected.`);
    }
    return entry;
  }

  throw new HttpConfigError(
    `Trusted proxy entry "${entry}" must be a valid IPv4/IPv6 address or CIDR. Hostnames and wildcards are rejected.`,
  );
}

export function resolveHttpConfig(environment: HttpEnvironment = process.env): HttpConfig {
  const host = optional(environment.HOST) ?? DEFAULT_HTTP_HOST;
  const port = parsePort(environment.PORT);
  const version = optional(environment.APP_VERSION) ?? DEFAULT_RELEASE_VERSION;
  const timezone = resolveBusinessTimeZone(environment.APP_TIMEZONE);
  const browserProfileConfigured =
    optional(environment.BROWSER_PROFILE_DIR) !== undefined ||
    optional(environment.DATA_DIR) !== undefined;

  const rawSecurityMode = optional(environment.SPARKKEEPER_ADMIN_SECURITY_MODE);
  if (!rawSecurityMode) {
    throw new HttpConfigError(
      'SPARKKEEPER_ADMIN_SECURITY_MODE is required and must be either "production" or "development".',
    );
  }
  let securityMode: AdminSecurityMode;
  if (rawSecurityMode === 'production' || rawSecurityMode === 'development') {
    securityMode = rawSecurityMode;
  } else {
    throw new HttpConfigError(
      'SPARKKEEPER_ADMIN_SECURITY_MODE must be either "production" or "development".',
    );
  }

  const rawCanonicalOrigin = optional(environment.SPARKKEEPER_ADMIN_CANONICAL_ORIGIN);
  if (!rawCanonicalOrigin) {
    throw new HttpConfigError('SPARKKEEPER_ADMIN_CANONICAL_ORIGIN is required.');
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(rawCanonicalOrigin);
  } catch {
    throw new HttpConfigError('SPARKKEEPER_ADMIN_CANONICAL_ORIGIN must be a valid absolute URL.');
  }

  if (
    (parsedOrigin.pathname !== '/' && parsedOrigin.pathname !== '') ||
    parsedOrigin.search !== '' ||
    parsedOrigin.hash !== '' ||
    parsedOrigin.username !== '' ||
    parsedOrigin.password !== ''
  ) {
    throw new HttpConfigError(
      'SPARKKEEPER_ADMIN_CANONICAL_ORIGIN must contain only scheme, host, and optional port (no path/query/fragment).',
    );
  }

  const canonicalOrigin = parsedOrigin.origin;
  const canonicalAuthority = parsedOrigin.host;
  const canonicalProtocol = parsedOrigin.protocol;

  const rawProxyCidrs = optional(environment.SPARKKEEPER_ADMIN_TRUSTED_PROXY_CIDRS);
  const trustedProxyCidrs = rawProxyCidrs
    ? rawProxyCidrs
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map(validateTrustedProxyEntry)
    : [];

  if (securityMode === 'production') {
    if (canonicalProtocol !== 'https:') {
      throw new HttpConfigError(
        'SPARKKEEPER_ADMIN_CANONICAL_ORIGIN must use https: in production mode.',
      );
    }
    if (trustedProxyCidrs.length === 0) {
      throw new HttpConfigError(
        'SPARKKEEPER_ADMIN_TRUSTED_PROXY_CIDRS is required in production mode.',
      );
    }
  } else {
    // Development mode checks
    if (canonicalProtocol !== 'http:') {
      throw new HttpConfigError(
        'SPARKKEEPER_ADMIN_CANONICAL_ORIGIN must use http: in development mode.',
      );
    }
    const hostname = parsedOrigin.hostname;
    const isLoopback =
      hostname === '127.0.0.1' ||
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '::1';
    if (!isLoopback) {
      throw new HttpConfigError(
        'SPARKKEEPER_ADMIN_CANONICAL_ORIGIN in development mode must use a loopback host (localhost, 127.0.0.1, or [::1]).',
      );
    }
  }

  const cookie: CookieConfig =
    securityMode === 'production'
      ? {
          name: PRODUCTION_COOKIE_NAME,
          secure: true,
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
          maxAge: SESSION_MAX_AGE_SECONDS,
        }
      : {
          name: DEVELOPMENT_COOKIE_NAME,
          secure: false,
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
          maxAge: SESSION_MAX_AGE_SECONDS,
        };

  const trustProxy = trustedProxyCidrs.length > 0 ? trustedProxyCidrs : false;

  return {
    host,
    port,
    version,
    timezone,
    browserProfileConfigured,
    securityMode,
    canonicalOrigin,
    canonicalAuthority,
    canonicalProtocol,
    trustedProxyCidrs,
    trustProxy,
    cookie,
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
