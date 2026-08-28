import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import DangerConfirmation from '../components/DangerConfirmation.vue';
import { notificationConfigurationFixture, notificationDeliveryFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, configEvent, installEventSource } from '../test/realtime';

function button(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll('button').find((candidate) => candidate.text() === label);
  if (match === undefined) throw new Error(`Missing button: ${label}`);
  return match;
}

describe('Notifications configuration', () => {
  it('renders a configured WEBHOOK form and all real event toggles', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/operations/notifications');

    expect(wrapper.text()).toContain('Configure webhook notifications');
    expect(wrapper.text()).toContain('Configured');
    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty(
      'value',
      'https://example.invalid/webhook',
    );
    expect(wrapper.get('select[name="provider"]').element).toHaveProperty('value', 'WEBHOOK');
    for (const event of [
      'AUTH_EXPIRED',
      'TASK_FAILED',
      'CONSECUTIVE_RUN_FAILURE',
      'DELIVERY_UNKNOWN',
    ]) {
      expect(wrapper.text()).toContain(event);
    }
    expect(wrapper.find('a[href="https://example.invalid/webhook"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows the legal unconfigured state as a setup form, not an error', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/notification-config'
        ? success({
            ...notificationConfigurationFixture,
            enabled: false,
            webhookUrl: null,
            createdAt: null,
            updatedAt: null,
          })
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/notifications');

    expect(wrapper.text()).toContain('Setup required');
    expect(wrapper.text()).toContain('Not configured');
    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty('value', '');
    expect(button(wrapper, 'Send test notification').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('distinguishes initial loading from API error', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/notification-config'
        ? new Promise<Response>(() => undefined)
        : undefined,
    );
    const loading = await mountAdmin('/operations/notifications');
    expect(loading.find('.notification-skeleton').attributes('aria-busy')).toBe('true');
    expect(loading.text()).not.toContain('Unable to load notification settings');
    loading.unmount();

    installApiFetch((url) =>
      url.pathname === '/api/notification-config'
        ? failure('SYNTHETIC_CONFIG_ERROR', 'Synthetic configuration failure.', 500)
        : undefined,
    );
    const failed = await mountAdmin('/operations/notifications');
    expect(failed.get('[role="alert"]').text()).toContain('Synthetic configuration failure.');
    expect(failed.text()).not.toContain('Setup required');
    failed.unmount();
  });

  it('retains the loaded form after a transient refresh error', async () => {
    let reads = 0;
    installApiFetch((url) => {
      if (url.pathname !== '/api/notification-config') return undefined;
      reads += 1;
      return reads === 1
        ? success(notificationConfigurationFixture)
        : failure('SYNTHETIC_REFRESH_ERROR', 'Synthetic refresh failure.', 500);
    });
    const wrapper = await mountAdmin('/operations/notifications');
    await wrapper.get('.notifications-page .page-heading button').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('Synthetic refresh failure.');
    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty(
      'value',
      'https://example.invalid/webhook',
    );
    expect(wrapper.text()).toContain('Webhook configuration');
    wrapper.unmount();
  });

  it('keeps provider fixed while editing every mutable field locally', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/operations/notifications');

    await wrapper.get('input[name="notificationEnabled"]').setValue(false);
    await wrapper.get('input[name="webhookUrl"]').setValue('https://example.invalid/changed');
    await wrapper.get('input[name="notifyAuthExpired"]').setValue(false);
    await wrapper.get('input[name="notifyTaskFailed"]').setValue(false);
    await wrapper.get('input[name="notifyConsecutiveFailure"]').setValue(false);
    await wrapper.get('input[name="notifyDeliveryUnknown"]').setValue(false);

    expect(wrapper.text()).toContain('Unsaved changes');
    expect(wrapper.get('select[name="provider"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('input[name="notifyDeliveryUnknown"]').element).toHaveProperty(
      'checked',
      false,
    );
    wrapper.unmount();
  });

  it('saves exactly once, sends the supported fields, and blocks duplicate submit', async () => {
    let resolvePut: ((response: Response) => void) | undefined;
    const pendingPut = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    const fetchMock = installApiFetch((url, init) =>
      url.pathname === '/api/notification-config' && init?.method === 'PUT'
        ? pendingPut
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/notifications');
    await wrapper.get('input[name="notifyTaskFailed"]').setValue(false);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');

    expect(button(wrapper, 'Saving…').attributes('disabled')).toBeDefined();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/api/notification-config') && init?.method === 'PUT',
      ),
    ).toHaveLength(1);
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/notification-config') && init?.method === 'PUT',
    )!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      enabled: true,
      provider: 'WEBHOOK',
      webhookUrl: 'https://example.invalid/webhook',
      notifyAuthExpired: true,
      notifyTaskFailed: false,
      notifyConsecutiveFailure: true,
      notifyDeliveryUnknown: true,
    });

    resolvePut?.(success({ ...notificationConfigurationFixture, notifyTaskFailed: false }));
    await flushPromises();
    expect(wrapper.text()).not.toContain('Unsaved changes');
    expect(wrapper.find('.toast').text()).toContain('Notification settings saved.');
    wrapper.unmount();
  });

  it('retains typed values after validation and mutation failures', async () => {
    installApiFetch((url, init) =>
      url.pathname === '/api/notification-config' && init?.method === 'PUT'
        ? failure('WEBHOOK_DESTINATION_BLOCKED', 'Webhook destination is not permitted.', 400)
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/notifications');
    await wrapper.get('input[name="webhookUrl"]').setValue('');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('Webhook URL is required');

    const typedUrl = 'https://example.invalid/blocked';
    await wrapper.get('input[name="webhookUrl"]').setValue(typedUrl);
    await wrapper.get('input[name="notifyTaskFailed"]').setValue(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'The webhook destination is blocked by the security policy.',
    );
    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty('value', typedUrl);
    expect(wrapper.get('input[name="notifyTaskFailed"]').element).toHaveProperty('checked', false);
    expect(wrapper.find('.toast').text()).not.toContain(typedUrl);
    wrapper.unmount();
  });

  it('does not expose unknown or sensitive response fields', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/notification-config'
        ? success({
            ...notificationConfigurationFixture,
            password: 'PRIVATE_PASSWORD_SENTINEL',
            token: 'PRIVATE_TOKEN_SENTINEL',
            secret: 'PRIVATE_SECRET_SENTINEL',
            profilePath: '/PRIVATE_PROFILE_SENTINEL',
            storageState: 'PRIVATE_STORAGE_SENTINEL',
            privateKey: 'PRIVATE_KEY_SENTINEL',
          })
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/notifications');
    expect(wrapper.text()).not.toMatch(
      /PRIVATE_(PASSWORD|TOKEN|SECRET|PROFILE|STORAGE|KEY)_SENTINEL/u,
    );
    expect(window.location.search).toBe('');
    wrapper.unmount();
  });

  it('uses only GET during initial page load', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/operations/notifications');
    expect(
      fetchMock.mock.calls
        .map(([, init]) => init?.method ?? 'GET')
        .filter((method) => method !== 'GET'),
    ).toEqual([]);
    wrapper.unmount();
  });
});

