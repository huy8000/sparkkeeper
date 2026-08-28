import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ACCOUNT_ID, RUN_ID, accountFixture, friendFixture } from '../test/fixtures';
import { installApiFetch, success } from '../test/http';
import { FakeEventSource, installEventSource, readyEvent } from '../test/realtime';
import { mountAdmin } from '../test/mountAdmin';
import FriendForm from '../components/FriendForm.vue';

function accountRuntimeEvent(eventType: string, id: string) {
  return {
    id,
    type: 'RUNTIME_EVENT',
    timestamp: '2026-01-02T03:04:05.000Z',
    data: {
      eventType,
      level: 'info',
      message: 'Synthetic workspace event.',
      runId: RUN_ID,
      accountId: ACCOUNT_ID,
      businessDate: '2026-01-02',
    },
  };
}

describe('Account Workspace realtime', () => {
  it('coalesces relevant Run events and ignores high-frequency progress events', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    const source = FakeEventSource.instances[0]!;
    const runLoads = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).includes('/api/runs?') && (init?.method ?? 'GET') === 'GET',
      ).length;
    expect(runLoads()).toBe(1);

    vi.useFakeTimers();
    source.emit('runtime', accountRuntimeEvent('RUN_FINISHED', 'run-1'));
    source.emit('runtime', accountRuntimeEvent('RUN_FINISHED', 'run-2'));
    source.emit('runtime', accountRuntimeEvent('MESSAGE_SENDING', 'progress-1'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(runLoads()).toBe(2);
    wrapper.unmount();
  });

  it('preserves REST content during reconnect and refreshes the active tab once on READY', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/history`);
    const source = FakeEventSource.instances[0]!;
    source.emit('open');
    await flushPromises();
    expect(wrapper.text()).toContain('2026-01-02');
    const runLoads = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/runs?')).length;
    expect(runLoads()).toBe(1);

    source.emit('error');
    await flushPromises();
    expect(wrapper.text()).toContain('Reconnecting');
    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.find('button').exists()).toBe(true);

    vi.useFakeTimers();
    source.emit('ready', readyEvent('reconnected'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(wrapper.text()).toContain('Live');
    expect(runLoads()).toBe(2);
    wrapper.unmount();
  });

  it('keeps an editable Friend form and its values during SSE reconnect', async () => {
    installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    const source = FakeEventSource.instances[0]!;
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add friend')!
      .trigger('click');
    const form = wrapper.getComponent(FriendForm);
    await form.get('input[name="displayName"]').setValue('Retained During Reconnect');
    source.emit('error');
    await flushPromises();
    expect(wrapper.text()).toContain('Reconnecting');
    expect(form.get('input[name="displayName"]').element).toHaveProperty(
      'value',
      'Retained During Reconnect',
    );
    expect(form.get('input[name="displayName"]').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('switches Account A to Account B and ignores a late A tab response', async () => {
    const accountB = '00000000-0000-4000-8000-000000000099';
    let resolveAFriends!: (response: Response) => void;
    const pendingAFriends = new Promise<Response>((resolve) => {
      resolveAFriends = resolve;
    });
    installApiFetch((url) => {
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}/friends`) return pendingAFriends;
      if (url.pathname === `/api/accounts/${accountB}`) {
        return success({ ...accountFixture, id: accountB, name: 'Account B' });
      }
      if (url.pathname === `/api/accounts/${accountB}/friends`) {
        return success([{ ...friendFixture, accountId: accountB, displayName: 'Friend B' }]);
      }
      return undefined;
    });
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    const router = (wrapper.vm as unknown as { $router: { push: (path: string) => Promise<void> } })
      .$router;
    await router.push(`/accounts/${accountB}/friends`);
    await flushPromises();
    resolveAFriends(success([{ ...friendFixture, displayName: 'Late Friend A' }]));
    await flushPromises();

    expect(wrapper.text()).toContain('Account B');
    expect(wrapper.text()).toContain('Friend B');
    expect(wrapper.text()).not.toContain('Late Friend A');
    wrapper.unmount();
  });
});
