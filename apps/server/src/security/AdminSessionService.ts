import type { AdminSessionRow, AuthAdminUserRow } from '@sparkkeeper/database';
import { AdminAuthRepository } from '@sparkkeeper/database';

import { ApiError } from '../http/errors/ApiError.js';
import { deriveCsrfToken, digestRawSessionToken, validateCsrfToken } from './TokenUtils.js';

export const RECENT_AUTHENTICATION_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export type SessionValidationOutcome =
  'VALID' | 'UNAUTHENTICATED' | 'SESSION_EXPIRED' | 'SESSION_REVOKED';

export interface ValidSessionResult {
  readonly outcome: 'VALID';
  readonly session: AdminSessionRow;
  readonly adminUser: AuthAdminUserRow;
  readonly rawCsrfToken: string;
  readonly recentlyReauthenticated: boolean;
}

export type SessionValidationResult =
  | ValidSessionResult
  | { readonly outcome: 'UNAUTHENTICATED' }
  | { readonly outcome: 'SESSION_EXPIRED'; readonly session?: AdminSessionRow }
  | {
      readonly outcome: 'SESSION_REVOKED';
      readonly session?: AdminSessionRow;
      readonly reason?: string;
    };

export class AdminSessionService {
  constructor(private readonly authRepo: AdminAuthRepository) {}

  /**
   * Validates a raw session token string from cookie.
   */
  validateSession(rawSessionToken: unknown, now: Date): SessionValidationResult {
    const digested = digestRawSessionToken(rawSessionToken);
    if (!digested) {
      return { outcome: 'UNAUTHENTICATED' };
    }

    try {
      const repoResult = this.authRepo.validateSession({
        tokenDigest: digested.tokenDigest,
        now,
      });

      if (repoResult.outcome === 'VALID') {
        const rawCsrfToken = deriveCsrfToken(digested.rawBytes);
        const reauthenticatedAtMs = repoResult.session.reauthenticatedAt?.getTime() ?? 0;
        const recentlyReauthenticated =
          now.getTime() - reauthenticatedAtMs <= RECENT_AUTHENTICATION_MAX_AGE_MS;

        return {
          outcome: 'VALID',
          session: repoResult.session,
          adminUser: repoResult.adminUser,
          rawCsrfToken,
          recentlyReauthenticated,
        };
      }

      if (repoResult.outcome === 'SESSION_EXPIRED') {
        return {
          outcome: 'SESSION_EXPIRED',
          session: repoResult.session,
        };
      }

      if (repoResult.outcome === 'SESSION_REVOKED') {
        return {
          outcome: 'SESSION_REVOKED',
          session: repoResult.session,
          reason: repoResult.reason,
        };
      }

      return { outcome: 'UNAUTHENTICATED' };
    } catch (err) {
      throw new ApiError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Authentication service is temporarily unavailable.',
        { cause: err },
      );
    }
  }

  /**
   * Re-derives the CSRF token from raw session token string.
   */
  rederiveCsrf(rawSessionToken: unknown): string | null {
    const digested = digestRawSessionToken(rawSessionToken);
    if (!digested) return null;
    return deriveCsrfToken(digested.rawBytes);
  }

  /**
   * Validates a submitted CSRF token against the session's stored digest in constant time.
   */
  validateCsrf(submittedCsrfToken: unknown, expectedCsrfTokenDigest: string): boolean {
    return validateCsrfToken(submittedCsrfToken, expectedCsrfTokenDigest);
  }

  /**
   * Logs out the current session.
   */
  logout(
    rawSessionToken: unknown,
    now: Date,
  ): { readonly outcome: 'SUCCESS' | 'NOT_FOUND_OR_REVOKED' } {
    const digested = digestRawSessionToken(rawSessionToken);
    if (!digested) {
      return { outcome: 'NOT_FOUND_OR_REVOKED' };
    }

    try {
      const val = this.authRepo.validateSession({
        tokenDigest: digested.tokenDigest,
        now,
      });

      if (val.outcome !== 'VALID' && val.outcome !== 'SESSION_EXPIRED') {
        return { outcome: 'NOT_FOUND_OR_REVOKED' };
      }

      const sessionId = val.session.id;
      const adminUserId = val.session.adminUserId;

      const result = this.authRepo.logoutCurrentSession({
        sessionId,
        adminUserId,
        now,
      });

      return result;
    } catch (err) {
      throw new ApiError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Authentication service is temporarily unavailable.',
        { cause: err },
      );
    }
  }

  /**
   * Reusable recent-authentication foundation guard.
   */
  requireRecentAuthentication(
    reauthenticatedAt: Date | null | undefined,
    now: Date,
    maxAgeMs = RECENT_AUTHENTICATION_MAX_AGE_MS,
  ): void {
    if (!reauthenticatedAt) {
      throw new ApiError(
        403,
        'REAUTH_REQUIRED',
        'Recent authentication is required for this action.',
      );
    }

    const elapsed = now.getTime() - reauthenticatedAt.getTime();
    if (elapsed > maxAgeMs) {
      throw new ApiError(
        403,
        'REAUTH_REQUIRED',
        'Recent authentication is required for this action.',
      );
    }
  }
}
