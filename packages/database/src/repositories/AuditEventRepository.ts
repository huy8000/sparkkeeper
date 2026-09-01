import { randomUUID } from 'node:crypto';

import {
  isAuditAction,
  isAuditEntityType,
  isAuditOutcome,
  normalizeOptionalIdentifier,
  validateAuditReasonCode,
  validateCorrelationDigest,
  type AuditAction,
  type AuditEntityType,
  type AuditOutcome,
} from '@sparkkeeper/shared';
import { and, desc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import { auditEvents, type AuditEventRow, type NewAuditEventRow } from '../schema/index.js';

export type AuditEvent = AuditEventRow;

export interface CreateAuditEventInput {
  readonly actorAdminUserId?: string | null;
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId?: string | null;
  readonly outcome: AuditOutcome;
  readonly reasonCode?: string | null;
  readonly correlationDigest?: string | null;
  readonly now?: Date;
}

export class AuditEventRepositoryError extends RepositoryError {
  readonly auditOperation: 'create' | 'findById' | 'listRecent' | 'listByActor' | 'listByEntity';

  constructor(
    operation: AuditEventRepositoryError['auditOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'AuditEvent', operation, cause });
    this.name = 'AuditEventRepositoryError';
    this.auditOperation = operation;
  }
}

export class AuditEventRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateAuditEventInput): AuditEvent {
    if (!isAuditAction(input.action)) {
      throw new AuditEventRepositoryError('create', 'VALIDATION_ERROR', 'Invalid audit action.');
    }
    if (!isAuditEntityType(input.entityType)) {
      throw new AuditEventRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid audit entityType.',
      );
    }
    if (!isAuditOutcome(input.outcome)) {
      throw new AuditEventRepositoryError('create', 'VALIDATION_ERROR', 'Invalid audit outcome.');
    }

    let reasonCode: string | null;
    let correlationDigest: string | null;
    try {
      reasonCode = validateAuditReasonCode(input.reasonCode);
      correlationDigest = validateCorrelationDigest(input.correlationDigest);
    } catch (error) {
      throw new AuditEventRepositoryError(
        'create',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid audit fields.',
        error,
      );
    }

    const actorAdminUserId = normalizeOptionalIdentifier(input.actorAdminUserId);
    const entityId = normalizeOptionalIdentifier(input.entityId);
    const now = input.now ?? new Date();

    const values: NewAuditEventRow = {
      id: randomUUID(),
      actorAdminUserId,
      action: input.action,
      entityType: input.entityType,
      entityId,
      outcome: input.outcome,
      reasonCode,
      correlationDigest,
      createdAt: now,
    };

    try {
      return this.client.orm.insert(auditEvents).values(values).returning().get();
    } catch (error) {
      throw new AuditEventRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create audit event.',
        error,
      );
    }
  }

  findById(id: string): AuditEvent | undefined {
    try {
      return this.client.orm.select().from(auditEvents).where(eq(auditEvents.id, id)).get();
    } catch (error) {
      throw new AuditEventRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find audit event by id.',
        error,
      );
    }
  }

  listRecent(options?: { limit?: number; offset?: number }): AuditEvent[] {
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);
    try {
      return this.client.orm
        .select()
        .from(auditEvents)
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new AuditEventRepositoryError(
        'listRecent',
        'INTEGRITY_ERROR',
        'Failed to list recent audit events.',
        error,
      );
    }
  }

  listByActor(
    actorAdminUserId: string,
    options?: { limit?: number; offset?: number },
  ): AuditEvent[] {
    const trimmed = actorAdminUserId.trim();
    if (trimmed.length === 0) {
      throw new AuditEventRepositoryError(
        'listByActor',
        'VALIDATION_ERROR',
        'actorAdminUserId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorAdminUserId, trimmed))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new AuditEventRepositoryError(
        'listByActor',
        'INTEGRITY_ERROR',
        'Failed to list audit events by actor.',
        error,
      );
    }
  }

  listByEntity(
    entityType: AuditEntityType,
    entityId?: string | null,
    options?: { limit?: number; offset?: number },
  ): AuditEvent[] {
    if (!isAuditEntityType(entityType)) {
      throw new AuditEventRepositoryError(
        'listByEntity',
        'VALIDATION_ERROR',
        'Invalid entityType.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);
    const trimmedEntityId = normalizeOptionalIdentifier(entityId);

    try {
      const conditions = [eq(auditEvents.entityType, entityType)];
      if (trimmedEntityId !== null) {
        conditions.push(eq(auditEvents.entityId, trimmedEntityId));
      }

      return this.client.orm
        .select()
        .from(auditEvents)
        .where(and(...conditions))
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new AuditEventRepositoryError(
        'listByEntity',
        'INTEGRITY_ERROR',
        'Failed to list audit events by entity.',
        error,
      );
    }
  }
}
