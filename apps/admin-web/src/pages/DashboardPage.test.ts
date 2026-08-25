import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { healthFixture, runtimeFixture } from '../test/fixtures';
import { installApiFetch, failure, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, installEventSource, readyEvent } from '../test/realtime';

describe('Dashboard', () => {
  it('renders healthy services and treats a disabled scheduler as neutral', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain('SparkKeeper');
    expect(wrapper.text()).toContain('Database');
    expect(wrapper.text()).toContain('Migration');
    expect(wrapper.text()).toContain('Runtime scheduler');
    expect(wrapper.text()).toContain('DISABLED');
    expect(wrapper.find('.risk-banner').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders degraded health without inventing readiness', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/health'
        ? success({
            ...healthFixture,
            status: 'DEGRADED',
            database: { status: 'UNAVAILABLE' },
            migration: { status: 'NOT_READY' },
          })
        : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.text()).toContain('DEGRADED');
    expect(wrapper.text()).toContain('UNAVAILABLE');
    expect(wrapper.text()).toContain('NOT READY');
    wrapper.unmount();
  });

  it('shows a prominent warning when real-send authorization is enabled without a send action', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runtime/status'
        ? success({ ...runtimeFixture, realSendAuthorizationEnabled: true })
        : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.find('[role="alert"]').text()).toContain('Real send authorization enabled');
    expect(wrapper.findAll('button').some((button) => /send/i.test(button.text()))).toBe(false);
    wrapper.unmount();
  });

  it('renders a safe API error and retry action', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/health'
        ? failure('DATABASE_UNAVAILABLE', 'Health is temporarily unavailable.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin('/');

    expect(wrapper.find('[role="alert"]').text()).toContain('Health is temporarily unavailable.');
    expect(wrapper.find('[role="alert"] button').text()).toBe('Retry');
    wrapper.unmount();
  });

  it('allowlists runtime fields and never renders private paths or authorization data', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runtime/status'
        ? success({
            ...runtimeFixture,
            browserProfilePath: '/private/runtime/profile',
            databasePath: '/private/runtime/database',
            Authorization: 'PRIVATE_AUTHORIZATION_SENTINEL',
          })
        : undefined,
    );
    const wrapper = await mountAdmin('/');
    const dom = wrapper.text();

    expect(dom).toContain('Browser profile configured');
    expect(dom).not.toContain('/private/runtime/profile');
    expect(dom).not.toContain('/private/runtime/database');
    expect(dom).not.toContain('PRIVATE_AUTHORIZATION_SENTINEL');
    wrapper.unmount();
  });

  it('renders loading state while health is pending', async () => {
    installApiFetch((url, init) => {
      if (url.pathname !== '/api/health') return undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      });
    });
    const wrapperPromise = mountAdmin('/');
    await flushPromises();
    const wrapper = await wrapperPromise;
    expect(wrapper.text()).toContain('Loading service health');
    wrapper.unmount();
  });

  it('shows connected/reconnecting state and debounces ready snapshot refresh', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/');
    const source = FakeEventSource.instances[0]!;

    source.emit('open');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Live updates: Connected');
    source.emit('error');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Live updates: Reconnecting');

    const before = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/runtime/status'),
    ).length;
    vi.useFakeTimers();
    source.emit('ready', readyEvent());
    source.emit('ready', readyEvent('2'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    const after = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/api/runtime/status'),
    ).length;
    expect(after - before).toBe(1);
    vi.useRealTimers();
    wrapper.unmount();
    expect(source.closed).toBe(true);
  });
});
