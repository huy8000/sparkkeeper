import {
  MigrationRepository,
  UnifiedRunRepository,
  MigrationError,
  TaskError,
  DeliveryResolutionRepositoryError,
  type DatabaseClient,
} from '@sparkkeeper/database';
import { ApiError } from '../errors/ApiError.js';
import type { RealtimeEventPublisher } from '../../realtime/RealtimeEvent.js';
export function migrationSafe<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (
      e instanceof MigrationError ||
      e instanceof TaskError ||
      e instanceof DeliveryResolutionRepositoryError
    ) {
      const code = e.code;
      throw new ApiError(
        code === 'NOT_FOUND'
          ? 404
          : code === 'VALIDATION_ERROR'
            ? 400
            : code === 'TARGET_NOT_ELIGIBLE'
              ? 422
              : 409,
        code === 'NOT_FOUND'
          ? 'RUN_NOT_FOUND'
          : code === 'VALIDATION_ERROR'
            ? 'VALIDATION_ERROR'
            : code === 'TARGET_NOT_ELIGIBLE'
              ? 'TARGET_NOT_ELIGIBLE'
              : 'CONFLICT',
        'Migration operation rejected.',
      );
    }
    throw e;
  }
}
export class MigrationApiService {
  readonly repository: MigrationRepository;
  readonly runs: UnifiedRunRepository;
  constructor(
    database: DatabaseClient,
    readonly realtime: RealtimeEventPublisher,
    readonly clock: () => Date = () => new Date(),
  ) {
    this.repository = new MigrationRepository(database);
    this.runs = new UnifiedRunRepository(database);
  }
  changed(entityType: 'MIGRATION' | 'DELIVERY_RESOLUTION', entityId: string, accountId?: string) {
    try {
      this.realtime.publish({
        type: 'CONFIG_CHANGED',
        data: { entityType, entityId, ...(accountId ? { accountId } : {}) },
      });
    } catch {
      // A best-effort invalidation must not turn a committed mutation into an error.
    }
  }
}
