import type { Writable } from 'node:stream';

import type { BusinessDate, RuntimeEventType } from '@sparkkeeper/shared';
import pino, { type Logger } from 'pino';

import type { LogLevel, ObservabilityConfig } from '../config/ObservabilityConfig.js';
import { DailyRotatingFileStream, type RotationClock } from './DailyRotatingFileStream.js';

export const PINO_REDACT_PATHS = [
  'cookie',
  'cookies',
  'authorization',
  'Authorization',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'password',
  'browserProfile',
  'userDataDir',
  'qrCode',
  'messageText',
  '*.cookie',
  '*.cookies',
  '*.authorization',
  '*.Authorization',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.password',
  '*.browserProfile',
  '*.userDataDir',
  '*.qrCode',
  '*.messageText',
] as const;

export interface RuntimeLogContext {
  readonly runId?: string;
  readonly accountId?: string;
  readonly friendId?: string;
  readonly attempt?: number;
  readonly businessDate?: BusinessDate;
}

export interface RuntimeLogEvent extends RuntimeLogContext {
  readonly eventType: RuntimeEventType;
  readonly errorCode?: string;
  readonly nextRetryAt?: Date;
  readonly successCount?: number;
  readonly failedCount?: number;
  readonly retryWaitCount?: number;
  readonly idempotentSkipCount?: number;
  readonly runResult?: 'SUCCESS' | 'FAILED' | 'AUTH_EXPIRED' | 'RETRY_WAIT' | 'SKIPPED';
}

const SAFE_EVENT_MESSAGES: Record<RuntimeEventType, string> = {
  RUN_STARTED: 'Daily run started',
  RUN_FINISHED: 'Daily run finished',
  AUTH_CHECKING: 'Authentication is being checked',
  AUTH_EXPIRED: 'Authentication expired',
  AUTH_UNKNOWN: 'Authentication state is unknown',
  FRIEND_RESOLVING: 'Contact resolution started',
  CONTACT_NOT_FOUND: 'Contact resolution failed',
  AMBIGUOUS_CONTACT: 'Contact resolution is ambiguous',
  MESSAGE_BUILDING: 'Message generation started',
  MESSAGE_SENDING: 'Message sending started',
  VERIFYING: 'Delivery verification started',
  VERIFY_SUCCESS: 'Delivery verification succeeded',
  RETRY_WAIT: 'Task is waiting for a retry',
  TASK_FAILED: 'Task finished with failure',
  SELECTOR_FAILURE: 'Page selector resolution failed',
  BROWSER_ERROR: 'Browser operation failed',
  DELIVERY_UNKNOWN: 'Delivery result is uncertain',
  CONVERSATION_VERIFICATION_FAILED: 'Conversation verification failed',
  SKIPPED_IDEMPOTENT: 'Task skipped because success is already recorded',
  CONSECUTIVE_RUN_FAILURE: 'Multiple consecutive runs failed',
  OBSERVABILITY_ERROR: 'Observability operation failed',
};

export class RuntimeLogWriter {
  constructor(protected readonly logger: Logger) {}

  child(context: RuntimeLogContext): RuntimeLogWriter {
    return new RuntimeLogWriter(this.logger.child(selectContext(context)));
  }

  emit(level: LogLevel, event: RuntimeLogEvent): void {
    const fields = {
      ...selectContext(event),
      eventType: event.eventType,
      errorCode: event.errorCode,
      nextRetryAt: event.nextRetryAt?.toISOString(),
      successCount: event.successCount,
      failedCount: event.failedCount,
      retryWaitCount: event.retryWaitCount,
      idempotentSkipCount: event.idempotentSkipCount,
      runResult: event.runResult,
      message: safeEventMessage(event.eventType),
    };
    if (level === 'debug') this.logger.debug(fields);
    else if (level === 'info') this.logger.info(fields);
    else if (level === 'warn') this.logger.warn(fields);
    else this.logger.error(fields);
  }
}

export class RuntimeLogger extends RuntimeLogWriter {
  constructor(
    logger: Logger,
    readonly fileDestination?: DailyRotatingFileStream,
  ) {
    super(logger);
  }

  async close(): Promise<void> {
    this.logger.flush();
    const destination = this.fileDestination;
    if (destination !== undefined && !destination.destroyed) {
      await new Promise<void>((resolve, reject) => {
        destination.once('error', reject);
        destination.end(resolve);
      });
    }
  }
}

export interface CreateRuntimeLoggerOptions {
  readonly level: LogLevel;
  readonly stdout?: Writable;
  readonly fileDestination?: DailyRotatingFileStream;
}

export function createRuntimeLogger(options: CreateRuntimeLoggerOptions): RuntimeLogger {
  const streams: pino.StreamEntry[] = [];
  if (options.stdout !== undefined) streams.push({ stream: options.stdout });
  if (options.fileDestination !== undefined) streams.push({ stream: options.fileDestination });
  if (streams.length === 0) throw new Error('Runtime logger requires at least one destination.');
  const destination = streams.length === 1 ? streams[0]!.stream : pino.multistream(streams);
  const logger = pino(
    {
      level: options.level,
      base: null,
      redact: { paths: [...PINO_REDACT_PATHS], censor: '[REDACTED]' },
    },
    destination,
  );
  return new RuntimeLogger(logger, options.fileDestination);
}

export function createProductionRuntimeLogger(
  config: ObservabilityConfig,
  stdout: Writable = process.stdout,
  clock?: RotationClock,
): RuntimeLogger {
  const fileDestination = new DailyRotatingFileStream(
    config.logDirectory,
    config.logRetentionDays,
    clock,
  );
  return createRuntimeLogger({ level: config.logLevel, stdout, fileDestination });
}

export function safeEventMessage(eventType: RuntimeEventType): string {
  return SAFE_EVENT_MESSAGES[eventType];
}

function selectContext(context: RuntimeLogContext): RuntimeLogContext {
  const selected: {
    runId?: string;
    accountId?: string;
    friendId?: string;
    attempt?: number;
    businessDate?: BusinessDate;
  } = {};
  if (context.runId !== undefined) selected.runId = context.runId;
  if (context.accountId !== undefined) selected.accountId = context.accountId;
  if (context.friendId !== undefined) selected.friendId = context.friendId;
  if (context.attempt !== undefined) selected.attempt = context.attempt;
  if (context.businessDate !== undefined) selected.businessDate = context.businessDate;
  return selected;
}
