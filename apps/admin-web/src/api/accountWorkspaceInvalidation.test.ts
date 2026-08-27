import { describe, expect, it } from 'vitest';

import {
  invalidatesWorkspaceAccount,
  invalidatesWorkspaceFriends,
  invalidatesWorkspacePreflight,
  invalidatesWorkspaceRuns,
  invalidatesWorkspaceSchedule,
  invalidatesWorkspaceTemplates,
} from './accountWorkspaceInvalidation';
import { ACCOUNT_ID, TEMPLATE_ID } from '../test/fixtures';
import { configEvent } from '../test/realtime';
import { parseRealtimeEvent } from './realtimeClient';

function parsed(value: unknown, type: 'RUNTIME_EVENT' | 'CONFIG_CHANGED') {
  const event = parseRealtimeEvent(JSON.stringify(value), type);
  if (event === undefined) throw new Error('Fixture did not parse.');
  return event;
}

function runEvent(eventType: string, accountId = ACCOUNT_ID) {
  return {
    id: 'fixture-event',
    type: 'RUNTIME_EVENT',
    timestamp: '2026-01-02T03:04:05.000Z',
    data: {
      eventType,
      level: 'info',
      message: 'Synthetic account workspace event.',
      runId: '00000000-0000-4000-8000-000000000004',
      accountId,
      businessDate: '2026-01-02',
    },
  };
}

describe('account workspace invalidation', () => {
  it('scopes Account/Friend/Schedule configuration to the active account', () => {
    expect(
      invalidatesWorkspaceAccount(
        parsed(configEvent('ACCOUNT', ACCOUNT_ID), 'CONFIG_CHANGED'),
        ACCOUNT_ID,
      ),
    ).toBe(true);
    expect(
      invalidatesWorkspaceAccount(
        parsed(configEvent('ACCOUNT', '00000000-0000-4000-8000-000000000099'), 'CONFIG_CHANGED'),
        ACCOUNT_ID,
      ),
    ).toBe(false);
    expect(
      invalidatesWorkspaceFriends(
        parsed(
          configEvent('FRIEND', '00000000-0000-4000-8000-000000000002', ACCOUNT_ID),
          'CONFIG_CHANGED',
        ),
        ACCOUNT_ID,
      ),
    ).toBe(true);
    expect(
      invalidatesWorkspaceSchedule(
        parsed(
          configEvent('SCHEDULE', '00000000-0000-4000-8000-000000000003', ACCOUNT_ID),
          'CONFIG_CHANGED',
        ),
        ACCOUNT_ID,
      ),
    ).toBe(true);
  });

  it('refreshes Templates and selected preflight only for relevant configuration', () => {
    const template = parsed(configEvent('TEMPLATE', TEMPLATE_ID), 'CONFIG_CHANGED');
    expect(invalidatesWorkspaceTemplates(template)).toBe(true);
    expect(invalidatesWorkspacePreflight(template, ACCOUNT_ID, TEMPLATE_ID)).toBe(true);
    expect(
      invalidatesWorkspacePreflight(template, ACCOUNT_ID, '00000000-0000-4000-8000-000000000099'),
    ).toBe(false);
  });

  it.each(['RUN_STARTED', 'RUN_FINISHED', 'AUTH_EXPIRED', 'TASK_FAILED'] as const)(
    'refreshes account Runs for %s',
    (eventType) => {
      const event = parsed(runEvent(eventType), 'RUNTIME_EVENT');
      expect(invalidatesWorkspaceRuns(event, ACCOUNT_ID)).toBe(true);
      expect(invalidatesWorkspacePreflight(event, ACCOUNT_ID, TEMPLATE_ID)).toBe(true);
    },
  );

  it('ignores high-frequency progress events and other accounts', () => {
    const progress = parsed(runEvent('MESSAGE_SENDING'), 'RUNTIME_EVENT');
    const other = parsed(
      runEvent('RUN_FINISHED', '00000000-0000-4000-8000-000000000099'),
      'RUNTIME_EVENT',
    );
    expect(invalidatesWorkspaceRuns(progress, ACCOUNT_ID)).toBe(false);
    expect(invalidatesWorkspaceRuns(other, ACCOUNT_ID)).toBe(false);
  });
});
