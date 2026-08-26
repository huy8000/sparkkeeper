import type { NotificationPayload } from './Notification.js';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  WebhookDestinationError,
  type PublicDestinationPolicy,
  type ValidatedWebhookDestination,
} from './PublicDestinationPolicy.js';

export type NotificationDeliveryFailureCode =
  'TIMEOUT' | 'NETWORK_ERROR' | 'HTTP_ERROR' | 'DESTINATION_BLOCKED' | 'INVALID_CONFIG';

export type NotificationDeliveryResult =
  | { readonly status: 'SENT'; readonly attempts: number; readonly httpStatus: number }
  | {
      readonly status: 'FAILED';
      readonly attempts: number;
      readonly failureCode: 'TIMEOUT' | 'NETWORK_ERROR' | 'HTTP_ERROR';
      readonly httpStatus?: number;
    }
  | {
      readonly status: 'BLOCKED';
      readonly attempts: 0;
      readonly failureCode: 'DESTINATION_BLOCKED' | 'INVALID_CONFIG';
    };

export interface WebhookTransportRequest {
  readonly destination: ValidatedWebhookDestination;
  readonly payload: NotificationPayload;
  readonly timeoutMs: number;
}

export interface WebhookTransportResponse {
  readonly statusCode: number;
}

export interface WebhookTransport {
  deliver(request: WebhookTransportRequest): Promise<WebhookTransportResponse>;
}

export class WebhookTransportError extends Error {
  constructor(readonly code: 'TIMEOUT' | 'NETWORK_ERROR') {
    super(code === 'TIMEOUT' ? 'Webhook request timed out.' : 'Webhook network request failed.');
    this.name = 'WebhookTransportError';
  }
}

export interface WebhookProviderOptions {
  readonly addressPolicy: Pick<PublicDestinationPolicy, 'resolve'>;
  readonly transport: WebhookTransport;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export class NodeWebhookTransport implements WebhookTransport {
  deliver(request: WebhookTransportRequest): Promise<WebhookTransportResponse> {
    const body = JSON.stringify(request.payload);
    const destinationUrl = request.destination.url;
    const pinnedAddress = request.destination.addresses[0];
    if (pinnedAddress === undefined) {
      return Promise.reject(new WebhookTransportError('NETWORK_ERROR'));
    }
    const options: RequestOptions = {
      protocol: destinationUrl.protocol,
      hostname: pinnedAddress.address,
      port: destinationUrl.port === '' ? undefined : Number(destinationUrl.port),
      method: 'POST',
      path: `${destinationUrl.pathname}${destinationUrl.search}`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Host: destinationUrl.host,
      },
      ...(destinationUrl.protocol === 'https:' &&
      isIP(normalizedHostname(destinationUrl.hostname)) === 0
        ? { servername: normalizedHostname(destinationUrl.hostname) }
        : {}),
    };

    return new Promise<WebhookTransportResponse>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        action();
      };
      const requester = destinationUrl.protocol === 'https:' ? httpsRequest : httpRequest;
      const clientRequest = requester(options, (response) => {
        const statusCode = response.statusCode ?? 0;
        response.destroy();
        finish(() => resolve({ statusCode }));
      });
      const timeout = setTimeout(() => {
        clientRequest.destroy(new WebhookTransportError('TIMEOUT'));
      }, request.timeoutMs);
      clientRequest.once('error', (error) => {
        finish(() =>
          reject(
            error instanceof WebhookTransportError
              ? error
              : new WebhookTransportError('NETWORK_ERROR'),
          ),
        );
      });
      clientRequest.end(body);
    });
  }
}

function normalizedHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

export class WebhookProvider {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: WebhookProviderOptions) {
    this.timeoutMs = boundedInteger(options.timeoutMs ?? 5_000, 100, 30_000, 'timeout');
    this.maxAttempts = boundedInteger(options.maxAttempts ?? 3, 1, 3, 'attempt count');
    this.initialBackoffMs = boundedInteger(options.initialBackoffMs ?? 250, 0, 5_000, 'backoff');
    this.sleep = options.sleep ?? sleep;
  }

  async send(
    payload: NotificationPayload,
    webhookUrl: string,
  ): Promise<NotificationDeliveryResult> {
    let destination: ValidatedWebhookDestination;
    try {
      destination = await this.options.addressPolicy.resolve(webhookUrl);
    } catch (error) {
      if (error instanceof WebhookDestinationError) {
        return {
          status: 'BLOCKED',
          attempts: 0,
          failureCode: error.code,
        };
      }
      return { status: 'BLOCKED', attempts: 0, failureCode: 'DESTINATION_BLOCKED' };
    }

    let lastFailure:
      | { readonly code: 'TIMEOUT' | 'NETWORK_ERROR' | 'HTTP_ERROR'; readonly status?: number }
      | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.options.transport.deliver({
          destination,
          payload,
          timeoutMs: this.timeoutMs,
        });
        if (response.statusCode >= 200 && response.statusCode < 300) {
          return { status: 'SENT', attempts: attempt, httpStatus: response.statusCode };
        }
        lastFailure = { code: 'HTTP_ERROR', status: response.statusCode };
        if (!isRetryableHttpStatus(response.statusCode)) {
          return failedResult(attempt, lastFailure);
        }
      } catch (error) {
        lastFailure = {
          code: error instanceof WebhookTransportError ? error.code : 'NETWORK_ERROR',
        };
      }

      if (attempt < this.maxAttempts) {
        await this.sleep(this.initialBackoffMs * 2 ** (attempt - 1));
      }
    }
    return failedResult(this.maxAttempts, lastFailure ?? { code: 'NETWORK_ERROR' });
  }
}

function isRetryableHttpStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function failedResult(
  attempts: number,
  failure: { readonly code: 'TIMEOUT' | 'NETWORK_ERROR' | 'HTTP_ERROR'; readonly status?: number },
): NotificationDeliveryResult {
  return {
    status: 'FAILED',
    attempts,
    failureCode: failure.code,
    ...(failure.status === undefined ? {} : { httpStatus: failure.status }),
  };
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Webhook ${label} is outside its safe range.`);
  }
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
