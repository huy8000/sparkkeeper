import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, configEvent, installEventSource } from '../test/realtime';

describe('Notifications', () => {
  it('renders the persisted WEBHOOK configuration as non-link configuration text', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/notifications');

    expect(wrapper.text()).toContain('Webhook notifications');
    expect(wrapper.get('input[name="webhookUrl"]').element).toHaveProperty(
      'value',
      'https://example.invalid/webhook',
    );
    expect(wrapper.find('a[href="https://example.invalid/webhook"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('AUTH_EXPIRED');
    wrapper.unmount();
  });

  it('saves typed event preferences through the centralized JSON mutation client', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/notifications');
    await wrapper.get('input[name="notifyTaskFailed"]').setValue(false);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/notification-config') && init?.method === 'PUT',
    );
    expect(call).toBeDefined();
    expect(call![1]?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-SparkKeeper-Admin-Request': '1',
    });
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({
      provider: 'WEBHOOK',
      notifyTaskFailed: false,
    });
    expect(consoleSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('validates an enabled blank destination and displays safe server errors', async () => {
    installApiFetch((url, init) =>
      url.pathname === '/api/notification-config' && init?.method === 'PUT'
        ? failure('WEBHOOK_DESTINATION_BLOCKED', 'Webhook destination is not permitted.', 400)
        : undefined,
    );
    const wrapper = await mountAdmin('/notifications');
    await wrapper.get('input[name="webhookUrl"]').setValue('');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('Webhook URL is required');

    await wrapper.get('input[name="webhookUrl"]').setValue('https://example.invalid/blocked');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Webhook destination is not permitted.');
    expect(wrapper.text()).not.toMatch(/stack trace|database path|browser profile|cookie|token/iu);
    wrapper.unmount();
  });

  it('sends only the fixed test action and shows delivery status', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/notifications');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Send test notification')!
      .trigger('click');
    await flushPromises();

    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/notification-config/test') && init?.method === 'POST',
    );
    expect(JSON.parse(String(call![1]?.body))).toEqual({});
    expect(wrapper.text()).toContain('Test notification delivered');
    expect(String(call![1]?.body)).not.toMatch(/message|text|body/iu);
    wrapper.unmount();
  });

  it('does not report failed or blocked test delivery as success', async () => {
    installApiFetch((url, init) =>
      url.pathname === '/api/notification-config/test' && init?.method === 'POST'
        ? success({ status: 'FAILED', attempts: 3, failureCode: 'TIMEOUT' })
        : undefined,
    );
    const wrapper = await mountAdmin('/notifications');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Send test notification')!
      .trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('failed after bounded attempts');
    expect(wrapper.text()).not.toContain('Test notification delivered');
    wrapper.unmount();
  });

  it('refreshes only for NOTIFICATION configuration invalidation', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/notifications');
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();
    source.emit('config-changed', configEvent('NOTIFICATION', 'notification-config'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/notification-config'))
        .length,
    ).toBe(2);
    wrapper.unmount();
  });
});
