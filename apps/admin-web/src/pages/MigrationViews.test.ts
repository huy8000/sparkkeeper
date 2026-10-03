import { flushPromises } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import { mountAdmin } from '../test/mountAdmin';
import { installApiFetch, success, failure } from '../test/http';
import { ACCOUNT_ID, FRIEND_ID, RUN_ID } from '../test/fixtures';
import MigrationPage from './MigrationPage.vue';
const date = '2026-10-03T00:00:00.000Z',
  contactId = '00000000-0000-4000-8000-000000000099',
  bindingId = '00000000-0000-4000-8000-000000000098';
describe('V4-9 explicit offline migration UI', () => {
  it('never auto binds/enables; explicit internal Contact selection and confirmation required, failed mutation is not retried', async () => {
    const fetch = installApiFetch((url, init) => {
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}/legacy-friend-bindings`)
        return success({
          items: [
            {
              id: bindingId,
              friendId: FRIEND_ID,
              accountId: ACCOUNT_ID,
              status: 'PENDING',
              contactId: null,
              updatedAt: date,
            },
          ],
          nextCursor: null,
        });
      if (url.pathname === '/api/legacy-schedule-imports')
        return success({ items: [], nextCursor: null });
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}/contacts`)
        return success({
          items: [
            {
              id: contactId,
              accountId: ACCOUNT_ID,
              type: 'PERSON',
              displayName: 'Same name',
              remarkName: null,
              avatarAssetId: null,
              streakDays: null,
              streakUpdatedAt: null,
              availabilityStatus: 'AVAILABLE',
              identityStatus: 'READY',
              createdAt: date,
              updatedAt: date,
              lastSeenAt: date,
              discoveredAt: date,
            },
          ],
          nextCursor: null,
          latestSync: null,
        });
      if (init?.method === 'POST' && url.pathname.endsWith('/bind'))
        return failure('CONFLICT', 'Refresh first.', 409);
      return undefined;
    });
    const wrapper = await mountAdmin('/operations/migration');
    const view = wrapper.findComponent(MigrationPage);
    await view.findAll('select')[0]!.setValue(ACCOUNT_ID);
    await flushPromises();
    expect(fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
    const bind = () => wrapper.findAll('button').find((b) => b.text() === '显式绑定')!;
    expect(bind().attributes('disabled')).toBeDefined();
    await view.findAll('select')[1]!.setValue([contactId]);
    expect(bind().attributes('disabled')).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await bind().trigger('click');
    await flushPromises();
    const posts = fetch.mock.calls.filter(([, i]) => i?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]?.body))).toEqual({
      contactId,
      expectedUpdatedAt: date,
      confirmationText: 'BIND',
    });
    expect(wrapper.text()).toContain('不会自动重试');
    expect(wrapper.find('input[name="profilePath"]').exists()).toBe(false);
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/enable'))).toBe(false);
    wrapper.unmount();
  });
  it('mixed history keeps source/kind and resolves UNKNOWN only explicitly, no retry/send/enable route', async () => {
    const recordId = '00000000-0000-4000-8000-000000000077';
    const run = {
      id: RUN_ID,
      source: 'V4',
      kind: 'TEST_SEND',
      accountId: ACCOUNT_ID,
      taskId: null,
      businessDate: null,
      status: 'DELIVERY_UNKNOWN',
      startedAt: date,
      finishedAt: date,
      createdAt: date,
      updatedAt: date,
    };
    const record = {
      id: recordId,
      source: 'V4',
      runId: RUN_ID,
      status: 'DELIVERY_UNKNOWN',
      friendId: null,
      contactId,
      attempts: 1,
      sendActionStarted: true,
      latestResolution: null,
    };
    const fetch = installApiFetch((url, init) => {
      if (url.pathname === `/api/runs/${RUN_ID}`) return success(run);
      if (url.pathname.endsWith('/send-records')) return success([record]);
      if (url.pathname.endsWith('/resolutions') && init?.method === 'POST')
        return failure('CONFLICT', 'Changed.', 409);
      return undefined;
    });
    const wrapper = await mountAdmin(`/history/${RUN_ID}`);
    expect(wrapper.text()).toContain('V4 / TEST_SEND');
    expect(fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
    const action = wrapper.findAll('button').find((b) => b.text() === '追加人工 resolution')!;
    expect(action.attributes('disabled')).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await action.trigger('click');
    await flushPromises();
    expect(fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1);
    expect(wrapper.text()).toContain('不会自动重试');
    expect(fetch.mock.calls.some(([u]) => /test-sends|manual-runs|\/enable/.test(String(u)))).toBe(
      false,
    );
    wrapper.unmount();
  });
});
