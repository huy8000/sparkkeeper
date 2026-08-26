import type { NotificationConfiguration, NotificationEventCandidate } from './Notification.js';

export type NotificationDecision = 'SEND' | 'IGNORE';

export class NotificationPolicy {
  decide(
    candidate: NotificationEventCandidate,
    configuration: NotificationConfiguration,
  ): NotificationDecision {
    if (!configuration.enabled || configuration.provider !== 'WEBHOOK') return 'IGNORE';
    switch (candidate.eventType) {
      case 'AUTH_EXPIRED':
        return configuration.notifyAuthExpired ? 'SEND' : 'IGNORE';
      case 'TASK_FAILED':
        return configuration.notifyTaskFailed ? 'SEND' : 'IGNORE';
      case 'CONSECUTIVE_RUN_FAILURE':
        return configuration.notifyConsecutiveFailure ? 'SEND' : 'IGNORE';
      case 'DELIVERY_UNKNOWN':
        return configuration.notifyDeliveryUnknown ? 'SEND' : 'IGNORE';
      default:
        return 'IGNORE';
    }
  }
}
