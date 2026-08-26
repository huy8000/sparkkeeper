import type { NotificationConfig, NotificationConfigRepository } from '@sparkkeeper/database';
import {
  DEFAULT_NOTIFICATION_CONFIGURATION,
  WebhookDestinationError,
  type NotificationDeliveryResult,
  type NotificationService,
  type PublicDestinationPolicy,
} from '@sparkkeeper/notifier';

import type { RealtimeEventPublisher } from '../../realtime/RealtimeEvent.js';
import { ApiError } from '../errors/ApiError.js';

export interface NotificationConfigurationInput {
  readonly enabled: boolean;
  readonly provider: 'WEBHOOK';
  readonly webhookUrl: string | null;
  readonly notifyAuthExpired: boolean;
  readonly notifyTaskFailed: boolean;
  readonly notifyConsecutiveFailure: boolean;
  readonly notifyDeliveryUnknown: boolean;
}

export interface NotificationConfigurationDto extends NotificationConfigurationInput {
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface NotificationConfigurationServiceOptions {
  readonly repository: Pick<NotificationConfigRepository, 'get' | 'save'>;
  readonly addressPolicy: Pick<PublicDestinationPolicy, 'resolve'>;
  readonly notifications: Pick<NotificationService, 'sendTest'>;
  readonly realtime?: RealtimeEventPublisher;
  readonly clock?: () => Date;
}

export class NotificationConfigurationService {
  private readonly clock: () => Date;

  constructor(private readonly options: NotificationConfigurationServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  get(): NotificationConfigurationDto {
    return toDto(this.options.repository.get());
  }

  async update(input: NotificationConfigurationInput): Promise<NotificationConfigurationDto> {
    const webhookUrl = normalizedWebhookUrl(input.webhookUrl);
    if (input.enabled && webhookUrl === null) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'An enabled notification configuration requires a Webhook URL.',
      );
    }
    if (webhookUrl !== null) await this.validateDestination(webhookUrl);
    const configuration = this.options.repository.save({
      ...input,
      webhookUrl,
      now: this.clock(),
    });
    this.publishChanged();
    return toDto(configuration);
  }

  async sendTest(): Promise<NotificationDeliveryResult> {
    return this.options.notifications.sendTest();
  }

  private async validateDestination(webhookUrl: string): Promise<void> {
    try {
      await this.options.addressPolicy.resolve(webhookUrl);
    } catch (error) {
      if (error instanceof WebhookDestinationError) {
        throw new ApiError(
          400,
          error.code === 'DESTINATION_BLOCKED' ? 'WEBHOOK_DESTINATION_BLOCKED' : 'VALIDATION_ERROR',
          error.code === 'DESTINATION_BLOCKED'
            ? 'Webhook destination is not permitted.'
            : 'Webhook configuration is invalid.',
        );
      }
      throw new ApiError(
        400,
        'WEBHOOK_DESTINATION_BLOCKED',
        'Webhook destination could not be safely validated.',
      );
    }
  }

  private publishChanged(): void {
    try {
      this.options.realtime?.publish({
        type: 'CONFIG_CHANGED',
        data: { entityType: 'NOTIFICATION', entityId: 'notification-config' },
      });
    } catch {
      // Realtime invalidation cannot make a persisted configuration mutation fail.
    }
  }
}

function normalizedWebhookUrl(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Webhook URL must not be empty.');
  }
  return trimmed;
}

function toDto(configuration: NotificationConfig | undefined): NotificationConfigurationDto {
  if (configuration === undefined) {
    return {
      ...DEFAULT_NOTIFICATION_CONFIGURATION,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    enabled: configuration.enabled,
    provider: configuration.provider,
    webhookUrl: configuration.webhookUrl,
    notifyAuthExpired: configuration.notifyAuthExpired,
    notifyTaskFailed: configuration.notifyTaskFailed,
    notifyConsecutiveFailure: configuration.notifyConsecutiveFailure,
    notifyDeliveryUnknown: configuration.notifyDeliveryUnknown,
    createdAt: configuration.createdAt.toISOString(),
    updatedAt: configuration.updatedAt.toISOString(),
  };
}
