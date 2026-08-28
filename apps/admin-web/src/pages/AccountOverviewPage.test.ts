import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID, accountFixture, runtimeFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Account Overview', () => {
  it('renders READY, enabled configuration summaries, latest run, and safe browser information', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.text()).toContain('Ready for configured automation');
    expect(wrapper.text()).toContain('enabled of 1 configured');
    expect(wrapper.text()).toContain('09:00–10:30');
    expect(wrapper.text()).toContain('Asia/Shanghai');
    expect(wrapper.text()).toContain('Latest run');
    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.text()).toContain('Profile configured');
    expect(wrapper.text()).toContain(
      'Browser profile paths, cookies, tokens, and session files are never shown.',
    );
    expect(wrapper.text()).not.toContain(ACCOUNT_ID);
    const runsCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/runs?'));
    expect(String(runsCall?.[0])).toContain(`accountId=${encodeURIComponent(ACCOUNT_ID)}`);
    expect(String(runsCall?.[0])).toContain('limit=25');
    wrapper.unmount();
  });

  it.each([
    ['AUTH_EXPIRED', 'Login expired', 'stopped the safe sending flow'],
    ['UNKNOWN', 'Login status needs attention', 'Unknown is not treated as ready'],
  ] as const)(
    'renders %s without unsafe maintenance controls',
    async (loginStatus, title, copy) => {
      installApiFetch((url) =>
        url.pathname === `/api/accounts/${ACCOUNT_ID}`
          ? success({ ...accountFixture, loginStatus })
          : undefined,
      );
      const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
      expect(wrapper.text()).toContain(title);
      expect(wrapper.text()).toContain(copy);
      expect(wrapper.text()).not.toMatch(/Auto Login|Mark Ready|Start noVNC|Refresh Cookie/i);
      wrapper.unmount();
    },
  );

  it('renders account disabled distinctly from login state', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}`
        ? success({ ...accountFixture, enabled: false })
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.get('.account-workspace__header').text()).toContain('Disabled');
    expect(wrapper.get('.account-workspace__header').text()).toContain('Ready');
    wrapper.unmount();
  });

  it('degrades a failed Friends summary without destroying Schedule, Runs, or Browser summary', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/friends`
        ? failure('FRIENDS_UNAVAILABLE', 'Friends summary unavailable.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.get('[role="alert"]').text()).toContain('Friends summary unavailable.');
    expect(wrapper.text()).toContain('09:00–10:30');
    expect(wrapper.text()).toContain('Latest run');
    expect(wrapper.text()).toContain('Profile configured');
    wrapper.unmount();
  });

  it('renders no schedule and no latest run as configuration/history states, not errors', async () => {
    installApiFetch((url) => {
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}/schedules`) return success([]);
      if (url.pathname === '/api/runs') return success([]);
      return undefined;
    });
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.text()).toContain('Not configured');
    expect(wrapper.text()).toContain('No runs yet');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders a runtime summary error without hiding account configuration', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runtime/status'
        ? failure('RUNTIME_UNAVAILABLE', 'Runtime summary unavailable.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.text()).toContain('Runtime summary unavailable.');
    expect(wrapper.text()).toContain('enabled of 1 configured');
    expect(wrapper.text()).toContain('09:00–10:30');
    wrapper.unmount();
  });

  it('uses the real runtime browser profile flag', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runtime/status'
        ? success({ ...runtimeFixture, browserProfileConfigured: false })
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.text()).toContain('Profile not configured');
    wrapper.unmount();
  });
});
