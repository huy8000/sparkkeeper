import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID, RUN_ID } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Account History', () => {
  it('renders bounded unified source/kind and safe Run navigation', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    expect(wrapper.text()).toContain('Run history — Legacy / V4');
    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.text()).toContain('SUCCESS');
    expect(wrapper.get(`a[href="/history/${RUN_ID}"]`).text()).toBe('View');
    expect(wrapper.text()).not.toContain(RUN_ID);
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/runs?'));
    expect(String(call?.[0])).toContain(`accountId=${encodeURIComponent(ACCOUNT_ID)}`);
    expect(String(call?.[0])).toContain('limit=50');
    wrapper.unmount();
  });

  it('renders the History empty state distinctly from an API error', async () => {
    installApiFetch((url) => (url.pathname === '/api/runs' ? success([]) : undefined));
    const empty = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    expect(empty.text()).toContain('No records yet.');
    expect(empty.find('[role="alert"]').exists()).toBe(false);
    empty.unmount();

    installApiFetch((url) =>
      url.pathname === '/api/runs'
        ? failure('RUNS_UNAVAILABLE', 'Unable to read data. Refresh before acting.', 503)
        : undefined,
    );
    const failed = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    expect(failed.get('[role="alert"]').text()).toContain(
      'Unable to read data. Refresh before acting.',
    );
    expect(failed.text()).not.toContain('No records yet.');
    failed.unmount();
  });

  it('keeps the account header and tabs visible while History is loading', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs' ? new Promise<Response>(() => undefined) : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.find('.account-tabs').exists()).toBe(true);
    expect(wrapper.get('.page-stack [role="status"]').text()).toContain('Loading…');
    wrapper.unmount();
  });
});
