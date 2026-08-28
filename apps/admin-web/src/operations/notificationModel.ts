import type { NotificationConfiguration, NotificationConfigurationInput } from '../types/api';

export interface NotificationDraft {
  enabled: boolean;
  provider: 'WEBHOOK';
  webhookUrl: string;
  notifyAuthExpired: boolean;
  notifyTaskFailed: boolean;
  notifyConsecutiveFailure: boolean;
  notifyDeliveryUnknown: boolean;
}

export function notificationDraftFrom(configuration: NotificationConfiguration): NotificationDraft {
  return {
    enabled: configuration.enabled,
    provider: configuration.provider,
    webhookUrl: configuration.webhookUrl ?? '',
    notifyAuthExpired: configuration.notifyAuthExpired,
    notifyTaskFailed: configuration.notifyTaskFailed,
    notifyConsecutiveFailure: configuration.notifyConsecutiveFailure,
    notifyDeliveryUnknown: configuration.notifyDeliveryUnknown,
  };
}

export function notificationInputFrom(draft: NotificationDraft): NotificationConfigurationInput {
  const webhookUrl = draft.webhookUrl.trim();
  return {
    enabled: draft.enabled,
    provider: draft.provider,
    webhookUrl: webhookUrl === '' ? null : webhookUrl,
    notifyAuthExpired: draft.notifyAuthExpired,
    notifyTaskFailed: draft.notifyTaskFailed,
    notifyConsecutiveFailure: draft.notifyConsecutiveFailure,
    notifyDeliveryUnknown: draft.notifyDeliveryUnknown,
  };
}

export function validateNotificationDraft(draft: NotificationDraft): string {
  if (draft.enabled && draft.webhookUrl.trim() === '') {
    return 'Webhook URL is required while notifications are enabled.';
  }
  return '';
}

export function notificationDraftMatches(
  draft: NotificationDraft,
  configuration: NotificationConfiguration,
): boolean {
  const original = notificationDraftFrom(configuration);
  return (
    draft.enabled === original.enabled &&
    draft.provider === original.provider &&
    draft.webhookUrl === original.webhookUrl &&
    draft.notifyAuthExpired === original.notifyAuthExpired &&
    draft.notifyTaskFailed === original.notifyTaskFailed &&
    draft.notifyConsecutiveFailure === original.notifyConsecutiveFailure &&
    draft.notifyDeliveryUnknown === original.notifyDeliveryUnknown
  );
}

export function isNotificationConfigured(configuration: NotificationConfiguration): boolean {
  return configuration.webhookUrl !== null;
}
