import { describe, expect, it } from 'vitest';

import { accountFixture, runFixture } from '../test/fixtures';
import type { Account, DailyRun } from '../types/api';
import { classifyOverviewState } from './classifyOverviewState';

function account(overrides: Partial<Account> = {}): Account {
  return { ...accountFixture, ...overrides };
}

function run(overrides: Partial<DailyRun> = {}): DailyRun {
  return { ...runFixture, ...overrides };
}

describe('classifyOverviewState', () => {
  it('classifies no accounts and no runs as empty', () => {
    expect(classifyOverviewState({ accounts: [], runs: [] })).toEqual({
      state: 'EMPTY',
      counts: { accounts: 0, success: 0, failed: 0, pending: 0 },
      attentionItems: [],
    });
  });

  it('counts all configured accounts but keeps accounts without runs empty', () => {
    const result = classifyOverviewState({ accounts: [account()], runs: [] });
    expect(result.state).toBe('EMPTY');
    expect(result.counts.accounts).toBe(1);
  });

  it('classifies all successful runs as success', () => {
    const result = classifyOverviewState({
      accounts: [account(), account({ id: 'account-2' })],
      runs: [run(), run({ id: 'run-2', accountId: 'account-2' })],
    });
    expect(result.state).toBe('SUCCESS');
    expect(result.counts).toEqual({ accounts: 2, success: 2, failed: 0, pending: 0 });
  });

  it.each(['READY', 'RUNNING'] as const)('classifies %s as running/pending', (status) => {
    const result = classifyOverviewState({
      accounts: [account()],
      runs: [run({ status })],
    });
    expect(result.state).toBe('RUNNING');
    expect(result.counts.pending).toBe(1);
    expect(result.attentionItems).toHaveLength(0);
  });

  it('classifies a failed run with a View Run attention target', () => {
    const result = classifyOverviewState({
      accounts: [account()],
      runs: [run({ status: 'FAILED' })],
    });
    expect(result.state).toBe('FAILED');
    expect(result.counts.failed).toBe(1);
    expect(result.attentionItems).toEqual([
      { kind: 'FAILED', accountId: accountFixture.id, runId: runFixture.id },
    ]);
  });

  it('gives an enabled expired account highest priority even without runs', () => {
    const result = classifyOverviewState({
      accounts: [account({ loginStatus: 'AUTH_EXPIRED' })],
      runs: [],
    });
    expect(result.state).toBe('AUTH_EXPIRED');
    expect(result.attentionItems[0]).toEqual({
      kind: 'AUTH_EXPIRED',
      accountId: accountFixture.id,
    });
  });

  it('classifies an auth-expired run even when account metadata is ready', () => {
    const result = classifyOverviewState({
      accounts: [account()],
      runs: [run({ status: 'AUTH_EXPIRED' })],
    });
    expect(result.state).toBe('AUTH_EXPIRED');
    expect(result.counts.failed).toBe(1);
    expect(result.attentionItems[0]?.accountId).toBe(accountFixture.id);
  });

  it('classifies Delivery Unknown only from an explicitly observed send record', () => {
    const failed = run({ status: 'FAILED' });
    const result = classifyOverviewState({
      accounts: [account()],
      runs: [failed],
      deliveryUnknownRunIds: new Set([failed.id]),
    });
    expect(result.state).toBe('DELIVERY_UNKNOWN');
    expect(result.attentionItems[0]?.kind).toBe('DELIVERY_UNKNOWN');
  });

  it('degrades a send-record classification failure to generic Failed', () => {
    const failed = run({ status: 'FAILED' });
    const result = classifyOverviewState({
      accounts: [account()],
      runs: [failed],
      detailUnavailableRunIds: new Set([failed.id]),
    });
    expect(result.state).toBe('FAILED');
    expect(result.attentionItems[0]).toMatchObject({
      kind: 'FAILED',
      detailUnavailable: true,
    });
  });

  it('uses danger priority across mixed account and run states', () => {
    const result = classifyOverviewState({
      accounts: [account({ loginStatus: 'AUTH_EXPIRED' })],
      runs: [
        run({ id: 'success', status: 'SUCCESS' }),
        run({ id: 'running', status: 'RUNNING' }),
        run({ id: 'failed', status: 'FAILED' }),
      ],
      deliveryUnknownRunIds: new Set(['failed']),
    });
    expect(result.state).toBe('AUTH_EXPIRED');
    expect(result.counts).toEqual({ accounts: 1, success: 1, failed: 1, pending: 1 });
    expect(result.attentionItems.map((item) => item.kind)).toEqual([
      'AUTH_EXPIRED',
      'DELIVERY_UNKNOWN',
    ]);
  });

  it('counts disabled accounts but does not create login attention for them', () => {
    const result = classifyOverviewState({
      accounts: [account({ enabled: false, loginStatus: 'AUTH_EXPIRED' })],
      runs: [],
    });
    expect(result.counts.accounts).toBe(1);
    expect(result.state).toBe('EMPTY');
    expect(result.attentionItems).toHaveLength(0);
  });

  it('limits the actionable list to three priority-ordered items', () => {
    const accounts = Array.from({ length: 4 }, (_, index) =>
      account({ id: `account-${index}`, loginStatus: 'AUTH_EXPIRED' }),
    );
    const result = classifyOverviewState({ accounts, runs: [] });
    expect(result.attentionItems).toHaveLength(3);
    expect(result.attentionItems.every((item) => item.kind === 'AUTH_EXPIRED')).toBe(true);
  });
});
