import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const CSRF_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
export const CSRF_HMAC_DATA = 'sparkkeeper-admin-csrf-v1';

export interface RandomSource {
  randomBytes(length: number): Buffer;
}

export const defaultRandomSource: RandomSource = {
  randomBytes: (length: number) => randomBytes(length),
};

export interface GeneratedSessionToken {
  readonly rawToken: string;
  readonly rawBytes: Buffer;
  readonly tokenDigest: string;
  readonly rawCsrfToken: string;
  readonly csrfTokenDigest: string;
}

/**
 * Generates a 256-bit CSPRNG session token and its derived CSRF token and digests.
 */
export function generateSessionTokens(
  randomSource: RandomSource = defaultRandomSource,
): GeneratedSessionToken {
  const rawBytes = randomSource.randomBytes(32);
  const rawToken = rawBytes.toString('base64url'); // 43 chars

  const tokenDigest = createHash('sha256').update(rawBytes).digest('hex'); // 64 hex chars

  const rawCsrfToken = deriveCsrfToken(rawBytes);
  const csrfTokenDigest = digestCsrfToken(rawCsrfToken);

  return {
    rawToken,
    rawBytes,
    tokenDigest,
    rawCsrfToken,
    csrfTokenDigest,
  };
}

/**
 * Derives the session-bound CSRF token from the raw session token bytes:
 * rawCsrfToken = base64url(HMAC-SHA-256(key = rawSessionTokenBytes, data = UTF8("sparkkeeper-admin-csrf-v1")))
 */
export function deriveCsrfToken(rawSessionBytes: Buffer): string {
  return createHmac('sha256', rawSessionBytes).update(CSRF_HMAC_DATA, 'utf8').digest('base64url');
}

/**
 * Computes the SHA-256 hex digest of the raw CSRF token ASCII bytes.
 */
export function digestCsrfToken(rawCsrfToken: string): string {
  return createHash('sha256').update(rawCsrfToken, 'ascii').digest('hex');
}

/**
 * Validates a submitted CSRF token against the session's stored csrfTokenDigest.
 * - Strict 43-character base64url shape check.
 * - Constant-time comparison over SHA-256 digest buffers.
 */
export function validateCsrfToken(
  submittedCsrfToken: unknown,
  expectedCsrfTokenDigest: string,
): boolean {
  if (typeof submittedCsrfToken !== 'string' || !CSRF_TOKEN_REGEX.test(submittedCsrfToken)) {
    return false;
  }

  const computedDigest = createHash('sha256').update(submittedCsrfToken, 'ascii').digest();
  const expectedDigest = Buffer.from(expectedCsrfTokenDigest, 'hex');

  if (computedDigest.length !== expectedDigest.length) {
    return false;
  }

  return timingSafeEqual(computedDigest, expectedDigest);
}

/**
 * Computes the SHA-256 hex digest of a raw session token string.
 * Returns null if the raw token does not match the strict 43-character base64url shape.
 */
export function digestRawSessionToken(rawToken: unknown): {
  readonly rawBytes: Buffer;
  readonly tokenDigest: string;
} | null {
  if (typeof rawToken !== 'string' || !SESSION_TOKEN_REGEX.test(rawToken)) {
    return null;
  }

  const rawBytes = Buffer.from(rawToken, 'base64url');
  if (rawBytes.length !== 32) {
    return null;
  }

  const tokenDigest = createHash('sha256').update(rawBytes).digest('hex');
  return { rawBytes, tokenDigest };
}
