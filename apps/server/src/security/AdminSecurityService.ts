import {
  AdminAuthRepository,
  AdminSecurityRepository,
  AdminSecurityError,
  type CredentialProof,
} from '@sparkkeeper/database';
import { ApiError } from '../http/errors/ApiError.js';
import { PasswordHasher } from './PasswordHasher.js';
import { LoginRateLimiter } from './LoginRateLimiter.js';
import { validatePasswordInput } from './PasswordPolicy.js';

export class AdminSecurityService {
  constructor(
    private readonly repository: AdminSecurityRepository,
    private readonly auth: AdminAuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly limiter: LoginRateLimiter,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  safe<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof AdminSecurityError)
        throw new ApiError(
          e.code === 'NOT_FOUND' ? 404 : e.code === 'CONFLICT' ? 409 : 401,
          e.code === 'NOT_FOUND' ? 'UNAUTHENTICATED' : e.code,
          'Security operation rejected.',
        );
      throw new ApiError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Authentication service temporarily unavailable.',
      );
    }
  }
  private password(value: unknown) {
    try {
      return validatePasswordInput(value);
    } catch {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid password input.');
    }
  }
  private async verify(p: CredentialProof, password: string, ip: string) {
    const admitted = this.limiter.checkAndReserve(ip, p.usernameNormalized, this.clock());
    if (!admitted.allowed)
      throw new ApiError(429, 'RATE_LIMITED', 'Too many credential attempts.', {
        retryAfter: admitted.retryAfterSeconds ?? 60,
      });
    let result;
    try {
      result = await this.limiter.withGate(() => this.hasher.verify(p.passwordHash, password));
    } catch (e) {
      if (e instanceof Error && e.name === 'Argon2WorkGateError')
        throw new ApiError(429, 'RATE_LIMITED', 'Authentication capacity exceeded.', {
          retryAfter: 1,
        });
      throw new ApiError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Authentication service temporarily unavailable.',
      );
    }
    if (result.outcome === 'NO_MATCH') {
      this.safe(() =>
        this.auth.recordKnownCredentialFailureAudit({
          adminUserId: p.adminUserId,
          now: this.clock(),
        }),
      );
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
    }
    if (result.outcome !== 'MATCH' && result.outcome !== 'MATCH_REHASH_NEEDED')
      throw new ApiError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Authentication service temporarily unavailable.',
      );
    return result;
  }
  async reauth(adminId: string, sessionId: string, input: unknown, ip: string) {
    const password = this.password(input),
      p = this.safe(() => this.repository.proof(adminId, sessionId, this.clock()));
    const result = await this.verify(p, password, ip),
      now = this.clock();
    this.safe(() => this.repository.reauthenticate(p, now, result.newHash));
    // Do not reset attempt windows here: repeated reauth must not mint unlimited hash work.
    return { reauthenticatedUntil: new Date(now.getTime() + 300_000).toISOString() };
  }
  async changePassword(
    adminId: string,
    sessionId: string,
    current: unknown,
    replacement: unknown,
    ip: string,
  ) {
    const password = this.password(current),
      next = this.password(replacement),
      p = this.safe(() => this.repository.proof(adminId, sessionId, this.clock()));
    await this.verify(p, password, ip);
    let hash;
    try {
      hash = await this.limiter.withGate(() => this.hasher.hash(next, p.passwordHash));
    } catch (e) {
      if (e instanceof Error && e.name === 'Argon2WorkGateError')
        throw new ApiError(429, 'RATE_LIMITED', 'Authentication capacity exceeded.', {
          retryAfter: 1,
        });
      throw new ApiError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Authentication service temporarily unavailable.',
      );
    }
    this.safe(() => this.repository.changePassword(p, hash, this.clock()));
  }
  sessions(adminId: string, currentId: string) {
    return this.safe(() => this.repository.sessions(adminId, currentId));
  }
  revoke(adminId: string, currentId: string, targetId: string, version: number) {
    const p = this.safe(() => this.repository.proof(adminId, currentId, this.clock()));
    this.safe(() => this.repository.revoke(p, targetId, version, this.clock()));
  }
}
