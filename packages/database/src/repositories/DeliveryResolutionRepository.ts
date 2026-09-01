import { randomUUID } from 'node:crypto';

import {
  isDeliveryResolutionSource,
  isDeliveryResolutionValue,
  normalizeOptionalIdentifier,
  validateResolutionNote,
  type DeliveryResolutionSource,
  type DeliveryResolutionValue,
} from '@sparkkeeper/shared';
import { desc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  deliveryResolutions,
  sendRecords,
  targetSendRecords,
  type DeliveryResolutionRow,
  type NewDeliveryResolutionRow,
} from '../schema/index.js';

export type DeliveryResolution = DeliveryResolutionRow;

export interface CreateDeliveryResolutionInput {
  readonly targetSendRecordId?: string | null;
  readonly legacySendRecordId?: string | null;
  readonly resolution: DeliveryResolutionValue;
  readonly source?: DeliveryResolutionSource;
  readonly resolvedByAdminUserId: string;
  readonly note?: string | null;
  readonly supersedesResolutionId?: string | null;
  readonly resolvedAt?: Date;
  readonly now?: Date;
}

export class DeliveryResolutionRepositoryError extends RepositoryError {
  readonly resolutionOperation:
    | 'create'
    | 'findById'
    | 'findLatestForTargetSendRecord'
    | 'findLatestForLegacySendRecord'
    | 'listByTargetSendRecord'
    | 'listByLegacySendRecord';

  constructor(
    operation: DeliveryResolutionRepositoryError['resolutionOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'DeliveryResolution', operation, cause });
    this.name = 'DeliveryResolutionRepositoryError';
    this.resolutionOperation = operation;
  }
}

export class DeliveryResolutionRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: CreateDeliveryResolutionInput): DeliveryResolution {
    const targetSendRecordId = normalizeOptionalIdentifier(input.targetSendRecordId);
    const legacySendRecordId = normalizeOptionalIdentifier(input.legacySendRecordId);

