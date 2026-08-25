import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_ID,
  TEMPLATE_ID,
  accountFixture,
  friendFixture,
  manualRunPreflightFixture,
  runtimeFixture,
} from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, configEvent, installEventSource } from '../test/realtime';

describe('Accounts', () => {
  it('renders the account list and links to detail', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/accounts');

    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.text()).toContain('READY');
    expect(wrapper.find(`a[href="/accounts/${ACCOUNT_ID}"]`).exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders an empty account state', async () => {
    installApiFetch((url) => (url.pathname === '/api/accounts' ? success([]) : undefined));
    const wrapper = await mountAdmin('/accounts');

    expect(wrapper.text()).toContain('No accounts');
    wrapper.unmount();
  });

  it('renders a safe account-list error', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/accounts'
        ? failure('DATABASE_UNAVAILABLE', 'Accounts are temporarily unavailable.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin('/accounts');

    expect(wrapper.find('[role="alert"]').text()).toContain(
      'Accounts are temporarily unavailable.',
    );
    wrapper.unmount();
  });

  it('renders account detail, a disabled friend, identity fallback, and schedules', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);

    expect(wrapper.text()).toContain(accountFixture.name);
    expect(wrapper.text()).toContain(friendFixture.displayName);
    expect(wrapper.text()).toContain('shortId');
    expect(wrapper.text()).toContain('DISABLED');
    expect(wrapper.text()).toContain('09:00–10:30');
    expect(wrapper.text()).toContain('30 sec');
    expect(wrapper.findAll('button').some((button) => button.text() === 'Edit account')).toBe(true);
    expect(wrapper.findAll('button').some((button) => button.text() === 'Add friend')).toBe(true);
    expect(
      wrapper.findAll('button').some((button) => /delete|send|resolve/i.test(button.text())),
    ).toBe(false);
    wrapper.unmount();
  });

  it('keeps Manual Run visible but disabled by the default server gate', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Manual Run')!;
    expect(button.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Manual Run is disabled by server configuration.');
    expect(wrapper.text()).not.toContain('Enable Manual Run');
    expect(wrapper.text()).not.toContain('Enable Real Send');
    wrapper.unmount();
  });

  it('disables Manual Run when real-send authorization is off', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runtime/status'
        ? success({ ...runtimeFixture, manualRunEnabled: true })
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);
    expect(wrapper.text()).toContain('Real send authorization is disabled.');
    expect(
      wrapper
        .findAll('button')
        .find((candidate) => candidate.text() === 'Manual Run')
        ?.attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });

  it('preflights, explicitly confirms, sends acknowledgement once, and navigates on 202', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/runtime/status'
        ? success({
            ...runtimeFixture,
            manualRunEnabled: true,
            realSendAuthorizationEnabled: true,
          })
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Manual Run')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="dialog"]').text()).toContain('Real external side effect');
    await wrapper.get('#manual-template').setValue(TEMPLATE_ID);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Review preflight')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.text()).toContain('Enabled contacts');
    expect(wrapper.text()).toContain('Manual Run gate');
    expect(wrapper.text()).toContain('Real send authorization');
    expect(wrapper.text()).toContain('This action may send real messages');
    const accept = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Accept Manual Run')!;
    expect(accept.attributes('disabled')).toBeDefined();
    await wrapper.get('.confirmation-row input').setValue(true);
    await accept.trigger('click');
    await flushPromises();

    const calls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/api/accounts/${ACCOUNT_ID}/manual-runs`) && init?.method === 'POST',
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({
      templateId: TEMPLATE_ID,
      acknowledgeRealSend: true,
    });
    expect(new Headers(calls[0]![1]?.headers).get('X-SparkKeeper-Admin-Request')).toBe('1');
    expect(window.location.pathname).toContain('/runs/');
    expect(wrapper.text()).toContain(
      'Manual Run request accepted. The final outcome appears below.',
    );
    expect(wrapper.text()).not.toContain('sent successfully');
    wrapper.unmount();
  });

  it('shows stable blocked reasons and does not submit a blocked preflight', async () => {
    const fetchMock = installApiFetch((url) => {
      if (url.pathname === '/api/runtime/status') {
        return success({
          ...runtimeFixture,
          manualRunEnabled: true,
          realSendAuthorizationEnabled: true,
        });
      }
      if (url.pathname.endsWith('/manual-run/preflight')) {
        return success({
          ...manualRunPreflightFixture,
          canRun: false,
          currentDailyRunStatus: 'SUCCESS',
          blockedReasons: ['RUN_ALREADY_COMPLETE'],
        });
      }
      return undefined;
    });
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Manual Run')!
      .trigger('click');
    await flushPromises();
    await wrapper.get('#manual-template').setValue(TEMPLATE_ID);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Review preflight')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('already complete');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/manual-runs'))).toBe(false);
    wrapper.unmount();
  });

  it('reports conflicts safely and treats a network failure as uncertain without retry', async () => {
    let postCount = 0;
    const fetchMock = installApiFetch((url, init) => {
      if (url.pathname === '/api/runtime/status') {
        return success({
          ...runtimeFixture,
          manualRunEnabled: true,
          realSendAuthorizationEnabled: true,
        });
      }
      if (url.pathname.endsWith('/manual-runs') && init?.method === 'POST') {
        postCount++;
        return Promise.reject(new TypeError('Private network diagnostic'));
      }
      return undefined;
    });
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Manual Run')!
      .trigger('click');
    await flushPromises();
    await wrapper.get('#manual-template').setValue(TEMPLATE_ID);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Review preflight')!
      .trigger('click');
    await flushPromises();
    await wrapper.get('.confirmation-row input').setValue(true);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Accept Manual Run')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('status is uncertain');
    expect(wrapper.text()).not.toContain('Private network diagnostic');
    expect(postCount).toBe(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/manual-runs')),
    ).toHaveLength(1);
    expect(wrapper.text()).toContain('Check Runs');
    expect(
      wrapper
        .findAll('button')
        .find((candidate) => candidate.text() === 'Accept Manual Run')
        ?.attributes('disabled'),
    ).toBeDefined();
    wrapper.unmount();
  });

  it('renders a safe 409 in the confirmation dialog', async () => {
    installApiFetch((url, init) => {
      if (url.pathname === '/api/runtime/status') {
        return success({
          ...runtimeFixture,
          manualRunEnabled: true,
          realSendAuthorizationEnabled: true,
        });
      }
      if (url.pathname.endsWith('/manual-runs') && init?.method === 'POST') {
        return failure('RUN_ALREADY_IN_PROGRESS', 'A run is already in progress.', 409);
      }
      return undefined;
    });
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Manual Run')!
      .trigger('click');
    await flushPromises();
    await wrapper.get('#manual-template').setValue(TEMPLATE_ID);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Review preflight')!
      .trigger('click');
    await flushPromises();
    await wrapper.get('.confirmation-row input').setValue(true);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Accept Manual Run')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('already in progress');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('creates an Account with a centralized mutation request', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/accounts');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Create account')!
      .trigger('click');
    await wrapper.get('input[name="accountName"]').setValue('New Demo Account');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/accounts') && init?.method === 'POST',
    );
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({ name: 'New Demo Account' });
    expect(wrapper.text()).toContain('Account configuration saved.');
    wrapper.unmount();
  });

  it('validates Account creation and renders a safe server error', async () => {
    installApiFetch((url, init) =>
      url.pathname === '/api/accounts' && init?.method === 'POST'
        ? failure('CONFLICT', 'Account configuration conflicts with existing data.', 409)
        : undefined,
    );
    const wrapper = await mountAdmin('/accounts');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Create account')!
      .trigger('click');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('Account name is required.');
    await wrapper.get('input[name="accountName"]').setValue('Demo Conflict');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Account configuration conflicts');
    wrapper.unmount();
  });

  it('edits Account configuration while keeping loginStatus read-only', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit account')!
      .trigger('click');
    expect(wrapper.text()).toContain('Runtime state; not editable here.');
    expect(wrapper.find('select[name="loginStatus"]').exists()).toBe(false);
    await wrapper.get('input[name="accountName"]').setValue('Edited Demo Account');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes(`/api/accounts/${ACCOUNT_ID}`) && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(call![1]?.body))).not.toHaveProperty('loginStatus');
    wrapper.unmount();
  });

  it('creates and edits Friends with match-field validation and enabled state', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add friend')!
      .trigger('click');
    await wrapper.get('input[name="displayName"]').setValue('Demo Contact Beta');
    await wrapper.get('select[name="matchField"]').setValue('uniqueId');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('selected uniqueId');
    await wrapper.get('input[name="uniqueId"]').setValue('demo-contact-beta');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(`/api/accounts/${ACCOUNT_ID}/friends`) && init?.method === 'POST',
      ),
    ).toBe(true);

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit')!
      .trigger('click');
    await wrapper.get('input[name="friendEnabled"]').setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const update = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/api/friends/') && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(update![1]?.body))).toMatchObject({ enabled: true });
    wrapper.unmount();
  });

  it('renders a clear entity not-found state', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}`
        ? failure('ACCOUNT_NOT_FOUND', 'Internal account lookup failed.', 404)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);

    expect(wrapper.text()).toContain('Account not found');
    expect(wrapper.text()).toContain('This account is not available.');
    expect(wrapper.text()).not.toContain('Internal account lookup failed.');
    wrapper.unmount();
  });

  it('refreshes the mounted Account view after a debounced ACCOUNT invalidation', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/accounts');
    const source = FakeEventSource.instances[0]!;
    const accountLoads = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/api/accounts') && (init?.method ?? 'GET') === 'GET',
      ).length;
    expect(accountLoads()).toBe(1);

    vi.useFakeTimers();
    source.emit('config-changed', configEvent('ACCOUNT', ACCOUNT_ID));
    source.emit('config-changed', configEvent('ACCOUNT', ACCOUNT_ID, undefined, '4'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();
    expect(accountLoads()).toBe(2);
    wrapper.unmount();
  });
});
