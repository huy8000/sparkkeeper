import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import FriendForm from '../components/FriendForm.vue';
import { ACCOUNT_ID, FRIEND_ID, friendFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Account Friends', () => {
  it('renders the friend list, disabled state, match strategy, and no delete control', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    expect(wrapper.text()).toContain(friendFixture.displayName);
    expect(wrapper.text()).toContain('Disabled');
    expect(wrapper.text()).toContain('Short ID');
    expect(wrapper.text()).toContain('Configured');
    expect(wrapper.findAll('button').some((button) => /delete/i.test(button.text()))).toBe(false);
    expect(wrapper.text()).not.toContain(friendFixture.shortId);
    wrapper.unmount();
  });

  it('shows the low-stability notice for Display Name matching', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/friends`
        ? success([{ ...friendFixture, matchField: 'displayName', enabled: true }])
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    expect(wrapper.text()).toContain('Display name');
    expect(wrapper.text()).toContain('Low stability');
    wrapper.unmount();
  });

  it('distinguishes empty from API error and keeps Add friend available', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/friends` ? success([]) : undefined,
    );
    const empty = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    expect(empty.text()).toContain('No friends configured');
    expect(empty.text()).toContain('Only enabled friends participate in runs.');
    expect(empty.findAll('button').some((button) => button.text() === 'Add friend')).toBe(true);
    empty.unmount();

    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/friends`
        ? failure('FRIENDS_UNAVAILABLE', 'Friends could not be loaded.', 503)
        : undefined,
    );
    const failed = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    expect(failed.get('[role="alert"]').text()).toContain('Friends could not be loaded.');
    expect(failed.text()).not.toContain('No friends configured');
    failed.unmount();
  });

  it('creates a Friend through the account endpoint with synthetic identity', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add friend')!
      .trigger('click');
    const form = wrapper.getComponent(FriendForm);
    await form.get('input[name="displayName"]').setValue('Friend A');
    await form.get('select[name="matchField"]').setValue('uniqueId');
    await form.get('input[name="uniqueId"]').setValue('synthetic-friend-a');
    await form.get('form').trigger('submit');
    await flushPromises();

    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/accounts/${ACCOUNT_ID}/friends`) && init?.method === 'POST',
    );
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({
      displayName: 'Friend A',
      uniqueId: 'synthetic-friend-a',
      matchField: 'uniqueId',
      enabled: true,
    });
    expect(wrapper.text()).toContain('Friend configuration saved.');
    wrapper.unmount();
  });

  it('edits a Friend through PATCH and preserves the disabled option', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit')!
      .trigger('click');
    const form = wrapper.getComponent(FriendForm);
    await form.get('input[name="friendEnabled"]').setValue(true);
    await form.get('form').trigger('submit');
    await flushPromises();
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/friends/${FRIEND_ID}`) && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({ enabled: true });
    wrapper.unmount();
  });

  it.each([
    ['uniqueId', 'Unique ID is required'],
    ['secUid', 'Sec UID is required'],
  ])('requires the selected %s match field before POST', async (matchField, errorText) => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add friend')!
      .trigger('click');
    const form = wrapper.getComponent(FriendForm);
    await form.get('input[name="displayName"]').setValue('Friend A');
    await form.get('select[name="matchField"]').setValue(matchField);
    await form.get('form').trigger('submit');
    expect(form.get('[role="alert"]').text()).toContain(errorText);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/friends') && init?.method === 'POST',
      ),
    ).toBe(false);
    wrapper.unmount();
  });

  it('retains Friend form values after a mutation error', async () => {
    installApiFetch((url, init) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/friends` && init?.method === 'POST'
        ? failure('CONFLICT', 'Friend identity conflicts with existing configuration.', 409)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add friend')!
      .trigger('click');
    const form = wrapper.getComponent(FriendForm);
    await form.get('input[name="displayName"]').setValue('Retained Friend');
    await form.get('form').trigger('submit');
    await flushPromises();
    expect(form.get('input[name="displayName"]').element).toHaveProperty(
      'value',
      'Retained Friend',
    );
    expect(form.get('[role="alert"]').text()).toContain('conflicts');
    expect(wrapper.text()).toContain('Friend configuration could not be saved.');
    wrapper.unmount();
  });
});
