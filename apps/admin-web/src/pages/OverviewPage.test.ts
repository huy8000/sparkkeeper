import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_ID, RUN_ID, accountFixture, runFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, installEventSource } from '../test/realtime';
import { setLocale } from '../i18n';
describe('V4 Overview', () => {
  it('uses bounded unified runs and persisted task/account facts, without a legacy success inference', async () => {
    const fetch = installApiFetch();
    const w = await mountAdmin('/');
    expect(w.text()).toContain('V4 workspace');
    expect(w.text()).toContain('Production execution is locked');
    expect(w.find(`a[href="/history/${RUN_ID}"]`).exists()).toBe(true);
    const runs = fetch.mock.calls.find(([u]) => String(u).includes('/api/runs?'));
    expect(String(runs?.[0])).toContain('limit=50');
    expect(String(runs?.[0])).not.toContain('source=LEGACY');
    expect(w.text()).not.toContain('Everything is running normally');
    w.unmount();
  });
  it.each(['DELIVERY_UNKNOWN', 'FAILED', 'AUTH_EXPIRED', 'RUNNING'])(
    'renders %s as machine truth without retry controls',
    async (status) => {
      const fetch = installApiFetch((url) =>
        url.pathname === '/api/runs'
          ? success([
              { ...runFixture, status, source: 'V4', kind: 'TEST_SEND', businessDate: null },
            ])
          : undefined,
      );
      const w = await mountAdmin('/');
      expect(w.text()).toContain(status);
      expect(w.text()).not.toMatch(/Retry send|Run Now/);
      expect(fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
      w.unmount();
    },
  );
  it('shows account readiness needing attention, not display-name identity or global legacy profile', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/accounts'
        ? success([
            { ...accountFixture, profileState: 'MIGRATION_REQUIRED', loginStatus: 'UNKNOWN' },
          ])
        : undefined,
    );
    const w = await mountAdmin('/');
    expect(w.text()).toContain('MIGRATION_REQUIRED / UNKNOWN');
    expect(w.get(`a[href="/accounts/${ACCOUNT_ID}/overview"]`).text()).toBe('Demo Account');
    w.unmount();
  });
  it('separates loading, empty and failure while retaining the shell', async () => {
    installApiFetch((url) => (url.pathname === '/api/runs' ? success([]) : undefined));
    const empty = await mountAdmin('/');
    expect(empty.text()).toContain('No records yet.');
    expect(empty.find('[role="alert"]').exists()).toBe(false);
    empty.unmount();
    installApiFetch((url) =>
      url.pathname === '/api/runs' ? failure('UNAVAILABLE', 'Unavailable', 503) : undefined,
    );
    const failed = await mountAdmin('/');
    expect(failed.get('[role="alert"]').text()).toContain('Unable to read');
    failed.unmount();
    installApiFetch((url) =>
      url.pathname === '/api/runs' ? new Promise<Response>(() => undefined) : undefined,
    );
    const loading = await mountAdmin('/');
    expect(loading.text()).toContain('Loading…');
    expect(loading.find('.navigation').exists()).toBe(true);
    loading.unmount();
  });
  it('language, theme, navigation and refresh produce no mutations and do not reconnect SSE', async () => {
    const fetch = installApiFetch();
    installEventSource();
    const w = await mountAdmin('/');
    const source = FakeEventSource.instances[0]!;
    source.emit('error');
    await flushPromises();
    expect(w.text()).toContain('Reconnecting');
    expect(w.text()).toContain('V4 workspace');
    setLocale('zh-CN');
    await flushPromises();
    expect(w.text()).toContain('V4 工作空间');
    expect(document.documentElement.lang).toBe('zh-CN');
    setLocale('en-US');
    await w.get('.theme-toggle').trigger('click');
    await w
      .findAll('button')
      .find((b) => b.text() === 'Refresh')!
      .trigger('click');
    await flushPromises();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(
      fetch.mock.calls.filter(([, i]) =>
        ['POST', 'PATCH', 'PUT', 'DELETE'].includes(i?.method ?? 'GET'),
      ),
    ).toHaveLength(0);
    w.unmount();
  });
  it('retains the prior read model and marks background failure as stale', async () => {
    let fail = false;
    installApiFetch((url) =>
      url.pathname === '/api/accounts' && fail
        ? failure('UNAVAILABLE', 'Unavailable', 503)
        : undefined,
    );
    const w = await mountAdmin('/');
    fail = true;
    await w
      .findAll('button')
      .find((b) => b.text() === 'Refresh')!
      .trigger('click');
    await flushPromises();
    expect(w.text()).toContain('Showing the last successful snapshot');
    expect(w.get('.account-summary-card strong').text()).toBe('1');
    w.unmount();
  });
});
