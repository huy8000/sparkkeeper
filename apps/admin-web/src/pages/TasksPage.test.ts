import { describe, it, expect } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ACCOUNT_ID, TEMPLATE_ID } from '../test/fixtures';
import { installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import TasksPage from './TasksPage.vue';
import { parseTask, parseScheduledRun } from '../api/taskApi';
const contactId = '00000000-0000-4000-8000-000000000081',
  id = '00000000-0000-4000-8000-000000000082',
  date = '2026-10-03T00:00:00.000Z';
const task = {
  id,
  name: '<script>Synthetic task</script>',
  accountId: ACCOUNT_ID,
  templateId: TEMPLATE_ID,
  contactIds: [contactId],
  schedule: {
    type: 'DAILY_WINDOW',
    startTime: '09:00',
    endTime: '18:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 3,
    retryIntervalSeconds: 60,
  },
  enabled: false,
  archivedAt: null,
  updatedAt: date,
  state: 'DISABLED',
  overlaps: [],
  latestRun: null,
};
function install(existing = false, released = false) {
  return installApiFetch((url, init) => {
    if (url.pathname === '/api/tasks')
      return success(
        init?.method === 'POST'
          ? task
          : { items: existing ? [task] : [], masterOpen: false, released },
        init?.method === 'POST' ? 201 : 200,
      );
    if (url.pathname.startsWith('/api/tasks/'))
      return success({ ...task, archivedAt: date, state: 'ARCHIVED' });
    if (url.pathname === `/api/accounts/${ACCOUNT_ID}/contacts`)
      return success({
        items: [
          {
            id: contactId,
            accountId: ACCOUNT_ID,
            type: 'PERSON',
            displayName: 'Synthetic contact',
            remarkName: null,
            avatarAssetId: null,
            streakDays: null,
            streakUpdatedAt: null,
            availabilityStatus: 'AVAILABLE',
            identityStatus: 'READY',
            createdAt: date,
            updatedAt: date,
            discoveredAt: date,
            lastSeenAt: date,
          },
        ],
        nextCursor: null,
        latestSync: null,
      });
    return undefined;
  });
}
describe('V4-8 tasks UI', () => {
  it('load is read-only; user selects explicit target and saves disabled config once despite duplicate submission', async () => {
    const fetch = install();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/tasks`);
    const page = wrapper.findComponent(TasksPage);
    expect(fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
    await page.find('input[maxlength="120"]').setValue('Synthetic task');
    await page.findAll('select')[1]!.setValue(TEMPLATE_ID);
    await page.find('input[type="checkbox"]').setValue(true);
    await Promise.all([page.find('form').trigger('submit'), page.find('form').trigger('submit')]);
    await flushPromises();
    const calls = fetch.mock.calls.filter(
      ([u, i]) => String(u).endsWith('/tasks') && i?.method === 'POST',
    );
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]![1]?.body));
    expect(body.contactIds).toEqual([contactId]);
    expect(body.enabled).toBeUndefined();
    expect(body.messageText).toBeUndefined();
    wrapper.unmount();
  });
  it('saved-version archive needs confirmation; production enable stays disabled; server names escaped', async () => {
    const fetch = install(true);
    const wrapper = await mountAdmin('/tasks');
    const page = wrapper.findComponent(TasksPage);
    expect(wrapper.findAll('script')).toHaveLength(0);
    await page.find('article button').trigger('click');
    await flushPromises();
    expect(page.get('[data-testid="enable-task"]').attributes('disabled')).toBeDefined();
    expect(page.get('[data-testid="archive-task"]').attributes('disabled')).toBeDefined();
    await page.findAll('form input[type="checkbox"]').at(-1)!.setValue(true);
    await page.get('[data-testid="archive-task"]').trigger('click');
    await flushPromises();
    const mutations = fetch.mock.calls.filter(([, i]) => i?.method === 'POST');
    expect(mutations).toHaveLength(1);
    expect(String(mutations[0]![0])).toContain('/archive');
    expect(JSON.parse(String(mutations[0]![1]?.body))).toEqual({
      expectedUpdatedAt: date,
      confirmationText: 'ARCHIVE',
    });
    wrapper.unmount();
  });
  it('rejects duplicate targets and unsafe record state, never renders arbitrary server shapes', () => {
    expect(parseTask({ ...task, contactIds: [contactId, contactId] })).toBeUndefined();
    expect(parseTask(task)).toBeDefined();
    expect(
      parseScheduledRun({
        runId: id,
        kind: 'SCHEDULED_TASK',
        accountId: ACCOUNT_ID,
        taskId: id,
        businessDate: '2026-10-03',
        status: 'DELIVERY_UNKNOWN',
        finishedAt: date,
        records: [
          {
            id,
            contactId,
            machineStatus: 'DELIVERY_UNKNOWN',
            attemptCount: 6,
            failureCode: 'DELIVERY_VERIFICATION_TIMEOUT',
            nextRetryAt: null,
            sendActionStartedAt: date,
          },
        ],
      }),
    ).toBeUndefined();
  });
});
