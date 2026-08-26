import type { NotificationConfigRepository } from '@sparkkeeper/database';
import {
  DEFAULT_NOTIFICATION_CONFIGURATION,
  type NotificationConfiguration,
  type NotificationConfigurationSource,
} from '@sparkkeeper/notifier';

export class DatabaseNotificationConfigurationSource implements NotificationConfigurationSource {
  constructor(private readonly repository: Pick<NotificationConfigRepository, 'get'>) {}

  get(): NotificationConfiguration {
    const configuration = this.repository.get();
    if (configuration === undefined) return DEFAULT_NOTIFICATION_CONFIGURATION;
    return {
      enabled: configuration.enabled,
      provider: configuration.provider,
      webhookUrl: configuration.webhookUrl,
      notifyAuthExpired: configuration.notifyAuthExpired,
      notifyTaskFailed: configuration.notifyTaskFailed,
      notifyConsecutiveFailure: configuration.notifyConsecutiveFailure,
      notifyDeliveryUnknown: configuration.notifyDeliveryUnknown,
    };
  }
}
