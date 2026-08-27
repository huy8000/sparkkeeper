import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID, RUN_ID } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Account History', () => {
  it('renders bounded human-context history with Run navigation and duration', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    expect(wrapper.text()).toContain('Demo Account run history');
    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.text()).toContain('Success');
    expect(wrapper.text()).toContain('1m');
    expect(wrapper.get(`a[href="/runs/${RUN_ID}"]`).text()).toBe('2026-01-02');
    expect(wrapper.text()).not.toContain(RUN_ID);
    expect(wrapper.text()).not.toContain(ACCOUNT_ID);
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/runs?'));
    expect(String(call?.[0])).toContain(`accountId=${encodeURIComponent(ACCOUNT_ID)}`);
    expect(String(call?.[0])).toContain('limit=50');
    wrapper.unmount();
  });

  it('renders the History empty state distinctly from an API error', async () => {
    installApiFetch((url) => (url.pathname === '/api/runs' ? success([]) : undefined));
    const empty = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    expect(empty.text()).toContain('No runs yet');
    expect(empty.text()).toContain('Runs will appear after SparkKeeper executes this account.');
    expect(empty.find('[role="alert"]').exists()).toBe(false);
    empty.unmount();

    installApiFetch((url) =>
      url.pathname === '/api/runs'
        ? failure('RUNS_UNAVAILABLE', 'Account history could not be loaded.', 503)
        : undefined,
    );
    const failed = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    expect(failed.get('[role="alert"]').text()).toContain('Account history could not be loaded.');
    expect(failed.text()).not.toContain('No runs yet');
    failed.unmount();
  });

  it('keeps the account header and tabs visible while History is loading', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs' ? new Promise<Response>(() => undefined) : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.find('.account-tabs').exists()).toBe(true);
    expect(wrapper.get('.section-loading[role="status"]').text()).toContain(
      'Loading account history',
    );
    wrapper.unmount();
  });
});
