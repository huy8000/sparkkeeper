import { and, asc, eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { RepositoryError, type RepositoryErrorCode } from '../errors/RepositoryError.js';
import {
  contacts,
  legacyFriendBindings,
  legacyScheduleImports,
  sendTasks,
  type LegacyFriendBindingRow,
  type LegacyScheduleImportRow,
} from '../schema/index.js';

export type LegacyFriendBinding = LegacyFriendBindingRow;
export type LegacyScheduleImport = LegacyScheduleImportRow;

export class LegacyBridgeRepositoryError extends RepositoryError {
  readonly bridgeOperation:
    | 'bindFriend'
    | 'dismissFriend'
    | 'findFriendBinding'
    | 'listPendingFriendBindings'
    | 'convertSchedule'
    | 'dismissSchedule'
    | 'findScheduleImport'
    | 'listPendingScheduleImports';

  constructor(
    operation: LegacyBridgeRepositoryError['bridgeOperation'],
    code: RepositoryErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(code, message, { entityName: 'LegacyBridge', operation, cause });
    this.name = 'LegacyBridgeRepositoryError';
    this.bridgeOperation = operation;
  }
}

export class LegacyBridgeRepository {
  constructor(private readonly client: DatabaseClient) {}

  bindFriend(input: {
    friendId: string;
    contactId: string;
    adminUserId: string;
    now?: Date;
  }): LegacyFriendBinding {
    const friendId = input.friendId.trim();
    const contactId = input.contactId.trim();
    const adminUserId = input.adminUserId.trim();

    if (friendId.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'bindFriend',
        'VALIDATION_ERROR',
        'friendId must not be empty.',
      );
    }
    if (contactId.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'bindFriend',
        'VALIDATION_ERROR',
        'contactId must not be empty.',
      );
    }
    if (adminUserId.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'bindFriend',
        'VALIDATION_ERROR',
        'adminUserId must not be empty.',
      );
    }

    const timestamp = input.now ?? new Date();
    try {
      return this.client.orm.transaction((tx) => {
        const existing = tx
          .select()
          .from(legacyFriendBindings)
          .where(eq(legacyFriendBindings.friendId, friendId))
          .get();

        if (!existing) {
          throw new LegacyBridgeRepositoryError(
            'bindFriend',
            'NOT_FOUND',
            'Legacy friend binding record not found.',
          );
        }
        if (existing.status !== 'PENDING') {
          throw new LegacyBridgeRepositoryError(
            'bindFriend',
            'TERMINAL_STATE',
            `Cannot bind legacy friend in status '${existing.status}'.`,
          );
        }

        const contact = tx.select().from(contacts).where(eq(contacts.id, contactId)).get();
        if (!contact) {
          throw new LegacyBridgeRepositoryError(
            'bindFriend',
            'NOT_FOUND',
            `Target contact '${contactId}' not found.`,
          );
        }
        if (contact.accountId !== existing.accountId) {
          throw new LegacyBridgeRepositoryError(
            'bindFriend',
            'ACCOUNT_MISMATCH',
            `Target contact account '${contact.accountId}' does not match legacy friend account '${existing.accountId}'.`,
          );
        }

        return tx
          .update(legacyFriendBindings)
          .set({
            status: 'BOUND',
            contactId,
            boundByAdminUserId: adminUserId,
            boundAt: timestamp,
            dismissedAt: null,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(legacyFriendBindings.friendId, friendId),
              eq(legacyFriendBindings.status, 'PENDING'),
            ),
          )
          .returning()
          .get();
      });
    } catch (error) {
      if (error instanceof LegacyBridgeRepositoryError) throw error;
      throw new LegacyBridgeRepositoryError(
        'bindFriend',
        'INTEGRITY_ERROR',
        'Failed to bind legacy friend.',
        error,
      );
    }
  }

  dismissFriend(friendId: string, now?: Date): LegacyFriendBinding {
    const trimmedFriend = friendId.trim();
    if (trimmedFriend.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'dismissFriend',
        'VALIDATION_ERROR',
        'friendId must not be empty.',
      );
    }

    const timestamp = now ?? new Date();
    try {
      return this.client.orm.transaction((tx) => {
        const existing = tx
          .select()
          .from(legacyFriendBindings)
          .where(eq(legacyFriendBindings.friendId, trimmedFriend))
          .get();

        if (!existing) {
          throw new LegacyBridgeRepositoryError(
            'dismissFriend',
            'NOT_FOUND',
            'Legacy friend binding record not found.',
          );
        }
        if (existing.status !== 'PENDING') {
          throw new LegacyBridgeRepositoryError(
            'dismissFriend',
            'TERMINAL_STATE',
            `Cannot dismiss legacy friend in status '${existing.status}'.`,
          );
        }

        return tx
          .update(legacyFriendBindings)
          .set({
            status: 'DISMISSED',
            contactId: null,
            boundByAdminUserId: null,
            boundAt: null,
            dismissedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(legacyFriendBindings.friendId, trimmedFriend),
              eq(legacyFriendBindings.status, 'PENDING'),
            ),
          )
          .returning()
          .get();
      });
    } catch (error) {
      if (error instanceof LegacyBridgeRepositoryError) throw error;
      throw new LegacyBridgeRepositoryError(
        'dismissFriend',
        'INTEGRITY_ERROR',
        'Failed to dismiss legacy friend.',
        error,
      );
    }
  }

  findFriendBinding(friendId: string): LegacyFriendBinding | undefined {
    const trimmed = friendId.trim();
    if (trimmed.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'findFriendBinding',
        'VALIDATION_ERROR',
        'friendId must not be empty.',
      );
    }

    try {
      return this.client.orm
        .select()
        .from(legacyFriendBindings)
        .where(eq(legacyFriendBindings.friendId, trimmed))
        .get();
    } catch (error) {
      throw new LegacyBridgeRepositoryError(
        'findFriendBinding',
        'INTEGRITY_ERROR',
        'Failed to find legacy friend binding.',
        error,
      );
    }
  }

  listPendingFriendBindings(
    accountId: string,
    options?: { limit?: number; offset?: number },
  ): LegacyFriendBinding[] {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'listPendingFriendBindings',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(legacyFriendBindings)
        .where(
          and(
            eq(legacyFriendBindings.accountId, trimmed),
            eq(legacyFriendBindings.status, 'PENDING'),
          ),
        )
        .orderBy(asc(legacyFriendBindings.createdAt), asc(legacyFriendBindings.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new LegacyBridgeRepositoryError(
        'listPendingFriendBindings',
        'INTEGRITY_ERROR',
        'Failed to list pending friend bindings.',
        error,
      );
    }
  }

  convertSchedule(input: {
    scheduleId: string;
    convertedTaskId: string;
    adminUserId: string;
    now?: Date;
  }): LegacyScheduleImport {
    const scheduleId = input.scheduleId.trim();
    const convertedTaskId = input.convertedTaskId.trim();
    const adminUserId = input.adminUserId.trim();

    if (scheduleId.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'convertSchedule',
        'VALIDATION_ERROR',
        'scheduleId must not be empty.',
      );
    }
    if (convertedTaskId.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'convertSchedule',
        'VALIDATION_ERROR',
        'convertedTaskId must not be empty.',
      );
    }
    if (adminUserId.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'convertSchedule',
        'VALIDATION_ERROR',
        'adminUserId must not be empty.',
      );
    }

    const timestamp = input.now ?? new Date();
    try {
      return this.client.orm.transaction((tx) => {
        const existing = tx
          .select()
          .from(legacyScheduleImports)
          .where(eq(legacyScheduleImports.scheduleId, scheduleId))
          .get();

        if (!existing) {
          throw new LegacyBridgeRepositoryError(
            'convertSchedule',
            'NOT_FOUND',
            'Legacy schedule import record not found.',
          );
        }
        if (existing.status !== 'PENDING') {
          throw new LegacyBridgeRepositoryError(
            'convertSchedule',
            'TERMINAL_STATE',
            `Cannot convert legacy schedule in status '${existing.status}'.`,
          );
        }

        const task = tx.select().from(sendTasks).where(eq(sendTasks.id, convertedTaskId)).get();
        if (!task) {
          throw new LegacyBridgeRepositoryError(
            'convertSchedule',
            'NOT_FOUND',
            `Converted send task '${convertedTaskId}' not found.`,
          );
        }
        if (task.accountId !== existing.accountId) {
          throw new LegacyBridgeRepositoryError(
            'convertSchedule',
            'ACCOUNT_MISMATCH',
            `Converted send task account '${task.accountId}' does not match legacy schedule account '${existing.accountId}'.`,
          );
        }

        return tx
          .update(legacyScheduleImports)
          .set({
            status: 'CONVERTED',
            convertedTaskId,
            convertedByAdminUserId: adminUserId,
            convertedAt: timestamp,
            dismissedAt: null,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(legacyScheduleImports.scheduleId, scheduleId),
              eq(legacyScheduleImports.status, 'PENDING'),
            ),
          )
          .returning()
          .get();
      });
    } catch (error) {
      if (error instanceof LegacyBridgeRepositoryError) throw error;
      throw new LegacyBridgeRepositoryError(
        'convertSchedule',
        'INTEGRITY_ERROR',
        'Failed to convert legacy schedule.',
        error,
      );
    }
  }

  dismissSchedule(scheduleId: string, now?: Date): LegacyScheduleImport {
    const trimmedSchedule = scheduleId.trim();
    if (trimmedSchedule.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'dismissSchedule',
        'VALIDATION_ERROR',
        'scheduleId must not be empty.',
      );
    }

    const timestamp = now ?? new Date();
    try {
      return this.client.orm.transaction((tx) => {
        const existing = tx
          .select()
          .from(legacyScheduleImports)
          .where(eq(legacyScheduleImports.scheduleId, trimmedSchedule))
          .get();

        if (!existing) {
          throw new LegacyBridgeRepositoryError(
            'dismissSchedule',
            'NOT_FOUND',
            'Legacy schedule import record not found.',
          );
        }
        if (existing.status !== 'PENDING') {
          throw new LegacyBridgeRepositoryError(
            'dismissSchedule',
            'TERMINAL_STATE',
            `Cannot dismiss legacy schedule in status '${existing.status}'.`,
          );
        }

        return tx
          .update(legacyScheduleImports)
          .set({
            status: 'DISMISSED',
            convertedTaskId: null,
            convertedByAdminUserId: null,
            convertedAt: null,
            dismissedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(legacyScheduleImports.scheduleId, trimmedSchedule),
              eq(legacyScheduleImports.status, 'PENDING'),
            ),
          )
          .returning()
          .get();
      });
    } catch (error) {
      if (error instanceof LegacyBridgeRepositoryError) throw error;
      throw new LegacyBridgeRepositoryError(
        'dismissSchedule',
        'INTEGRITY_ERROR',
        'Failed to dismiss legacy schedule.',
        error,
      );
    }
  }

  findScheduleImport(scheduleId: string): LegacyScheduleImport | undefined {
    const trimmed = scheduleId.trim();
    if (trimmed.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'findScheduleImport',
        'VALIDATION_ERROR',
        'scheduleId must not be empty.',
      );
    }

    try {
      return this.client.orm
        .select()
        .from(legacyScheduleImports)
        .where(eq(legacyScheduleImports.scheduleId, trimmed))
        .get();
    } catch (error) {
      throw new LegacyBridgeRepositoryError(
        'findScheduleImport',
        'INTEGRITY_ERROR',
        'Failed to find legacy schedule import.',
        error,
      );
    }
  }

  listPendingScheduleImports(
    accountId: string,
    options?: { limit?: number; offset?: number },
  ): LegacyScheduleImport[] {
    const trimmed = accountId.trim();
    if (trimmed.length === 0) {
      throw new LegacyBridgeRepositoryError(
        'listPendingScheduleImports',
        'VALIDATION_ERROR',
        'accountId must not be empty.',
      );
    }
    const limit = Math.min(Math.max(1, options?.limit ?? 50), 1000);
    const offset = Math.max(0, options?.offset ?? 0);

    try {
      return this.client.orm
        .select()
        .from(legacyScheduleImports)
        .where(
          and(
            eq(legacyScheduleImports.accountId, trimmed),
            eq(legacyScheduleImports.status, 'PENDING'),
          ),
        )
        .orderBy(asc(legacyScheduleImports.createdAt), asc(legacyScheduleImports.id))
        .limit(limit)
        .offset(offset)
        .all();
    } catch (error) {
      throw new LegacyBridgeRepositoryError(
        'listPendingScheduleImports',
        'INTEGRITY_ERROR',
        'Failed to list pending schedule imports.',
        error,
      );
    }
  }
}