describe('Notifications realtime and dirty state', () => {
  it('coalesces clean CONFIG_CHANGED bursts into one refresh', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/operations/notifications');
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();

    source.emit(
      'config-changed',
      configEvent('NOTIFICATION', 'notification-config', undefined, '1'),
    );
    source.emit(
      'config-changed',
      configEvent('NOTIFICATION', 'notification-config', undefined, '2'),
    );
    source.emit(
      'config-changed',
      configEvent('NOTIFICATION', 'notification-config', undefined, '3'),
    );
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/notification-config')),
    ).toHaveLength(2);
    wrapper.unmount();
  });

  it('preserves a dirty form and warns instead of fetching on CONFIG_CHANGED', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/operations/notifications');
    const source = FakeEventSource.instances[0]!;
    await wrapper.get('input[name="webhookUrl"]').setValue('https://example.invalid/unsaved');
    vi.useFakeTimers();
    source.emit('config-changed', configEvent('NOTIFICATION', 'notification-config'));
    await vi.advanceTimersByTimeAsync(500);

    expect(wrapper.text()).toContain('Notification settings changed on the server.');
    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty(
      'value',
      'https://example.invalid/unsaved',
    );
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/notification-config')),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it('confirms before reloading and then applies the latest server configuration', async () => {
    let configReads = 0;
    installApiFetch((url) => {
      if (url.pathname !== '/api/notification-config') return undefined;
      configReads += 1;
      return success(
        configReads === 1
          ? notificationConfigurationFixture
          : {
              ...notificationConfigurationFixture,
              enabled: false,
              webhookUrl: 'https://example.invalid/reloaded',
            },
      );
    });
    installEventSource();
    const wrapper = await mountAdmin('/operations/notifications');
    await wrapper.get('input[name="webhookUrl"]').setValue('https://example.invalid/unsaved');
    vi.useFakeTimers();
    FakeEventSource.instances[0]!.emit(
      'config-changed',
      configEvent('NOTIFICATION', 'notification-config'),
    );
    await vi.advanceTimersByTimeAsync(500);
    await button(wrapper, 'Reload').trigger('click');

    const confirmation = wrapper.getComponent(DangerConfirmation);
    expect(confirmation.props('open')).toBe(true);
    confirmation.vm.$emit('confirm');
    await flushPromises();

    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty(
      'value',
      'https://example.invalid/reloaded',
    );
    expect(wrapper.get('input[name="notificationEnabled"]').element).toHaveProperty(
      'checked',
      false,
    );
    expect(wrapper.text()).not.toContain('Unsaved changes');
    wrapper.unmount();
  });

  it('retains the dirty draft after a confirmed reload fails and a later refresh succeeds', async () => {
    let configReads = 0;
    installApiFetch((url) => {
      if (url.pathname !== '/api/notification-config') return undefined;
      configReads += 1;
      if (configReads === 1) return success(notificationConfigurationFixture);
      if (configReads === 2) {
        return failure('SYNTHETIC_RELOAD_ERROR', 'Synthetic reload failure.', 500);
      }
      return success({
        ...notificationConfigurationFixture,
        webhookUrl: 'https://example.invalid/later-server-value',
      });
    });
    installEventSource();
    const wrapper = await mountAdmin('/operations/notifications');
    await wrapper.get('input[name="webhookUrl"]').setValue('https://example.invalid/unsaved');
    vi.useFakeTimers();
    FakeEventSource.instances[0]!.emit(
      'config-changed',
      configEvent('NOTIFICATION', 'notification-config'),
    );
    await vi.advanceTimersByTimeAsync(500);
    await button(wrapper, 'Reload').trigger('click');
    wrapper.getComponent(DangerConfirmation).vm.$emit('confirm');
    await flushPromises();

    expect(wrapper.text()).toContain('Synthetic reload failure.');
    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty(
      'value',
      'https://example.invalid/unsaved',
    );

    await wrapper.get('.notifications-page > .page-heading button').trigger('click');
    await flushPromises();
    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty(
      'value',
      'https://example.invalid/unsaved',
    );
    expect(wrapper.text()).toContain('Notification settings changed on the server.');
    wrapper.unmount();
  });

  it('keeps configuration editable during SSE reconnect', async () => {
    installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/operations/notifications');
    FakeEventSource.instances[0]!.emit('error');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.sse-status').text()).toBe('Reconnecting');
    expect(wrapper.get('input[name="webhookUrl"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.text()).toContain('Webhook configuration');
    wrapper.unmount();
  });

  it('bounds a successful save plus CONFIG_CHANGED echo without duplicate success toasts', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/operations/notifications');
    await wrapper.get('input[name="notifyTaskFailed"]').setValue(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    vi.useFakeTimers();
    FakeEventSource.instances[0]!.emit(
      'config-changed',
      configEvent('NOTIFICATION', 'notification-config', undefined, 'echo'),
    );
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();

    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).endsWith('/api/notification-config') && (init?.method ?? 'GET') === 'GET',
      ),
    ).toHaveLength(2);
    expect(wrapper.findAll('.toast')).toHaveLength(1);
    expect(wrapper.find('.toast').text()).toContain('Notification settings saved.');
    wrapper.unmount();
  });
});

