import type { BusinessDate, RuntimeEventType, SystemEventLevel } from '@sparkkeeper/shared';

import type { RuntimeLogEvent } from './RuntimeLogger.js';

export interface RuntimeObservation extends RuntimeLogEvent {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly persist?: boolean;
  readonly captureScreenshot?: boolean;
}

export interface RuntimeRunContext {
  readonly runId: string;
  readonly accountId: string;
  readonly businessDate: BusinessDate;
}

export type RuntimeRunResult = 'SUCCESS' | 'FAILED' | 'AUTH_EXPIRED' | 'RETRY_WAIT' | 'SKIPPED';

export interface RuntimeObserver {
  observe(event: RuntimeObservation): Promise<void>;
  startRun(context: RuntimeRunContext): Promise<void>;
  finishRun(
    context: RuntimeRunContext,
    result: RuntimeRunResult,
    evidenceFailed: boolean,
  ): Promise<void>;
  cleanup(): Promise<void>;
}

export class NoopRuntimeObserver implements RuntimeObserver {
  async observe(): Promise<void> {}
  async startRun(): Promise<void> {}
  async finishRun(): Promise<void> {}
  async cleanup(): Promise<void> {}
}

export function systemEventLevel(level: RuntimeObservation['level']): SystemEventLevel {
  if (level === 'error') return 'ERROR';
  if (level === 'warn') return 'WARN';
  return 'INFO';
}

export function defaultSystemEventPersistence(eventType: RuntimeEventType): boolean {
  return IMPORTANT_SYSTEM_EVENTS.has(eventType);
}

export function defaultScreenshotCapture(eventType: RuntimeEventType): boolean {
  return SCREENSHOT_EVENTS.has(eventType);
}

const IMPORTANT_SYSTEM_EVENTS = new Set<RuntimeEventType>([
  'AUTH_EXPIRED',
  'AUTH_UNKNOWN',
  'SELECTOR_FAILURE',
  'BROWSER_ERROR',
  'CONTACT_NOT_FOUND',
  'AMBIGUOUS_CONTACT',
  'CONVERSATION_VERIFICATION_FAILED',
  'DELIVERY_UNKNOWN',
  'TASK_FAILED',
  'CONSECUTIVE_RUN_FAILURE',
  'OBSERVABILITY_ERROR',
]);

const SCREENSHOT_EVENTS = new Set<RuntimeEventType>([
  'AUTH_EXPIRED',
  'CONTACT_NOT_FOUND',
  'AMBIGUOUS_CONTACT',
  'SELECTOR_FAILURE',
  'CONVERSATION_VERIFICATION_FAILED',
  'DELIVERY_UNKNOWN',
  'TASK_FAILED',
]);
