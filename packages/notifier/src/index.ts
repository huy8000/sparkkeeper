// Public package entry point. Notification behavior is intentionally deferred beyond Phase 0.
export {
  DEFAULT_NOTIFICATION_CONFIGURATION,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_PROVIDER_TYPES,
  toNotificationPayload,
  type NotificationConfiguration,
  type NotificationEventCandidate,
  type NotificationEventType,
  type NotificationPayload,
  type NotificationPayloadEventType,
  type NotificationProviderType,
  type NotificationSeverity,
} from './Notification.js';
export { NotificationPolicy, type NotificationDecision } from './NotificationPolicy.js';
export {
  NodeHostAddressResolver,
  PublicDestinationPolicy,
  WebhookDestinationError,
  type HostAddressResolver,
  type ResolvedHostAddress,
  type ValidatedWebhookDestination,
  type WebhookDestinationErrorCode,
} from './PublicDestinationPolicy.js';
export {
  NodeWebhookTransport,
  WebhookProvider,
  WebhookTransportError,
  type NotificationDeliveryFailureCode,
  type NotificationDeliveryResult,
  type WebhookProviderOptions,
  type WebhookTransport,
  type WebhookTransportRequest,
  type WebhookTransportResponse,
} from './WebhookProvider.js';
export {
  NotificationService,
  type NotificationConfigurationSource,
  type NotificationDeliveryStatus,
  type NotificationProvider,
  type NotificationServiceOptions,
  type NotificationServiceStatus,
} from './NotificationService.js';