describe('Test notification', () => {
  it('is unavailable without a saved URL but remains available when saved config is disabled', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/notification-config'
        ? success({ ...notificationConfigurationFixture, enabled: false, webhookUrl: null })
        : undefined,
    );
    const missing = await mountAdmin('/operations/notifications');
    expect(button(missing, 'Send test notification').attributes('disabled')).toBeDefined();
    missing.unmount();

    installApiFetch((url) =>
      url.pathname === '/api/notification-config'
        ? success({ ...notificationConfigurationFixture, enabled: false })
        : undefined,
    );
    const disabled = await mountAdmin('/operations/notifications');
    expect(button(disabled, 'Send test notification').attributes('disabled')).toBeUndefined();
    disabled.unmount();
  });

  it('posts exactly once under a double click and renders SENT fields', async () => {
    let resolvePost: ((response: Response) => void) | undefined;
    const pendingPost = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchMock = installApiFetch((url, init) =>
      url.pathname === '/api/notification-config/test' && init?.method === 'POST'
        ? pendingPost
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/notifications');
    const action = button(wrapper, 'Send test notification');
    await action.trigger('click');
    await action.trigger('click');

    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/api/notification-config/test') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(button(wrapper, 'Sending test…').attributes('disabled')).toBeDefined();
    resolvePost?.(success(notificationDeliveryFixture));
    await flushPromises();

    expect(wrapper.text()).toContain('Test notification sent');
    expect(wrapper.text()).toContain('Attempts');
    expect(wrapper.text()).toContain('204');
    wrapper.unmount();
  });

  it.each([
    [
      { status: 'FAILED', attempts: 3, failureCode: 'TIMEOUT' },
      'Test notification failed',
      'TIMEOUT',
    ],
    [
      { status: 'BLOCKED', attempts: 0, failureCode: 'DESTINATION_BLOCKED' },
      'Test notification blocked',
      'DESTINATION_BLOCKED',
    ],
  ])('renders the structured %s server result', async (result, title, detail) => {
    installApiFetch((url, init) =>
      url.pathname === '/api/notification-config/test' && init?.method === 'POST'
        ? success(result)
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/notifications');
    await button(wrapper, 'Send test notification').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(title);
    expect(wrapper.text()).toContain(detail);
    expect(wrapper.text()).not.toContain('Test notification sent');
    wrapper.unmount();
  });

  it('treats a network interruption as uncertain and never auto-retries', async () => {
    const fetchMock = installApiFetch((url, init) =>
      url.pathname === '/api/notification-config/test' && init?.method === 'POST'
        ? Promise.reject(new TypeError('synthetic connection interruption'))
        : undefined,
    );
    const wrapper = await mountAdmin('/operations/notifications');
    await button(wrapper, 'Send test notification').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('Test request result is uncertain');
    expect(wrapper.text()).toContain('Check the receiver before sending another test.');
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/api/notification-config/test') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });
});
