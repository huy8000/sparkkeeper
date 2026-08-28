import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { RUN_ID, healthFixture, runtimeFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, configEvent, installEventSource, runtimeEvent } from '../test/realtime';

describe('System status', () => {
  it('loads Health and Runtime independently', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/health' ? new Promise<Response>(() => undefined) : undefined,
    );
    const healthPending = await mountAdmin('/operations/system');
    expect(healthPending.find('[aria-label="Loading server status…"]').exists()).toBe(true);
    expect(healthPending.text()).toContain('Runtime dependencies');
    expect(healthPending.text()).toContain('Business timezone');
    healthPending.unmount();

    installApiFetch((url) =>
      url.pathname === '/api/runtime/status' ? new Promise<Response>(() => undefined) : undefined,
    );
    const runtimePending = await mountAdmin('/operations/system');
    expect(runtimePending.text()).toContain('SparkKeeper Server');
    expect(runtimePending.text()).toContain(healthFixture.version);
    expect(runtimePending.find('[aria-label="Loading runtime status…"]').exists()).toBe(true);
    runtimePending.unmount();
  });

  it('renders System Ready and versions from both API responses', async () => {
    installApiFetch((url) => {
      if (url.pathname === '/api/health') {
        return success({ ...healthFixture, version: 'health-synthetic-6.1' });
      }
      if (url.pathname === '/api/runtime/status') {
        return success({ ...runtimeFixture, version: 'runtime-synthetic-6.2' });
      }
      return undefined;
    });
    const wrapper = await mountAdmin('/operations/system');

    expect(wrapper.find('.system-heading .runtime-status').text()).toBe('System Ready');
    expect(wrapper.text()).toContain('health-synthetic-6.1');
    expect(wrapper.text()).toContain('runtime-synthetic-6.2');
    expect(wrapper.text()).toContain('Database');
    expect(wrapper.text()).toContain('Migration');
    expect(wrapper.text()).toContain('Observability');
    expect(wrapper.text()).toContain('Browser profile');
    wrapper.unmount();
  });

  it.each([
    ['database', { databaseReady: false }],
    ['migration', { migrationReady: false }],
    ['observability', { observabilityReady: false }],
    ['browser profile', { browserProfileConfigured: false }],
  ])('uses the shared degraded state when %s is not ready', async (_name, state) => {
    installApiFetch((url) =>
      url.pathname === '/api/runtime/status' ? success({ ...runtimeFixture, ...state }) : undefined,
    );
    const wrapper = await mountAdmin('/operations/system');

    expect(wrapper.find('.system-heading .runtime-status').text()).toBe('System Degraded');
    expect(wrapper.find('.topbar .runtime-status').text()).toBe('System Degraded');
    if ('browserProfileConfigured' in state) {
      expect(wrapper.text()).toContain('Not configured');
    }
    wrapper.unmount();
  });

  it('keeps Runtime and safety gates when Health fails', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/health'
        ? failure('SYNTHETIC_HEALTH_ERROR', 'Synthetic health failure.', 500)
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/system');

    expect(wrapper.text()).toContain('Synthetic health failure.');
    expect(wrapper.text()).toContain('Runtime dependencies');
    expect(wrapper.text()).toContain('Runtime authorization');
    expect(wrapper.find('.system-heading .runtime-status').text()).toBe('System Degraded');
    wrapper.unmount();
  });

  it('keeps Health when Runtime fails', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runtime/status'
        ? failure('SYNTHETIC_RUNTIME_ERROR', 'Synthetic runtime failure.', 500)
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/system');

    expect(wrapper.text()).toContain(healthFixture.version);
    expect(wrapper.text()).toContain('Synthetic runtime failure.');
    expect(wrapper.text()).toContain('SparkKeeper Server');
    expect(wrapper.find('.system-heading .runtime-status').text()).toBe('System Degraded');
    wrapper.unmount();
  });

  it('shows a full unavailable error only when both APIs fail and retries both GETs', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/health' || url.pathname === '/api/runtime/status'
        ? failure('SYNTHETIC_SYSTEM_ERROR', 'Synthetic system failure.', 500)
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/system');
    expect(wrapper.get('.page-error').text()).toContain('System status unavailable');
    expect(wrapper.find('.system-heading .runtime-status').text()).toBe('System Unavailable');

    await wrapper.get('.page-error button').trigger('click');
    await flushPromises();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/health')),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runtime/status')),
    ).toHaveLength(2);
    wrapper.unmount();
  });

  it.each([
    [false, false, false],
    [true, true, true],
  ])(
    'renders Scheduler=%s ManualRun=%s RealSend=%s as observation-only gates',
    async (schedulerEnabled, manualRunEnabled, realSendAuthorizationEnabled) => {
      const fetchMock = installApiFetch((url) =>
        url.pathname === '/api/runtime/status'
          ? success({
              ...runtimeFixture,
              schedulerEnabled,
              manualRunEnabled,
              realSendAuthorizationEnabled,
            })
          : undefined,
      );
      const wrapper = await mountAdmin('/operations/system');
      const gates = wrapper.get('.system-gates');

      expect(gates.text()).toContain('Configured outside Admin');
      expect(gates.text()).toContain('Scheduler');
      expect(gates.text()).toContain('Manual Run');
      expect(gates.text()).toContain('Real Send Authorization');
      expect(gates.find('input').exists()).toBe(false);
      expect(gates.find('form').exists()).toBe(false);
      expect(
        gates
          .findAll('button')
          .map((candidate) => candidate.text())
          .filter((label) => /enable|disable|send|run/iu.test(label)),
      ).toEqual([]);
      expect(
        fetchMock.mock.calls
          .map(([, init]) => init?.method ?? 'GET')
          .filter((method) => method !== 'GET'),
      ).toEqual([]);
      if (realSendAuthorizationEnabled) {
        expect(wrapper.text()).toContain('Real message delivery is authorized.');
      } else {
        expect(wrapper.text()).not.toContain('Real message delivery is authorized.');
      }
      wrapper.unmount();
    },
  );

  it('never exposes unknown future API fields', async () => {
    installApiFetch((url) => {
      if (url.pathname === '/api/health') {
        return success({
          ...healthFixture,
          password: 'PRIVATE_PASSWORD_SENTINEL',
          privateKey: 'PRIVATE_KEY_SENTINEL',
        });
      }
      if (url.pathname === '/api/runtime/status') {
        return success({
          ...runtimeFixture,
          token: 'PRIVATE_TOKEN_SENTINEL',
          secret: 'PRIVATE_SECRET_SENTINEL',
          profilePath: '/PRIVATE_PROFILE_SENTINEL',
          storageState: 'PRIVATE_STORAGE_SENTINEL',
        });
      }
      return undefined;
    });
    const wrapper = await mountAdmin('/operations/system');
    expect(wrapper.text()).not.toMatch(
      /PRIVATE_(PASSWORD|KEY|TOKEN|SECRET|PROFILE|STORAGE)_SENTINEL/u,
    );
    wrapper.unmount();
  });
});

