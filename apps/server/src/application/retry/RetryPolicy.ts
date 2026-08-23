import type {
  BusinessDate,
  ExternalActionState,
  RetryFailureCode,
  ScheduleTime,
} from '@sparkkeeper/shared';
import { validateMaxAttempts, validateRetryIntervalSeconds } from '@sparkkeeper/shared';

import { evaluateScheduleWindow } from '../../scheduler/ScheduleWindow.js';
import { classifyFailure, type FailureClassification } from './FailureClassifier.js';

export interface RetryPolicyInput {
  readonly failureCode: RetryFailureCode;
  readonly externalActionState: ExternalActionState;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly retryIntervalSeconds: number;
  readonly now: Date;
  readonly businessDate: BusinessDate;
  readonly timezone: string;
  readonly startTime: ScheduleTime;
  readonly endTime: ScheduleTime;
}

export type RetryDecision =
  | {
      readonly type: 'RETRY_SCHEDULED';
      readonly nextRetryAt: Date;
      readonly failureCode: RetryFailureCode;
      readonly scope: FailureClassification['scope'];
    }
  | {
      readonly type: 'FINAL_FAILED' | 'DELIVERY_UNKNOWN' | 'STOP_AUTH_EXPIRED';
      readonly failureCode: RetryFailureCode;
      readonly causeCode: RetryFailureCode;
      readonly scope: FailureClassification['scope'];
    };

export class RetryPolicy {
  decide(input: RetryPolicyInput): RetryDecision {
    if (!Number.isInteger(input.attemptCount) || input.attemptCount < 0) {
      throw new Error('attemptCount must be a non-negative integer.');
    }
    validateMaxAttempts(input.maxAttempts);
    validateRetryIntervalSeconds(input.retryIntervalSeconds);
    if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
      throw new Error('RetryPolicy requires a valid current timestamp.');
    }

    const classification = classifyFailure(input.failureCode, input.externalActionState);
    const nextRetryAt = new Date(input.now.getTime() + input.retryIntervalSeconds * 1_000);
    const nextWindow = evaluateScheduleWindow(
      nextRetryAt,
      input.timezone,
      input.startTime,
      input.endTime,
    );

    if (classification.deliveryUncertain) {
      return {
        type: 'DELIVERY_UNKNOWN',
        failureCode: 'DELIVERY_UNKNOWN',
        causeCode: input.failureCode,
        scope: 'RUN_GLOBAL',
      };
    }

    if (input.failureCode === 'AUTH_EXPIRED') {
      return {
        type: 'STOP_AUTH_EXPIRED',
        failureCode: 'AUTH_EXPIRED',
        causeCode: input.failureCode,
        scope: 'RUN_GLOBAL',
      };
    }

    if (
      classification.retryable &&
      input.attemptCount < input.maxAttempts &&
      nextWindow.position === 'IN_WINDOW' &&
      nextWindow.businessDate === input.businessDate
    ) {
      return {
        type: 'RETRY_SCHEDULED',
        nextRetryAt,
        failureCode: input.failureCode,
        scope: classification.scope,
      };
    }

    if (classification.retryable && input.attemptCount >= input.maxAttempts) {
      return {
        type: 'FINAL_FAILED',
        failureCode: 'MAX_ATTEMPTS_EXHAUSTED',
        causeCode: input.failureCode,
        scope: classification.scope,
      };
    }

    if (
      classification.retryable &&
      (nextWindow.position !== 'IN_WINDOW' || nextWindow.businessDate !== input.businessDate)
    ) {
      return {
        type: 'FINAL_FAILED',
        failureCode: 'RETRY_WINDOW_EXPIRED',
        causeCode: input.failureCode,
        scope: classification.scope,
      };
    }

    return {
      type: 'FINAL_FAILED',
      failureCode: input.failureCode,
      causeCode: input.failureCode,
      scope: classification.scope,
    };
  }
}
