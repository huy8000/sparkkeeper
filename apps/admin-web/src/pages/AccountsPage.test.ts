import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import AccountForm from '../components/AccountForm.vue';
import { ACCOUNT_ID, accountFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, configEvent, installEventSource } from '../test/realtime';

describe('Accounts and workspace shell', () => {
  it('renders the account list with human identity and a direct workspace link', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/accounts');
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.text()).toContain('Ready');
    expect(wrapper.find(`a[href="/accounts/${ACCOUNT_ID}/overview"]`).exists()).toBe(true);
    expect(wrapper.text()).not.toContain(ACCOUNT_ID);
    wrapper.unmount();
  });

  it('distinguishes empty and API error account lists', async () => {
    installApiFetch((url) => (url.pathname === '/api/accounts' ? success([]) : undefined));
    const empty = await mountAdmin('/accounts');
    expect(empty.text()).toContain('No accounts');
    empty.unmount();

    installApiFetch((url) =>
      url.pathname === '/api/accounts'
        ? failure('DATABASE_UNAVAILABLE', 'Accounts are temporarily unavailable.', 503)
        : undefined,
    );
    const failed = await mountAdmin('/accounts');
    expect(failed.get('[role="alert"]').text()).toContain('Accounts are temporarily unavailable.');
    failed.unmount();
  });

  it('renders the shared account header and all routed tabs without UUID-primary UI', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.get('.account-workspace__header').text()).toContain(accountFixture.name);
    expect(wrapper.get('.account-workspace__header').text()).toContain('Ready');
    expect(wrapper.get('.account-workspace__header').text()).toContain('Enabled');
    expect(wrapper.get('.account-tabs').findAll('a')).toHaveLength(5);
    expect(wrapper.text()).not.toContain(ACCOUNT_ID);
    wrapper.unmount();
  });

  it('keeps the App Shell and routed tabs visible while the Account header is loading', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}`
        ? new Promise<Response>(() => undefined)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.text()).toContain('SparkKeeper');
    expect(wrapper.find('.sidebar').exists()).toBe(true);
    expect(wrapper.find('.topbar').exists()).toBe(true);
    expect(wrapper.find('.account-header-loading').exists()).toBe(true);
    expect(wrapper.find('.account-tabs').exists()).toBe(true);
    wrapper.unmount();
  });

  it('updates only name/enabled, closes the Drawer, and shows a success toast', async () => {
    const fetchMock = installApiFetch((url, init) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}` && init?.method === 'PATCH'
        ? success({ ...accountFixture, name: 'Edited Demo Account', enabled: false })
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    await wrapper.get('.account-workspace__header button').trigger('click');
    const form = wrapper.getComponent(AccountForm);
    expect(form.find('select[name="loginStatus"]').exists()).toBe(false);
    await form.get('input[name="accountName"]').setValue('Edited Demo Account');
    await form.get('input[name="accountEnabled"]').setValue(false);
    await form.get('form').trigger('submit');
    await flushPromises();

    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/accounts/${ACCOUNT_ID}`) && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(call![1]?.body))).toEqual({
      name: 'Edited Demo Account',
      enabled: false,
    });
    expect(JSON.parse(String(call![1]?.body))).not.toHaveProperty('loginStatus');
    expect(wrapper.text()).toContain('Account settings saved.');
    expect(document.body.querySelector('.drawer')).toBeNull();
    wrapper.unmount();
  });

  it('retains account form values and shows inline plus toast errors', async () => {
    installApiFetch((url, init) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}` && init?.method === 'PATCH'
        ? failure('CONFLICT', 'Account name conflicts with existing configuration.', 409)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    await wrapper.get('.account-workspace__header button').trigger('click');
    const form = wrapper.getComponent(AccountForm);
    await form.get('input[name="accountName"]').setValue('Retained Account Name');
    await form.get('form').trigger('submit');
    await flushPromises();

    expect(form.get('input[name="accountName"]').element).toHaveProperty(
      'value',
      'Retained Account Name',
    );
    expect(form.get('[role="alert"]').text()).toContain('conflicts');
    expect(wrapper.text()).toContain('Account settings could not be saved.');
    expect(document.body.querySelector('.drawer')).not.toBeNull();
    wrapper.unmount();
  });

  it.each([
    [404, 'Account not found', 'This account is not available.'],
    [500, 'Unable to load account', 'Account service failed.'],
  ])('renders safe account GET error %s', async (status, title, message) => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}`
        ? failure('ACCOUNT_READ_FAILED', message, status)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    expect(wrapper.text()).toContain(title);
    expect(wrapper.text()).toContain(message);
    expect(
      wrapper
        .findAll('a[href="/accounts"]')
        .some((link) => link.text().includes('Back to Accounts')),
    ).toBe(true);
    wrapper.unmount();
  });

  it('does not overwrite dirty account settings after CONFIG_CHANGED', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    await wrapper.get('.account-workspace__header button').trigger('click');
    const form = wrapper.getComponent(AccountForm);
    await form.get('input[name="accountName"]').setValue('Unsaved Account Name');

    vi.useFakeTimers();
    FakeEventSource.instances[0]!.emit('config-changed', configEvent('ACCOUNT', ACCOUNT_ID));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();

    expect(form.get('input[name="accountName"]').element).toHaveProperty(
      'value',
      'Unsaved Account Name',
    );
    expect(document.body.textContent).toContain('Account settings changed on the server.');
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(`/api/accounts/${ACCOUNT_ID}`),
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });
});
