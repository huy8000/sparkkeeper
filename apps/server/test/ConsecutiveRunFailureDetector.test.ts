import assert from 'node:assert/strict';
import test from 'node:test';

import type { DailyRun } from '@sparkkeeper/database';
import { parseBusinessDate, type DailyRunStatus } from '@sparkkeeper/shared';

import {
  DatabaseConsecutiveRunFailureDetector,
  DEFAULT_CONSECUTIVE_RUN_FAILURE_THRESHOLD,
} from '../src/notifications/ConsecutiveRunFailureDetector.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000701';

function run(businessDate: string, status: DailyRunStatus): DailyRun {
  const timestamp = new Date(`${businessDate}T12:00:00.000Z`);
  return {
    id: `run-${businessDate}`,
    accountId: ACCOUNT_ID,
    businessDate: parseBusinessDate(businessDate),
    status,
    startedAt: status === 'READY' ? null : timestamp,
    finishedAt:
      status === 'FAILED' || status === 'SUCCESS' || status === 'AUTH_EXPIRED' ? timestamp : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function detector(
  runs: readonly DailyRun[],
  threshold = DEFAULT_CONSECUTIVE_RUN_FAILURE_THRESHOLD,
): DatabaseConsecutiveRunFailureDetector {
  return new DatabaseConsecutiveRunFailureDetector({ listByAccountId: () => [...runs] }, threshold);
}

test('consecutive failure detector emits only after the configured terminal failure streak', () => {
  const currentDate = parseBusinessDate('2026-08-25');

  assert.equal(
    detector([]).shouldEmit({
      accountId: ACCOUNT_ID,
      businessDate: currentDate,
      runResult: 'FAILED',
    }),
    false,
  );
  assert.equal(
    detector([run('2026-08-24', 'FAILED')]).shouldEmit({
      accountId: ACCOUNT_ID,
      businessDate: currentDate,
      runResult: 'FAILED',
    }),
    true,
  );
  assert.equal(
    detector([run('2026-08-24', 'AUTH_EXPIRED')]).shouldEmit({
      accountId: ACCOUNT_ID,
      businessDate: currentDate,
      runResult: 'AUTH_EXPIRED',
    }),
    true,
  );
});

test('success and non-terminal history safely break the consecutive failure streak', () => {
  const currentDate = parseBusinessDate('2026-08-25');
  for (const status of ['SUCCESS', 'RUNNING', 'READY'] as const) {
    assert.equal(
      detector([run('2026-08-23', 'FAILED'), run('2026-08-24', status)]).shouldEmit({
        accountId: ACCOUNT_ID,
        businessDate: currentDate,
        runResult: 'FAILED',
      }),
      false,
      status,
    );
  }
  assert.equal(
    detector([run('2026-08-24', 'FAILED')]).shouldEmit({
      accountId: ACCOUNT_ID,
      businessDate: currentDate,
      runResult: 'SUCCESS',
    }),
    false,
  );
});

test('consecutive failure detector supports a bounded explicit threshold', () => {
  const detectorWithThree = detector([run('2026-08-23', 'FAILED'), run('2026-08-24', 'FAILED')], 3);
  assert.equal(
    detectorWithThree.shouldEmit({
      accountId: ACCOUNT_ID,
      businessDate: parseBusinessDate('2026-08-25'),
      runResult: 'FAILED',
    }),
    true,
  );
  assert.throws(() => detector([], 1), /threshold/u);
});
