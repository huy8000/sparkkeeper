import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import { adminUsers, adminSessions, auditEvents } from '../schema/index.js';
import { AUTH_DB_BUSY_TIMEOUT_MS } from './AdminAuthRepository.js';

export class AdminSecurityError extends Error {
  constructor(readonly code: 'SESSION_REVOKED' | 'SESSION_EXPIRED' | 'CONFLICT' | 'NOT_FOUND') {
    super(code);
  }
}
export interface CredentialProof {
  adminUserId: string;
  sessionId: string;
  sessionVersion: number;
  passwordHash: string;
  usernameNormalized: string;
}
export class AdminSecurityRepository {
  constructor(private readonly client: DatabaseClient) {}
  private transaction(fn: () => void): void {
    this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () =>
      this.client.orm.transaction(
        () => {
          const result: unknown = fn();
          if (
            result &&
            (typeof result === 'object' || typeof result === 'function') &&
            'then' in result
          )
            throw new Error('ASYNC_TRANSACTION_FORBIDDEN');
        },
        { behavior: 'immediate' },
      ),
    );
  }
  proof(adminUserId: string, sessionId: string, now: Date): CredentialProof {
    return this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () => {
      const row = this.client.orm
        .select({ user: adminUsers, session: adminSessions })
        .from(adminUsers)
        .innerJoin(adminSessions, eq(adminSessions.adminUserId, adminUsers.id))
        .where(and(eq(adminUsers.id, adminUserId), eq(adminSessions.id, sessionId)))
        .get();
      if (
        !row ||
        row.user.status !== 'ACTIVE' ||
        row.session.revokedAt ||
        row.session.sessionVersion !== row.user.sessionVersion
      )
        throw new AdminSecurityError('SESSION_REVOKED');
      if (now >= row.session.idleExpiresAt || now >= row.session.absoluteExpiresAt)
        throw new AdminSecurityError('SESSION_EXPIRED');
      return {
        adminUserId,
        sessionId,
        sessionVersion: row.user.sessionVersion,
        passwordHash: row.user.passwordHash,
        usernameNormalized: row.user.usernameNormalized,
      };
    });
  }
  private current(expected: CredentialProof, now: Date) {
    const actual = this.proof(expected.adminUserId, expected.sessionId, now);
    if (
      actual.sessionVersion !== expected.sessionVersion ||
      actual.passwordHash !== expected.passwordHash
    )
      throw new AdminSecurityError('CONFLICT');
  }
  private audit(
    action: 'LOGIN_SUCCEEDED' | 'PASSWORD_CHANGED' | 'SESSION_REVOKED',
    p: CredentialProof,
    entityId: string,
    now: Date,
    reasonCode: string,
  ) {
    this.client.orm
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        actorAdminUserId: p.adminUserId,
        action,
        entityType: action === 'PASSWORD_CHANGED' ? 'ADMIN_USER' : 'ADMIN_SESSION',
        entityId,
        outcome: 'SUCCESS',
        reasonCode,
        createdAt: now,
      })
      .run();
  }
  reauthenticate(p: CredentialProof, now: Date, replacementHash?: string) {
    this.transaction(() => {
      this.current(p, now);
      if (replacementHash)
        this.client.orm
          .update(adminUsers)
          .set({ passwordHash: replacementHash, updatedAt: now })
          .where(eq(adminUsers.id, p.adminUserId))
          .run();
      this.client.orm
        .update(adminSessions)
        .set({ reauthenticatedAt: now })
        .where(eq(adminSessions.id, p.sessionId))
        .run();
      this.audit('LOGIN_SUCCEEDED', p, p.sessionId, now, 'REAUTHENTICATED');
    });
  }
  changePassword(p: CredentialProof, passwordHash: string, now: Date) {
    this.transaction(() => {
      this.current(p, now);
      this.client.orm
        .update(adminUsers)
        .set({
          passwordHash,
          sessionVersion: sql`${adminUsers.sessionVersion}+1`,
          passwordChangedAt: now,
          updatedAt: now,
        })
        .where(eq(adminUsers.id, p.adminUserId))
        .run();
      this.client.orm
        .update(adminSessions)
        .set({ revokedAt: now, revokeReason: 'PASSWORD_CHANGED' })
        .where(and(eq(adminSessions.adminUserId, p.adminUserId), isNull(adminSessions.revokedAt)))
        .run();
      this.audit('PASSWORD_CHANGED', p, p.adminUserId, now, 'PASSWORD_CHANGED');
    });
  }
  sessions(adminUserId: string, currentId: string) {
    return this.client.withBusyTimeout(AUTH_DB_BUSY_TIMEOUT_MS, () =>
      this.client.orm
        .select({
          id: adminSessions.id,
          createdAt: adminSessions.createdAt,
          lastSeenAt: adminSessions.lastSeenAt,
          idleExpiresAt: adminSessions.idleExpiresAt,
          absoluteExpiresAt: adminSessions.absoluteExpiresAt,
          revokedAt: adminSessions.revokedAt,
          sessionVersion: adminSessions.sessionVersion,
        })
        .from(adminSessions)
        .where(eq(adminSessions.adminUserId, adminUserId))
        .orderBy(desc(adminSessions.createdAt), desc(adminSessions.id))
        .limit(50)
        .all()
        .map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          lastSeenAt: r.lastSeenAt.toISOString(),
          idleExpiresAt: r.idleExpiresAt.toISOString(),
          absoluteExpiresAt: r.absoluteExpiresAt.toISOString(),
          revokedAt: r.revokedAt?.toISOString() ?? null,
          current: r.id === currentId,
        })),
    );
  }
  revoke(p: CredentialProof, targetId: string, expectedVersion: number, now: Date) {
    this.transaction(() => {
      this.current(p, now);
      const target = this.client.orm
        .select()
        .from(adminSessions)
        .where(and(eq(adminSessions.id, targetId), eq(adminSessions.adminUserId, p.adminUserId)))
        .get();
      if (!target) throw new AdminSecurityError('NOT_FOUND');
      if (target.sessionVersion !== expectedVersion) throw new AdminSecurityError('CONFLICT');
      if (target.revokedAt) return;
      this.client.orm
        .update(adminSessions)
        .set({ revokedAt: now, revokeReason: 'ADMIN_REVOKED' })
        .where(eq(adminSessions.id, targetId))
        .run();
      this.audit('SESSION_REVOKED', p, targetId, now, 'ADMIN_REVOKED');
    });
  }
}
