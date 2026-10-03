import { describe, expect, it } from 'vitest';
import { ACCOUNT_ID, accountFixture, runtimeFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
describe('V4 Account Overview', () => {
  it('uses account-owned readiness and Contacts/Tasks/History, never legacy profile readiness or Friend/Schedule summaries', async () => {
    const f = installApiFetch();
    const w = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(w.text()).toContain('Account-owned profile');
    expect(w.text()).toContain('READY / READY / ACTIVE');
    for (const tab of ['contacts', 'tasks', 'history'])
      expect(w.find(`a[href="/accounts/${ACCOUNT_ID}/${tab}"]`).exists()).toBe(true);
    expect(f.mock.calls.some(([u]) => /friends|schedules/.test(String(u)))).toBe(false);
    w.unmount();
  });
  it.each(['AUTH_EXPIRED', 'UNKNOWN'] as const)(
    'preserves %s, does not claim ready or offer unsafe controls',
    async (loginStatus) => {
      installApiFetch((u) =>
        u.pathname === `/api/accounts/${ACCOUNT_ID}`
          ? success({ ...accountFixture, loginStatus })
          : undefined,
      );
      const w = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
      expect(w.text()).toContain(loginStatus);
      expect(w.text()).not.toMatch(/Mark Ready|Refresh Cookie|Start noVNC/);
      w.unmount();
    },
  );
  it('independently degrades Contact reads while retaining profile and Tasks', async () => {
    installApiFetch((u) =>
      u.pathname.endsWith('/contacts') ? failure('UNAVAILABLE', 'Unavailable', 503) : undefined,
    );
    const w = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(w.get('[role="alert"]').text()).toContain('Unable to read');
    expect(w.text()).toContain('READY / READY / ACTIVE');
    expect(w.text()).toContain('Tasks');
    w.unmount();
  });
  it('does not promote account profile based on global legacy browser flag', async () => {
    installApiFetch((u) =>
      u.pathname === `/api/accounts/${ACCOUNT_ID}`
        ? success({ ...accountFixture, profileState: 'MIGRATION_REQUIRED' })
        : u.pathname === '/api/runtime/status'
          ? success({ ...runtimeFixture, browserProfileConfigured: true })
          : undefined,
    );
    const w = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(w.text()).toContain('MIGRATION_REQUIRED');
    w.unmount();
  });
});
