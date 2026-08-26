import {
  type NotificationConfiguration,
  type NotificationEventCandidate,
  isNotificationEventType,
  type NotificationPayload,
  toNotificationPayload,
} from './Notification.js';
import { NotificationPolicy } from './NotificationPolicy.js';
import type { NotificationDeliveryResult } from './WebhookProvider.js';

export interface NotificationConfigurationSource {
  get(): NotificationConfiguration;
}

export interface NotificationProvider {
  send(payload: NotificationPayload, webhookUrl: string): Promise<NotificationDeliveryResult>;
}

export interface NotificationDeliveryStatus {
  readonly eventType: NotificationPayload['eventType'];
  readonly result: NotificationDeliveryResult;
  readonly timestamp: string;
}

export interface NotificationServiceStatus {
  readonly accepting: boolean;
  readonly inFlightCount: number;
  readonly lastDelivery: NotificationDeliveryStatus | null;
}

export interface NotificationServiceOptions {
  readonly configuration: NotificationConfigurationSource;
  readonly provider: NotificationProvider;
  readonly policy?: NotificationPolicy;
  readonly clock?: () => Date;
  readonly onDelivery?: (status: NotificationDeliveryStatus) => void;
}

export class NotificationService {
  private readonly policy: NotificationPolicy;
  private readonly clock: () => Date;
  private readonly inFlight = new Set<Promise<void>>();
  private accepting = true;
  private lastDelivery: NotificationDeliveryStatus | null = null;

  constructor(private readonly options: NotificationServiceOptions) {
    this.policy = options.policy ?? new NotificationPolicy();
    this.clock = options.clock ?? (() => new Date());
  }

  publish(candidate: NotificationEventCandidate): void {
    if (!this.accepting) return;
    try {
      const configuration = this.options.configuration.get();
      if (
        configuration.webhookUrl === null ||
        this.policy.decide(candidate, configuration) !== 'SEND' ||
        !isNotificationEventType(candidate.eventType)
      ) {
        return;
      }
      const sendableCandidate = { ...candidate, eventType: candidate.eventType };
      this.track(
        this.deliver(
          toNotificationPayload(sendableCandidate),
          configuration.webhookUrl,
          candidate.timestamp,
        ).then(() => undefined),
      );
    } catch {
      // Notification configuration and scheduling are non-critical observability side effects.
    }
  }

  async sendTest(): Promise<NotificationDeliveryResult> {
    if (!this.accepting) return blockedInvalidConfig();
    let configuration: NotificationConfiguration;
    try {
      configuration = this.options.configuration.get();
    } catch {
      return blockedInvalidConfig();
    }
    if (configuration.webhookUrl === null) return blockedInvalidConfig();
    const timestamp = this.clock().toISOString();
    return this.deliver(
      {
        serviceName: 'SparkKeeper',
        eventType: 'NOTIFICATION_TEST',
        severity: 'WARN',
        message: 'SparkKeeper notification test',
        timestamp,
      },
      configuration.webhookUrl,
      timestamp,
    );
  }

  status(): NotificationServiceStatus {
    return {
      accepting: this.accepting,
      inFlightCount: this.inFlight.size,
      lastDelivery: this.lastDelivery,
    };
  }

  async stop(): Promise<void> {
    this.accepting = false;
    await Promise.allSettled([...this.inFlight]);
  }

  private track(delivery: Promise<void>): void {
    this.inFlight.add(delivery);
    void delivery.then(
      () => this.inFlight.delete(delivery),
      () => this.inFlight.delete(delivery),
    );
  }

  private async deliver(
    payload: NotificationPayload,
    webhookUrl: string,
    timestamp: string,
  ): Promise<NotificationDeliveryResult> {
    let result: NotificationDeliveryResult;
    try {
      result = await this.options.provider.send(payload, webhookUrl);
    } catch {
      result = {
        status: 'FAILED',
        attempts: 1,
        failureCode: 'NETWORK_ERROR',
      };
    }
    const status: NotificationDeliveryStatus = {
      eventType: payload.eventType,
      result,
      timestamp,
    };
    this.lastDelivery = status;
    try {
      this.options.onDelivery?.(status);
    } catch {
      // Delivery diagnostics cannot cause a notification or business failure.
    }
    return result;
  }
}

function blockedInvalidConfig(): NotificationDeliveryResult {
  return { status: 'BLOCKED', attempts: 0, failureCode: 'INVALID_CONFIG' };
}
