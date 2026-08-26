import type { DailyRunRepository } from '@sparkkeeper/database';
import type { BusinessDate } from '@sparkkeeper/shared';

import type { RuntimeRunResult } from '../observability/RuntimeObserver.js';

export const DEFAULT_CONSECUTIVE_RUN_FAILURE_THRESHOLD = 2;

export interface ConsecutiveRunFailureInput {
  readonly accountId: string;
  readonly businessDate: BusinessDate;
  readonly runResult: RuntimeRunResult;
}

export interface ConsecutiveRunFailureSource {
  shouldEmit(input: ConsecutiveRunFailureInput): boolean;
}

export class DatabaseConsecutiveRunFailureDetector implements ConsecutiveRunFailureSource {
  constructor(
    private readonly dailyRuns: Pick<DailyRunRepository, 'listByAccountId'>,
    private readonly threshold = DEFAULT_CONSECUTIVE_RUN_FAILURE_THRESHOLD,
  ) {
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > 30) {
      throw new Error('Consecutive run failure threshold is outside its safe range.');
    }
  }

  shouldEmit(input: ConsecutiveRunFailureInput): boolean {
    if (!isFailedRunResult(input.runResult)) return false;

    let consecutiveFailures = 1;
    const previousRuns = this.dailyRuns
      .listByAccountId(input.accountId)
      .filter((run) => run.businessDate < input.businessDate)
      .sort((left, right) => right.businessDate.localeCompare(left.businessDate));

    for (const run of previousRuns) {
      if (run.status === 'FAILED' || run.status === 'AUTH_EXPIRED') {
        consecutiveFailures += 1;
        if (consecutiveFailures >= this.threshold) return true;
        continue;
      }

      // SUCCESS resets the streak. READY/RUNNING means the historical sequence is not safely
      // classifiable as consecutive terminal failures, so stop rather than guessing.
      break;
    }

    return false;
  }
}

function isFailedRunResult(result: RuntimeRunResult): boolean {
  return result === 'FAILED' || result === 'AUTH_EXPIRED';
}
