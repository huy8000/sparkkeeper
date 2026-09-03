import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

export const ARGON2_CONFIG = {
  type: argon2.argon2id,
  version: 0x13, // v=19
  memoryCost: 19456, // 19456 KiB (~19 MiB)
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const;

export type PasswordVerificationOutcome =
  'MATCH' | 'MATCH_REHASH_NEEDED' | 'NO_MATCH' | 'MALFORMED_HASH' | 'OPERATION_FAILED';

export interface PasswordVerificationResult {
  readonly outcome: PasswordVerificationOutcome;
  readonly newHash?: string;
  readonly error?: string;
}

export interface ParsedPhc {
  readonly algorithm: string;
  readonly version: number;
  readonly memoryCost: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly salt: string;
  readonly hash: string;
}

/**
 * Canonical PHC grammar for accepted stored hashes:
 *   $argon2id$v=19$m=<m>,t=<t>,p=<p>$<salt>$<hash>
 *
 * Parameter order is EXACTLY m,t,p. Decimal costs must be canonical
 * (String(parsedInteger) must equal the original decimal text, so leading
 * zeros, signs, and whitespace are rejected).
 *
 * Salt/hash segments use the canonical node-argon2 PHC Base64 spelling:
 * standard alphabet, unpadded (leading-bit-padded, as emitted by
 * node-argon2's PHC serialization). A segment is canonical only when
 * decoding it and re-encoding it with those rules reproduces the exact
 * original text byte-for-byte.
 */
export function parsePhcString(phc: string): ParsedPhc | null {
  if (typeof phc !== 'string') return null;
  const parts = phc.split('$');
  if (parts.length !== 6 || parts[0] !== '') return null;

  const [, algorithm, versionPart, paramsPart, salt, hash] = parts;
  if (!algorithm || !versionPart || !paramsPart || !salt || !hash) return null;

  // Strict algorithm: argon2id ONLY (reject argon2i, argon2d)
  if (algorithm !== 'argon2id') return null;

  // Strict version: v=19 ONLY
  if (versionPart !== 'v=19') return null;

  // Parameters: strictly m=<m>,t=<t>,p=<p> in EXACT order with no extra keys, no duplicates, no whitespace, no signs
  const paramPairs = paramsPart.split(',');
  if (paramPairs.length !== 3) return null;

  const [mPair, tPair, pPair] = paramPairs;
  if (!mPair || !tPair || !pPair) return null;

  if (!mPair.startsWith('m=') || !tPair.startsWith('t=') || !pPair.startsWith('p=')) {
    return null; // Reordered or wrong parameter keys rejected
  }

  const mValStr = mPair.slice(2);
  const tValStr = tPair.slice(2);
  const pValStr = pPair.slice(2);

  // Digits only, then canonical decimal rule: re-encoding the parsed integer
  // must reproduce the exact original text (rejects leading zeros like 019456).
  if (!/^\d+$/.test(mValStr) || !/^\d+$/.test(tValStr) || !/^\d+$/.test(pValStr)) {
    return null;
  }

  const memoryCost = Number.parseInt(mValStr, 10);
  const timeCost = Number.parseInt(tValStr, 10);
  const parallelism = Number.parseInt(pValStr, 10);

  if (
    !Number.isSafeInteger(memoryCost) ||
    !Number.isSafeInteger(timeCost) ||
    !Number.isSafeInteger(parallelism)
  ) {
    return null;
  }

  if (String(memoryCost) !== mValStr) return null;
  if (String(timeCost) !== tValStr) return null;
  if (String(parallelism) !== pValStr) return null;

  // Cost bounds checking before native invocation:
  // memoryCost m: 8192 .. 65536 KiB inclusive
  // timeCost t: 1 .. 4 inclusive
  // parallelism p: 1 .. 4 inclusive
  if (memoryCost < 8192 || memoryCost > 65536) return null;
  if (timeCost < 1 || timeCost > 4) return null;
  if (parallelism < 1 || parallelism > 4) return null;

  // Canonical unpadded standard-Base64 segments (node-argon2 PHC output rules)
  if (!isCanonicalUnpaddedBase64(salt)) return null;
  if (!isCanonicalUnpaddedBase64(hash)) return null;

  let saltBytes: Buffer;
  let hashBytes: Buffer;
  try {
    saltBytes = Buffer.from(salt, 'base64');
    hashBytes = Buffer.from(hash, 'base64');
  } catch {
    return null;
  }
  if (saltBytes.length < 8 || saltBytes.length > 64) return null;
  if (hashBytes.length < 16 || hashBytes.length > 64) return null;

  return {
    algorithm,
    version: 19,
    memoryCost,
    timeCost,
    parallelism,
    salt,
    hash,
  };
}

/**
 * Returns true when the segment consists only of standard Base64 characters,
 * contains no padding, and decoding + re-encoding (base64, padding stripped)
 * reproduces the exact original text. This is the canonical encoding
 * node-argon2 uses in PHC output; padded or otherwise noncanonical spellings
 * are rejected.
 */
function isCanonicalUnpaddedBase64(segment: string): boolean {
  if (segment.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+$/.test(segment)) return false;
  const decoded = Buffer.from(segment, 'base64');
  const reEncoded = decoded.toString('base64').replace(/=+$/, '');
  return reEncoded === segment;
}

/**
 * Checks if a parsed PHC string needs an upward-only rehash.
 * Returns true only if any security dimension is below the current floor.
 * Never downgrades a hash whose dimensions meet or exceed the floor.
 */
export function isRehashNeeded(parsed: ParsedPhc): boolean {
  if (parsed.memoryCost < ARGON2_CONFIG.memoryCost) return true;
  if (parsed.timeCost < ARGON2_CONFIG.timeCost) return true;
  if (parsed.parallelism < ARGON2_CONFIG.parallelism) return true;

  const rawHashLength = Buffer.from(parsed.hash, 'base64').length;
  if (rawHashLength < ARGON2_CONFIG.hashLength) return true;

  return false;
}

// In-source non-credential dummy PHC hash with identical parameters (Argon2id, v=19, m=19456, t=2, p=1).
// Salt and hash are synthetic random 16-byte and 32-byte base64 strings with no known preimage.
export const DUMMY_PHC =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXJhbmRvbXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * The smallest internal native Argon adapter boundary. Production uses the
 * actual argon2 package; tests may inject ONLY a native-failure-emulating
 * adapter (it may throw like the native layer, never return a security
 * decision such as a specific boolean match/mismatch that differs from the
 * emulated primitive semantics). PasswordHasher itself always stays real.
 * This boundary is internal to the security module and is never exposed
 * through HTTP, routes, or service interfaces.
 */
export interface ArgonAdapter {
  hash(password: string, options: typeof ARGON2_CONFIG & { salt: Buffer }): Promise<string>;
  verify(phc: string, password: string): Promise<boolean>;
}

/** Production adapter: the actual argon2 native binding. */
export const nativeArgonAdapter: ArgonAdapter = {
  hash: (password, options) =>
    argon2.hash(password, {
      type: options.type,
      version: options.version,
      memoryCost: options.memoryCost,
      timeCost: options.timeCost,
      parallelism: options.parallelism,
      hashLength: options.hashLength,
      salt: options.salt,
    }),
  verify: (phc, password) => argon2.verify(phc, password),
};

export class PasswordHasher {
  private readonly adapter: ArgonAdapter;

  constructor(adapter: ArgonAdapter = nativeArgonAdapter) {
    this.adapter = adapter;
  }

  /**
   * Hashes a password using Argon2id with frozen V4-2 parameters.
   * The native PHC output is rewritten to the canonical m,t,p parameter order
   * before storage; segments keep node-argon2's canonical unpadded Base64.
   */
  async hash(password: string): Promise<string> {
    try {
      const salt = randomBytes(16);
      const raw = await this.adapter.hash(password, {
        type: ARGON2_CONFIG.type,
        version: ARGON2_CONFIG.version,
        memoryCost: ARGON2_CONFIG.memoryCost,
        timeCost: ARGON2_CONFIG.timeCost,
        parallelism: ARGON2_CONFIG.parallelism,
        hashLength: ARGON2_CONFIG.hashLength,
        salt,
      });
      const parts = raw.split('$');
      if (parts.length === 6) {
        const [, algorithm, versionPart, , saltPart, hashPart] = parts;
        return `$${algorithm}$${versionPart}$m=${ARGON2_CONFIG.memoryCost},t=${ARGON2_CONFIG.timeCost},p=${ARGON2_CONFIG.parallelism}$${saltPart}$${hashPart}`;
      }
      return raw;
    } catch (error) {
      throw new Error('Password hashing operation failed.', { cause: error });
    }
  }

  /**
   * Verifies a password against a stored PHC hash.
   * Returns typed outcomes without leaking passwords or PHCs.
   */
  async verify(phc: string, password: string): Promise<PasswordVerificationResult> {
    const parsed = parsePhcString(phc);
    if (!parsed) {
      return {
        outcome: 'MALFORMED_HASH',
        error: 'Stored password hash is malformed or uses an unsupported format.',
      };
    }

    try {
      const isMatch = await this.adapter.verify(phc, password);
      if (!isMatch) {
        return { outcome: 'NO_MATCH' };
      }
    } catch {
      return {
        outcome: 'OPERATION_FAILED',
        error: 'Argon2 verification operation encountered an internal error.',
      };
    }

    if (isRehashNeeded(parsed)) {
      try {
        const newHash = await this.hash(password);
        return { outcome: 'MATCH_REHASH_NEEDED', newHash };
      } catch {
        return {
          outcome: 'OPERATION_FAILED',
          error: 'Password rehash operation failed.',
        };
      }
    }

    return { outcome: 'MATCH' };
  }

  /**
   * Performs a dummy verification for unknown usernames to maintain equal work.
   */
  async verifyDummy(password: string): Promise<PasswordVerificationResult> {
    try {
      await this.adapter.verify(DUMMY_PHC, password);
      return { outcome: 'NO_MATCH' };
    } catch {
      return {
        outcome: 'OPERATION_FAILED',
        error: 'Argon2 dummy verification operation encountered an internal error.',
      };
    }
  }
}
