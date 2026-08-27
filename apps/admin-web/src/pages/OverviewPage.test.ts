import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_ID,
  RUN_ID,
  accountFixture,
  runFixture,
  runtimeFixture,
  sendRecordFixture,
} from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, installEventSource, readyEvent, runtimeEvent } from '../test/realtime';

function getCalls(fetchMock: ReturnType<typeof vi.fn>, path: string): number {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      new URL(String(input), 'http://127.0.0.1').pathname === path &&
      (init?.method ?? 'GET') === 'GET',
  ).length;
}

describe('Overview', () => {
  it('renders the Success state from real, bounded API aggregation', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/');

    expect(wrapper.find('.topbar__title h1').text()).toBe('Overview');
    expect(wrapper.text()).toContain('Everything is running normally');
    expect(wrapper.text()).toContain("All of today's runs completed successfully.");
    expect(wrapper.text()).toContain('Total configured');
    expect(wrapper.text()).toContain('Nothing needs your attention');
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.text()).toContain('Scheduler');
    expect(wrapper.text()).toContain('Manual Run');
    expect(wrapper.text()).toContain('Real send');
    expect(wrapper.text()).toContain('Browser profile');
    expect(wrapper.text()).toContain('Manage accounts');
    expect(wrapper.text()).toContain('Manage templates');
    expect(wrapper.text()).toContain('View runs');
    expect(wrapper.text()).toContain('System status');
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), 'http://127.0.0.1');
        return (
          url.pathname === '/api/runs' &&
          /^\d{4}-\d{2}-\d{2}$/u.test(url.searchParams.get('businessDate') ?? '') &&
          url.searchParams.get('limit') === '100'
        );
      }),
    ).toBe(true);
    expect(getCalls(fetchMock, `/api/runs/${RUN_ID}/send-records`)).toBe(0);
    wrapper.unmount();
  });

  it('renders Running and Live without treating it as attention', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs' ? success([{ ...runFixture, status: 'RUNNING' }]) : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain("Today's runs are in progress");
    expect(wrapper.text()).toContain('Running');
    expect(wrapper.text()).toContain('Live');
    expect(wrapper.text()).toContain('Nothing needs your attention');
    wrapper.unmount();
  });

  it('renders a confirmed Failed state with a safe run-detail CTA', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs' ? success([{ ...runFixture, status: 'FAILED' }]) : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain("Today's runs need attention");
    expect(wrapper.text()).toContain('Run failed');
    expect(wrapper.find(`a[href="/runs/${RUN_ID}"]`).text()).toContain('View run');
    expect(wrapper.text()).not.toMatch(/Retry now|Run again|Force send|Clear state/iu);
    wrapper.unmount();
  });

  it('renders Auth Expired from enabled account state with only View account', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/accounts'
        ? success([{ ...accountFixture, loginStatus: 'AUTH_EXPIRED' }])
        : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain('Login expired');
    expect(wrapper.text()).toContain('SparkKeeper stopped the current safe send flow.');
    expect(wrapper.find(`a[href="/accounts/${ACCOUNT_ID}/overview"]`).text()).toBe('View account');
    expect(wrapper.text()).not.toMatch(/Mark Ready|Login Automatically|Refresh Cookie/iu);
    wrapper.unmount();
  });

  it('renders Delivery Unknown only from a real SendRecord and forbids retry actions', async () => {
    const fetchMock = installApiFetch((url) => {
      if (url.pathname === '/api/runs') return success([{ ...runFixture, status: 'FAILED' }]);
      if (url.pathname === `/api/runs/${RUN_ID}/send-records`) {
        return success([{ ...sendRecordFixture, status: 'DELIVERY_UNKNOWN' }]);
      }
      return undefined;
    });
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain('Delivery uncertain');
    expect(wrapper.text()).toContain('Do not retry automatically.');
    expect(wrapper.find(`a[href="/runs/${RUN_ID}"]`).text()).toContain('View run');
    const actionLabels = wrapper
      .findAll('a, button')
      .map((element) => element.text())
      .join(' ');
    expect(actionLabels).not.toMatch(/\bRetry\b|Resend|Force Send|Run Again/iu);
    expect(getCalls(fetchMock, `/api/runs/${RUN_ID}/send-records`)).toBe(1);
    wrapper.unmount();
  });

  it('degrades a failed SendRecord classification request to generic Failed', async () => {
    installApiFetch((url) => {
      if (url.pathname === '/api/runs') return success([{ ...runFixture, status: 'FAILED' }]);
      if (url.pathname === `/api/runs/${RUN_ID}/send-records`) {
        return failure('DETAIL_UNAVAILABLE', 'Private failure detail.', 503);
      }
      return undefined;
    });
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain("Today's runs need attention");
    expect(wrapper.text()).toContain('Unable to determine detailed failure reason');
    expect(wrapper.text()).not.toContain('Private failure detail.');
    expect(wrapper.text()).not.toContain('Delivery uncertain');
    wrapper.unmount();
  });

  it('keeps an empty run list distinct from API Error', async () => {
    installApiFetch((url) => (url.pathname === '/api/runs' ? success([]) : undefined));
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain('No runs yet today');
    expect(wrapper.text()).toContain('Results will appear here after a task runs.');
    expect(wrapper.text()).not.toContain("Today's summary is unavailable");
    wrapper.unmount();
  });

  it('keeps the app shell visible and uses Overview skeletons while core data is loading', async () => {
    installApiFetch((url, init) => {
      if (url.pathname !== '/api/runtime/status') return undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    });
    const wrapper = await mountAdmin('/');

    expect(wrapper.find('.app-shell').exists()).toBe(true);
    expect(wrapper.find('.sidebar').exists()).toBe(true);
    expect(wrapper.find('.topbar').exists()).toBe(true);
    expect(wrapper.find('.overview-page [role="status"]').exists()).toBe(true);
    expect(wrapper.find('.overview-page').attributes('aria-busy')).not.toBe('true');
    expect(wrapper.text()).toContain("Loading today's summary");
    expect(wrapper.text()).toContain('Checking for actionable issues');
    expect(wrapper.text()).not.toContain('Nothing needs your attention');
    wrapper.unmount();
  });

  it('shows API Error for rejected runs while preserving Runtime Summary', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs'
        ? failure('DATABASE_UNAVAILABLE', 'Today data is temporarily unavailable.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.find('[role="alert"]').text()).toContain(
      'Today data is temporarily unavailable.',
    );
    expect(wrapper.text()).toContain("Today's summary is unavailable");
    expect(wrapper.text()).toContain('Safety controls');
    expect(wrapper.text()).toContain('Browser profile');
    expect(wrapper.text()).not.toContain('No runs yet today');
    expect(wrapper.text()).not.toContain('Nothing needs your attention');
    wrapper.unmount();
  });

  it('partially degrades account failure while retaining activity and runtime data', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/accounts'
        ? failure('ACCOUNTS_UNAVAILABLE', 'Account totals are unavailable.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain('Account totals are unavailable.');
    expect(wrapper.text()).toContain('Unknown account');
    expect(wrapper.text()).toContain('Success');
    expect(wrapper.text()).toContain('Safety controls');
    expect(wrapper.text()).not.toContain(ACCOUNT_ID);
    wrapper.unmount();
  });

  it('keeps REST content visible while SSE reports Reconnecting', async () => {
    installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/');
    const source = FakeEventSource.instances[0]!;

    source.emit('open');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.sse-status').text()).toBe('Live');
    source.emit('error');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.sse-status').text()).toBe('Reconnecting');
    expect(wrapper.text()).toContain('Everything is running normally');
    expect(wrapper.text()).not.toContain("Today's summary is unavailable");
    wrapper.unmount();
  });

  it('coalesces relevant event storms and refreshes one snapshot after reconnect', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/');
    const source = FakeEventSource.instances[0]!;
    expect(getCalls(fetchMock, '/api/runs')).toBe(1);

    vi.useFakeTimers();
    source.emit('runtime', runtimeEvent(RUN_ID, 'RUN_STARTED', '10'));
    source.emit('runtime', runtimeEvent(RUN_ID, 'VERIFY_SUCCESS', '11'));
    source.emit('runtime', runtimeEvent(RUN_ID, 'RUN_FINISHED', '12'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(getCalls(fetchMock, '/api/runs')).toBe(2);

    source.emit('error');
    source.emit('open');
    source.emit('ready', readyEvent('13'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(getCalls(fetchMock, '/api/runs')).toBe(3);
    wrapper.unmount();
  });

  it('is read-only during ordinary loading, navigation, refresh, and theme use', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/');
    await wrapper.find('.theme-toggle').trigger('click');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(wrapper.text()).toContain('Everything is running normally');
    await wrapper.find('.topbar .button').trigger('click');
    await flushPromises();

    const methods = fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET');
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(['GET']));
    expect(fetchMock.mock.calls.map(([input]) => String(input)).join('\n')).not.toMatch(
      /manual-runs|notification-config\/test/iu,
    );
    wrapper.unmount();
  });

  it('warns for dangerous runtime gates without exposing a mutation action', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runtime/status'
        ? success({
            ...runtimeFixture,
            manualRunEnabled: true,
            realSendAuthorizationEnabled: true,
          })
        : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain('Manual Run Enabled');
    expect(wrapper.text()).toContain('Real Send Enabled');
    expect(
      wrapper.findAll('button').some((button) => /Run now|Send now/iu.test(button.text())),
    ).toBe(false);
    wrapper.unmount();
  });
});
