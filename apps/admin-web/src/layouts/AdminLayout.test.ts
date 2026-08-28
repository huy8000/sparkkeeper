import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY } from '../composables/useTheme';
import { RUN_ID, runtimeFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, installEventSource, readyEvent, runtimeEvent } from '../test/realtime';

const NAVIGATION_LABELS = ['Overview', 'Accounts', 'Templates', 'Runs', 'Notifications', 'System'];

describe('app shell navigation', () => {
  it('renders the V3 workspace and operations navigation without Schedules', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/');
    const navigation = wrapper.find('.navigation');
    for (const label of NAVIGATION_LABELS) {
      expect(navigation.text()).toContain(label);
    }
    expect(navigation.text()).not.toContain('Schedules');
    expect(navigation.text()).toContain('Workspace');
    expect(navigation.text()).toContain('Operations');
    wrapper.unmount();
  });

  it('marks the active section link', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/accounts');
    const links = wrapper.findAll('.navigation a');
    const accounts = links.find((link) => link.text() === 'Accounts');
    const overview = links.find((link) => link.text() === 'Overview');
    expect(accounts?.classes()).toContain('navigation__link--active');
    expect(overview?.classes()).not.toContain('navigation__link--active');
    wrapper.unmount();
  });
});

describe('runtime indicator', () => {
  it('shows System Ready for a healthy runtime and stays separate from realtime wording', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/');
    const indicator = wrapper.find('.runtime-status');
    expect(indicator.text()).toBe('System Ready');
    expect(indicator.classes()).toContain('runtime-status--ready');
    wrapper.unmount();
  });

  it('shows System Degraded when the server reports degraded status', async () => {
    installApiFetch((url) => {
      if (url.pathname !== '/api/runtime/status') return undefined;
      return success({ ...runtimeFixture, serverStatus: 'DEGRADED' });
    });
    const wrapper = await mountAdmin('/');
    expect(wrapper.find('.runtime-status').text()).toBe('System Degraded');
    wrapper.unmount();
  });

  it('shows System Unavailable when the runtime endpoint fails', async () => {
    installApiFetch((url) => {
      if (url.pathname !== '/api/runtime/status') return undefined;
      return failure('INTERNAL_ERROR', 'Runtime status unavailable.', 500);
    });
    const wrapper = await mountAdmin('/');
    expect(wrapper.find('.runtime-status').text()).toBe('System Unavailable');
    wrapper.unmount();
  });
});

describe('safety warnings', () => {
  it('shows no warnings for a fully gated runtime', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/');
    expect(wrapper.findAll('.safety-warning')).toHaveLength(0);
    wrapper.unmount();
  });

  it('shows read-only warnings when dangerous gates are enabled', async () => {
    installApiFetch((url) => {
      if (url.pathname !== '/api/runtime/status') return undefined;
      return success({
        ...runtimeFixture,
        realSendAuthorizationEnabled: true,
        manualRunEnabled: true,
        schedulerEnabled: true,
      });
    });
    const wrapper = await mountAdmin('/');
    const warnings = wrapper.findAll('.safety-warning').map((chip) => chip.text());
    expect(warnings).toEqual(['Real Send Enabled', 'Manual Run Enabled', 'Scheduler Enabled']);
    expect(wrapper.find('.safety-warning button').exists()).toBe(false);
    wrapper.unmount();
  });
});

describe('SSE status', () => {
  it('shows Live when connected and Reconnecting while reconnecting', async () => {
    installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/');
    const source = FakeEventSource.instances[0]!;

    expect(wrapper.find('.sse-status').text()).toBe('Reconnecting');
    source.emit('open');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.sse-status').text()).toBe('Live');
    expect(wrapper.find('.sse-status').classes()).toContain('sse-status--live');

    source.emit('error');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.sse-status').text()).toBe('Reconnecting');
    wrapper.unmount();
  });

  it('keeps REST page content usable while realtime is down', async () => {
    installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/');
    const source = FakeEventSource.instances[0]!;

    source.emit('error');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.sse-status').text()).toBe('Reconnecting');
    // The Overview body keeps rendering; only the realtime badge changes.
    expect(wrapper.text()).toContain('Today at a glance');
    expect(wrapper.text()).not.toContain('Server Down');
    wrapper.unmount();
  });

  it('degrades to Offline without blocking the page when EventSource is unavailable', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/');
    expect(wrapper.find('.sse-status').text()).toBe('Offline');
    expect(wrapper.text()).toContain('Today at a glance');
    wrapper.unmount();
  });

  it('keeps one SSE connection across routes and performs one active-page reconnect generation', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/');
    expect(FakeEventSource.instances).toHaveLength(1);

    await wrapper
      .findAll('.navigation a')
      .find((link) => link.text() === 'Runs')!
      .trigger('click');
    await flushPromises();
    expect(FakeEventSource.instances).toHaveLength(1);

    const getCount = (path: string) =>
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          new URL(String(input), 'http://127.0.0.1').pathname === path &&
          (init?.method ?? 'GET') === 'GET',
      ).length;
    const before = {
      runtime: getCount('/api/runtime/status'),
      runs: getCount('/api/runs'),
      accounts: getCount('/api/accounts'),
    };
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();
    source.emit('runtime', runtimeEvent(RUN_ID, 'RUN_STARTED', 'route-cleanup'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(getCount('/api/runs')).toBe(before.runs + 1);

    const beforeReconnect = {
      runtime: getCount('/api/runtime/status'),
      runs: getCount('/api/runs'),
      accounts: getCount('/api/accounts'),
    };
    source.emit('error');
    source.emit('open');
    source.emit('ready', readyEvent('recovered'));
    await flushPromises();

    expect(getCount('/api/runtime/status')).toBe(beforeReconnect.runtime + 1);
    expect(getCount('/api/runs')).toBe(beforeReconnect.runs + 1);
    expect(getCount('/api/accounts')).toBe(beforeReconnect.accounts + 1);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.useRealTimers();
    wrapper.unmount();
    expect(source.closed).toBe(true);
  });
});

describe('theme toggle', () => {
  it('switches themes without losing the current route', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/accounts');
    const toggle = wrapper.find('.theme-toggle');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await toggle.trigger('click');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(wrapper.find('.topbar__title h1').text()).toBe('Accounts');

    await wrapper.find('.theme-toggle').trigger('click');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    wrapper.unmount();
  });
});

describe('sidebar collapse', () => {
  it('toggles the collapsed shell with an accessible pressed state', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/');
    const toggle = wrapper.find('.sidebar-toggle');
    expect(toggle.attributes('aria-pressed')).toBe('false');

    await toggle.trigger('click');
    expect(wrapper.find('.app-shell').classes()).toContain('app-shell--collapsed');
    expect(wrapper.find('.sidebar-toggle').attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });
});
