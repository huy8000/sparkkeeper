import { eq } from 'drizzle-orm';

import type { DatabaseClient } from '../client/DatabaseClient.js';
import { notificationConfigs, type NotificationConfigRow } from '../schema/index.js';

const CONFIGURATION_ID = 1;

export interface NotificationConfig {
  readonly enabled: boolean;
  readonly provider: 'WEBHOOK';
  readonly webhookUrl: string | null;
  readonly notifyAuthExpired: boolean;
  readonly notifyTaskFailed: boolean;
  readonly notifyConsecutiveFailure: boolean;
  readonly notifyDeliveryUnknown: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SaveNotificationConfigInput {
  readonly enabled: boolean;
  readonly provider: 'WEBHOOK';
  readonly webhookUrl: string | null;
  readonly notifyAuthExpired: boolean;
  readonly notifyTaskFailed: boolean;
  readonly notifyConsecutiveFailure: boolean;
  readonly notifyDeliveryUnknown: boolean;
  readonly now?: Date;
}

export class NotificationConfigRepositoryError extends Error {
  constructor(
    readonly operation: 'get' | 'save',
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'NotificationConfigRepositoryError';
  }
}

export class NotificationConfigRepository {
  constructor(private readonly client: DatabaseClient) {}

  get(): NotificationConfig | undefined {
    try {
      const row = this.client.orm
        .select()
        .from(notificationConfigs)
        .where(eq(notificationConfigs.id, CONFIGURATION_ID))
        .get();
      return row === undefined ? undefined : mapRow(row);
    } catch (error) {
      throw new NotificationConfigRepositoryError(
        'get',
        'Failed to read notification configuration.',
        error,
      );
    }
  }

  save(input: SaveNotificationConfigInput): NotificationConfig {
    try {
      const now = input.now ?? new Date();
      const webhookUrl = normalizedUrl(input.webhookUrl);
      const existing = this.client.orm
        .select({ createdAt: notificationConfigs.createdAt })
        .from(notificationConfigs)
        .where(eq(notificationConfigs.id, CONFIGURATION_ID))
        .get();
      const values = {
        id: CONFIGURATION_ID,
        enabled: input.enabled,
        provider: input.provider,
        webhookUrl,
        notifyAuthExpired: input.notifyAuthExpired,
        notifyTaskFailed: input.notifyTaskFailed,
        notifyConsecutiveFailure: input.notifyConsecutiveFailure,
        notifyDeliveryUnknown: input.notifyDeliveryUnknown,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      } as const;
      const row =
        existing === undefined
          ? this.client.orm.insert(notificationConfigs).values(values).returning().get()
          : this.client.orm
              .update(notificationConfigs)
              .set(values)
              .where(eq(notificationConfigs.id, CONFIGURATION_ID))
              .returning()
              .get();
      if (row === undefined) {
        throw new NotificationConfigRepositoryError(
          'save',
          'Notification configuration was not persisted.',
        );
      }
      return mapRow(row);
    } catch (error) {
      if (error instanceof NotificationConfigRepositoryError) throw error;
      throw new NotificationConfigRepositoryError(
        'save',
        'Failed to save notification configuration.',
        error,
      );
    }
  }
}

function normalizedUrl(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new NotificationConfigRepositoryError(
      'save',
      'Webhook URL must not be empty when configured.',
    );
  }
  return trimmed;
}

function mapRow(row: NotificationConfigRow): NotificationConfig {
  return {
    enabled: row.enabled,
    provider: row.provider,
    webhookUrl: row.webhookUrl,
    notifyAuthExpired: row.notifyAuthExpired,
    notifyTaskFailed: row.notifyTaskFailed,
    notifyConsecutiveFailure: row.notifyConsecutiveFailure,
    notifyDeliveryUnknown: row.notifyDeliveryUnknown,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
