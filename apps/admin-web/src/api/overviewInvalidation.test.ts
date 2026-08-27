import { describe, expect, it } from 'vitest';

import { RUN_ID } from '../test/fixtures';
import { configEvent, readyEvent, runtimeEvent } from '../test/realtime';
import { parseRealtimeEvent } from './realtimeClient';
import { invalidatesOverviewAccounts, invalidatesOverviewRuns } from './overviewInvalidation';

function parsed(value: unknown, type: 'RUNTIME_EVENT' | 'CONFIG_CHANGED' | 'READY') {
  return parseRealtimeEvent(JSON.stringify(value), type)!;
}

describe('Overview realtime invalidation', () => {
  it.each([
    'RUN_STARTED',
    'RUN_FINISHED',
    'AUTH_EXPIRED',
    'TASK_FAILED',
    'DELIVERY_UNKNOWN',
    'VERIFY_SUCCESS',
  ] as const)('refreshes runs for %s', (eventType) => {
    expect(invalidatesOverviewRuns(parsed(runtimeEvent(RUN_ID, eventType), 'RUNTIME_EVENT'))).toBe(
      true,
    );
  });

  it('refreshes account and run aggregation for ACCOUNT config changes', () => {
    const event = parsed(configEvent('ACCOUNT', 'fixture-account'), 'CONFIG_CHANGED');
    expect(invalidatesOverviewAccounts(event)).toBe(true);
    expect(invalidatesOverviewRuns(event)).toBe(true);
  });

  it('ignores noisy phases and non-account config changes', () => {
    expect(
      invalidatesOverviewRuns(parsed(runtimeEvent(RUN_ID, 'FRIEND_RESOLVING'), 'RUNTIME_EVENT')),
    ).toBe(false);
    const template = parsed(configEvent('TEMPLATE', 'fixture-template'), 'CONFIG_CHANGED');
    expect(invalidatesOverviewAccounts(template)).toBe(false);
    expect(invalidatesOverviewRuns(template)).toBe(false);
  });

  it('leaves reconnect READY handling to the shared refresh composable', () => {
    const event = parsed(readyEvent(), 'READY');
    expect(invalidatesOverviewAccounts(event)).toBe(false);
    expect(invalidatesOverviewRuns(event)).toBe(false);
  });
});