describe('System realtime behavior', () => {
  it('ignores unrelated config changes and coalesces relevant runtime bursts', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/operations/system');
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();

    source.emit(
      'config-changed',
      configEvent('NOTIFICATION', 'notification-config', undefined, '1'),
    );
    source.emit('config-changed', configEvent('ACCOUNT', 'synthetic-account', undefined, '2'));
    source.emit('config-changed', configEvent('TEMPLATE', 'synthetic-template', undefined, '3'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runtime/status')),
    ).toHaveLength(1);

    source.emit('runtime', runtimeEvent(RUN_ID, 'RUN_STARTED', '4'));
    source.emit('runtime', runtimeEvent(RUN_ID, 'TASK_FAILED', '5'));
    source.emit('runtime', runtimeEvent(RUN_ID, 'MESSAGE_SENDING', '6'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/runtime/status')),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/health')),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it('keeps REST snapshots while SSE reconnects', async () => {
    installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/operations/system');
    const source = FakeEventSource.instances[0]!;
    source.emit('open');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.sse-status').text()).toBe('Live');

    source.emit('error');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.sse-status').text()).toBe('Reconnecting');
    expect(wrapper.text()).toContain(healthFixture.version);
    expect(wrapper.text()).toContain('Runtime dependencies');
    expect(wrapper.text()).not.toContain('System status unavailable');
    wrapper.unmount();
  });

  it('retains the Runtime snapshot after a background refresh error', async () => {
    let runtimeReads = 0;
    installApiFetch((url) => {
      if (url.pathname !== '/api/runtime/status') return undefined;
      runtimeReads += 1;
      return runtimeReads === 1
        ? success(runtimeFixture)
        : failure('RUNTIME_REFRESH_FAILED', 'Latest runtime could not be loaded.', 503);
    });
    const wrapper = await mountAdmin('/operations/system');
    await wrapper.get('.topbar .button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(runtimeFixture.timezone);
    expect(wrapper.text()).toContain('Latest runtime could not be loaded.');
    expect(wrapper.find('.stale-data-notice').exists()).toBe(true);
    expect(wrapper.find('.page-error').exists()).toBe(false);
    wrapper.unmount();
  });
});