    if (
      (targetSendRecordId === null && legacySendRecordId === null) ||
      (targetSendRecordId !== null && legacySendRecordId !== null)
    ) {
      throw new DeliveryResolutionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Exactly one of targetSendRecordId or legacySendRecordId must be set.',
      );
    }

    if (!isDeliveryResolutionValue(input.resolution)) {
      throw new DeliveryResolutionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid resolution value.',
      );
    }

    const source: DeliveryResolutionSource = input.source ?? 'HUMAN';
    if (!isDeliveryResolutionSource(source)) {
      throw new DeliveryResolutionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'Invalid resolution source.',
      );
    }

    const resolvedByAdminUserId = input.resolvedByAdminUserId.trim();
    if (resolvedByAdminUserId.length === 0) {
      throw new DeliveryResolutionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        'resolvedByAdminUserId must not be empty.',
      );
    }

    let note: string | null;
    try {
      note = validateResolutionNote(input.note);
    } catch (error) {
      throw new DeliveryResolutionRepositoryError(
        'create',
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid resolution note.',
        error,
      );
    }

    const supersedesResolutionId = normalizeOptionalIdentifier(input.supersedesResolutionId);
    const now = input.now ?? new Date();
    const resolvedAt = input.resolvedAt ?? now;

    try {
      return this.client.orm.transaction((tx) => {
        let originalMachineStatus: string;

        if (targetSendRecordId !== null) {
          const record = tx
            .select()
            .from(targetSendRecords)
            .where(eq(targetSendRecords.id, targetSendRecordId))
            .get();

          if (!record) {
            throw new DeliveryResolutionRepositoryError(
              'create',
              'NOT_FOUND',
              `Target send record '${targetSendRecordId}' not found.`,
            );
          }

          if (record.machineStatus !== 'DELIVERY_UNKNOWN') {
            throw new DeliveryResolutionRepositoryError(
              'create',
              'INVALID_TRANSITION',
              `Cannot resolve target send record with machine status '${record.machineStatus}'. Only 'DELIVERY_UNKNOWN' can be resolved.`,
            );
          }
          originalMachineStatus = record.machineStatus;
        } else {
          const record = tx
            .select()
            .from(sendRecords)
            .where(eq(sendRecords.id, legacySendRecordId!))
            .get();

          if (!record) {
            throw new DeliveryResolutionRepositoryError(
              'create',
              'NOT_FOUND',
              `Legacy send record '${legacySendRecordId}' not found.`,
            );
          }

          if (record.status !== 'DELIVERY_UNKNOWN') {
            throw new DeliveryResolutionRepositoryError(
              'create',
              'INVALID_TRANSITION',
              `Cannot resolve legacy send record with status '${record.status}'. Only 'DELIVERY_UNKNOWN' can be resolved.`,
            );
          }
          originalMachineStatus = record.status;
        }

        if (supersedesResolutionId !== null) {
          const superseded = tx
            .select()
            .from(deliveryResolutions)
            .where(eq(deliveryResolutions.id, supersedesResolutionId))
            .get();

          if (!superseded) {
            throw new DeliveryResolutionRepositoryError(
              'create',
              'NOT_FOUND',
              `Superseded resolution '${supersedesResolutionId}' not found.`,
            );
          }

          // Verify belongs to same target record
          if (
            superseded.targetSendRecordId !== targetSendRecordId ||
            superseded.legacySendRecordId !== legacySendRecordId
          ) {
            throw new DeliveryResolutionRepositoryError(
              'create',
              'CONFLICT',
              'Superseded resolution must belong to the exact same send record.',
            );
          }

          // Verify it is the current chain tail (no existing resolution supersedes it)
          const next = tx
            .select()
            .from(deliveryResolutions)
            .where(eq(deliveryResolutions.supersedesResolutionId, supersedesResolutionId))
            .get();

          if (next) {
            throw new DeliveryResolutionRepositoryError(
              'create',
              'CONFLICT',
              `Resolution '${supersedesResolutionId}' has already been superseded by '${next.id}'. Can only supersede the current tail.`,
            );
          }
        } else {
          // If no supersedesId, ensure this is the first resolution for this record
          const existingList =
            targetSendRecordId !== null
              ? tx
                  .select()
                  .from(deliveryResolutions)
                  .where(eq(deliveryResolutions.targetSendRecordId, targetSendRecordId))
                  .all()
              : tx
                  .select()
                  .from(deliveryResolutions)
                  .where(eq(deliveryResolutions.legacySendRecordId, legacySendRecordId!))
                  .all();

          if (existingList.length > 0) {
            throw new DeliveryResolutionRepositoryError(
              'create',
              'CONFLICT',
              'A resolution chain already exists for this record. You must specify supersedesResolutionId to append to the chain.',
            );
          }
        }

        const values: NewDeliveryResolutionRow = {
          id: randomUUID(),
          targetSendRecordId,
          legacySendRecordId,
          originalMachineStatus,
          resolution: input.resolution,
          source,
          resolvedByAdminUserId,
          note,
          supersedesResolutionId,
          resolvedAt,
          createdAt: now,
        };

        return tx.insert(deliveryResolutions).values(values).returning().get();
      });
    } catch (error) {
      if (error instanceof DeliveryResolutionRepositoryError) {
        throw error;
      }
      throw new DeliveryResolutionRepositoryError(
        'create',
        'INTEGRITY_ERROR',
        'Failed to create delivery resolution.',
        error,
      );
    }
  }

  findById(id: string): DeliveryResolution | undefined {
    try {
      return this.client.orm
        .select()
        .from(deliveryResolutions)
        .where(eq(deliveryResolutions.id, id))
        .get();
    } catch (error) {
      throw new DeliveryResolutionRepositoryError(
        'findById',
        'INTEGRITY_ERROR',
        'Failed to find delivery resolution by id.',
        error,
      );
    }
  }

  findLatestForTargetSendRecord(targetSendRecordId: string): DeliveryResolution | undefined {
    const trimmed = targetSendRecordId.trim();
    if (trimmed.length === 0) {
      throw new DeliveryResolutionRepositoryError(
        'findLatestForTargetSendRecord',
        'VALIDATION_ERROR',
        'targetSendRecordId must not be empty.',
      );
    }

    try {
      const all = this.client.orm
        .select()
        .from(deliveryResolutions)
        .where(eq(deliveryResolutions.targetSendRecordId, trimmed))
        .all();

      if (all.length === 0) return undefined;
      if (all.length === 1) return all[0];

      const tail = all.find((r) => !all.some((other) => other.supersedesResolutionId === r.id));
      return tail ?? all[all.length - 1];
    } catch (error) {
      throw new DeliveryResolutionRepositoryError(
        'findLatestForTargetSendRecord',
        'INTEGRITY_ERROR',
        'Failed to find latest resolution.',
        error,
      );
    }
  }

  findLatestForLegacySendRecord(legacySendRecordId: string): DeliveryResolution | undefined {
    const trimmed = legacySendRecordId.trim();
    if (trimmed.length === 0) {
      throw new DeliveryResolutionRepositoryError(
        'findLatestForLegacySendRecord',
        'VALIDATION_ERROR',
        'legacySendRecordId must not be empty.',
      );
    }

    try {
      const all = this.client.orm
        .select()
        .from(deliveryResolutions)
        .where(eq(deliveryResolutions.legacySendRecordId, trimmed))
        .all();

      if (all.length === 0) return undefined;
      if (all.length === 1) return all[0];

      const tail = all.find((r) => !all.some((other) => other.supersedesResolutionId === r.id));
      return tail ?? all[all.length - 1];
    } catch (error) {
      throw new DeliveryResolutionRepositoryError(
        'findLatestForLegacySendRecord',
        'INTEGRITY_ERROR',
        'Failed to find latest legacy resolution.',
        error,
      );
    }
  }

  listByTargetSendRecord(
    targetSendRecordId: string,
    options?: { limit?: number; offset?: number },
  ): DeliveryResolution[] {
    const trimmed = targetSendRecordId.trim();
    if (trimmed.length === 0) {
      throw new DeliveryResolutionRepositoryError(
        'listByTargetSendRecord',
        'VALIDATION_ERROR',
        'targetSendRecordId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(deliveryResolutions)
        .where(eq(deliveryResolutions.targetSendRecordId, trimmed))
        .orderBy(desc(deliveryResolutions.resolvedAt), desc(deliveryResolutions.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new DeliveryResolutionRepositoryError(
        'listByTargetSendRecord',
        'INTEGRITY_ERROR',
        'Failed to list delivery resolutions.',
        error,
      );
    }
  }

  listByLegacySendRecord(
    legacySendRecordId: string,
    options?: { limit?: number; offset?: number },
  ): DeliveryResolution[] {
    const trimmed = legacySendRecordId.trim();
    if (trimmed.length === 0) {
      throw new DeliveryResolutionRepositoryError(
        'listByLegacySendRecord',
        'VALIDATION_ERROR',
        'legacySendRecordId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(deliveryResolutions)
        .where(eq(deliveryResolutions.legacySendRecordId, trimmed))
        .orderBy(desc(deliveryResolutions.resolvedAt), desc(deliveryResolutions.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new DeliveryResolutionRepositoryError(
        'listByLegacySendRecord',
        'INTEGRITY_ERROR',
        'Failed to list legacy delivery resolutions.',
        error,
      );
    }
  }
}
