import { AdminAuthRepository } from '@sparkkeeper/database';
import { normalizeAdminUsername, validateAdminUsername } from '@sparkkeeper/shared';

import { ApiError } from '../http/errors/ApiError.js';
import { LoginRateLimiter } from './LoginRateLimiter.js';
import { PasswordHasher } from './PasswordHasher.js';
import { validatePasswordInput } from './PasswordPolicy.js';
import {
  defaultRandomSource,
  digestRawSessionToken,
  generateSessionTokens,
  type RandomSource,
} from './TokenUtils.js';

export interface LoginInput {
  readonly username: unknown;
  readonly password: unknown;
  readonly clientIp: string;
  readonly currentSessionToken?: string | undefined;
  readonly now?: Date;
}

export interface AuthenticatedLoginResult {
  readonly rawSessionToken: string;
  readonly rawCsrfToken: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly admin: {
    readonly id: string;
    readonly username: string;
  };
  readonly recentlyReauthenticated: boolean;
}

export class AdminAuthenticationService {
  constructor(
    private readonly authRepo: AdminAuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly randomSource: RandomSource = defaultRandomSource,
  ) {}

  /**
   * Performs the complete login procedure:
   * - Strict input validation
   * - Rate limit check and reservation before hashing
   * - Dummy verify on unknown username / disabled user to maintain equal work
   * - Password verify through Argon2 work gate
   * - Known-user failure audit event
   * - Upward-only rehash and session creation
   */
  async login(input: LoginInput): Promise<AuthenticatedLoginResult> {
    const now = input.now ?? new Date();

    // 1. Strict input validation
    let username: string;
    let password: string;
    try {
      if (typeof input.username !== 'string') {
        throw new Error('Username must be a string.');
      }
      username = validateAdminUsername(input.username);
    } catch (err) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Request validation failed for username: must be 3-64 characters matching ^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$.',
        { cause: err },
      );
    }

    try {
      password = validatePasswordInput(input.password);
    } catch (err) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Request validation failed for password: must be between 14 and 256 characters.',
        { cause: err },
      );
    }

    // 2. Normalization
    const normalizedUsername = normalizeAdminUsername(username);

    // 3. System initialization check (zero admins -> 503 SERVICE_NOT_INITIALIZED)
    let totalAdmins: number;
    try {
      totalAdmins = this.authRepo.countAdminUsers();
    } catch (err) {
      throw new ApiError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Authentication service is temporarily unavailable.',
        { cause: err },
      );
    }

    if (totalAdmins === 0) {
      throw new ApiError(
        503,
        'SERVICE_NOT_INITIALIZED',
        'Admin authentication service is not initialized. Run the operator bootstrap CLI.',
      );
    }

    // 4. Rate admission check and reservation
    const reservation = this.rateLimiter.checkAndReserve(input.clientIp, normalizedUsername, now);

    if (!reservation.allowed) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many login attempts. Please try again later.', {
        retryAfter: reservation.retryAfterSeconds ?? 60,
      });
    }

    // 5. Lookup AdminUser
    let adminUser;
    try {
      adminUser = this.authRepo.findByNormalizedUsername(normalizedUsername);
    } catch (err) {
      throw new ApiError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Authentication service is temporarily unavailable.',
        { cause: err },
      );
    }

    // 6. Verification
    if (adminUser && adminUser.status === 'ACTIVE') {
      let verifyResult;
      try {
        verifyResult = await this.rateLimiter.withGate(() =>
          this.hasher.verify(adminUser.passwordHash, password),
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'Argon2WorkGateError') {
          throw new ApiError(
            429,
            'RATE_LIMITED',
            'Authentication service is at capacity. Please try again.',
            { retryAfter: 1 },
          );
        }
        throw new ApiError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'Authentication service is temporarily unavailable.',
        );
      }

      if (
        verifyResult.outcome === 'MALFORMED_HASH' ||
        verifyResult.outcome === 'OPERATION_FAILED'
      ) {
        throw new ApiError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'Authentication service is temporarily unavailable.',
        );
      }

      if (verifyResult.outcome === 'NO_MATCH') {
        // Record known-user LOGIN_FAILED audit event through bounded repository boundary
        try {
          this.authRepo.recordKnownCredentialFailureAudit({
            adminUserId: adminUser.id,
            now,
          });
        } catch (err) {
          throw new ApiError(
            503,
            'AUTH_SERVICE_UNAVAILABLE',
            'Authentication service is temporarily unavailable.',
            { cause: err },
          );
        }

        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid admin username or password.');
      }

      // Credentials MATCH!
      // Check if current session cookie is valid so we can revoke it with LOGIN_REPLACED
      let currentSessionIdToRevoke: string | undefined;
      if (input.currentSessionToken) {
        const digested = digestRawSessionToken(input.currentSessionToken);
        if (digested) {
          try {
            const val = this.authRepo.validateSession({
              tokenDigest: digested.tokenDigest,
              now,
            });
            if (val.outcome === 'VALID') {
              currentSessionIdToRevoke = val.session.id;
            }
          } catch (err) {
            throw new ApiError(
              503,
              'AUTH_SERVICE_UNAVAILABLE',
              'Authentication service is temporarily unavailable.',
              { cause: err },
            );
          }
        }
      }

      let generated;
      try {
        generated = generateSessionTokens(this.randomSource);
      } catch (err) {
        throw new ApiError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'Authentication service is temporarily unavailable.',
          { cause: err },
        );
      }

      const idleExpiresAt = new Date(now.getTime() + 30 * 60 * 1000);
      const absoluteExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);

      try {
        const completeResult = this.authRepo.completeAuthenticatedLogin({
          adminUserId: adminUser.id,
          expectedSessionVersion: adminUser.sessionVersion,
          tokenDigest: generated.tokenDigest,
          csrfTokenDigest: generated.csrfTokenDigest,
          idleExpiresAt,
          absoluteExpiresAt,
          newPasswordHashRehash: verifyResult.newHash,
          currentSessionIdToRevoke,
          now,
        });

        if (completeResult.outcome !== 'SUCCESS') {
          throw new ApiError(
            503,
            'AUTH_SERVICE_UNAVAILABLE',
            'Authentication service is temporarily unavailable.',
          );
        }

        // Clear rate limit memory windows ONLY after successful commit
        this.rateLimiter.recordSuccess(input.clientIp, normalizedUsername);

        return {
          rawSessionToken: generated.rawToken,
          rawCsrfToken: generated.rawCsrfToken,
          idleExpiresAt,
          absoluteExpiresAt,
          admin: {
            id: adminUser.id,
            username: adminUser.username,
          },
          recentlyReauthenticated: true,
        };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new ApiError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'Authentication service is temporarily unavailable.',
          { cause: err },
        );
      }
    } else {
      // Unknown username or disabled user: execute dummy verify
      let dummyResult;
      try {
        dummyResult = await this.rateLimiter.withGate(() => this.hasher.verifyDummy(password));
      } catch (err) {
        if (err instanceof Error && err.name === 'Argon2WorkGateError') {
          throw new ApiError(
            429,
            'RATE_LIMITED',
            'Authentication service is at capacity. Please try again.',
            { retryAfter: 1 },
          );
        }
        throw new ApiError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'Authentication service is temporarily unavailable.',
          { cause: err },
        );
      }

      if (dummyResult.outcome === 'OPERATION_FAILED') {
        throw new ApiError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'Authentication service is temporarily unavailable.',
        );
      }

      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid admin username or password.');
    }
  }
}
