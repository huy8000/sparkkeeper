import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ACCOUNT_ID } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, configEvent, installEventSource } from '../test/realtime';

describe('Schedules', () => {
  it('aggregates account-scoped schedules and distinguishes runtime control', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/schedules');

    expect(wrapper.text()).toContain('Runtime scheduler');
    expect(wrapper.text()).toContain('Schedule enabled');
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.find(`a[href="/accounts/${ACCOUNT_ID}"]`).exists()).toBe(true);
    expect(
      wrapper.findAll('button').some((button) => /toggle|enable|disable/i.test(button.text())),
    ).toBe(false);
    wrapper.unmount();
  });

  it('edits a Schedule and explains business enabled versus runtime controls', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/schedules');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit')!
      .trigger('click');
    expect(wrapper.text()).toContain(
      'does not change the runtime Scheduler or Real Send Authorization',
    );
    await wrapper.get('input[name="startTime"]').setValue('11:00');
    await wrapper.get('input[name="endTime"]').setValue('10:00');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('Start time must be before end time');
    await wrapper.get('input[name="startTime"]').setValue('08:30');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith(`/api/accounts/${ACCOUNT_ID}/schedule`) && init?.method === 'PUT',
      ),
    ).toBe(true);
    const update = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/accounts/${ACCOUNT_ID}/schedule`) && init?.method === 'PUT',
    );
    expect(Object.keys(JSON.parse(String(update![1]?.body))).sort()).toEqual([
      'enabled',
      'endTime',
      'maxAttempts',
      'retryIntervalSeconds',
      'startTime',
      'timezone',
    ]);
    expect(wrapper.text()).toContain('Schedule configuration saved.');
    wrapper.unmount();
  });

  it('renders an empty schedule state', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/schedules` ? success([]) : undefined,
    );
    const wrapper = await mountAdmin('/schedules');

    expect(wrapper.text()).toContain('No schedules');
    wrapper.unmount();
  });

  it('renders a safe Schedule mutation server error', async () => {
    installApiFetch((url, init) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/schedule` && init?.method === 'PUT'
        ? failure('VALIDATION_ERROR', 'Schedule configuration is invalid.', 400)
        : undefined,
    );
    const wrapper = await mountAdmin('/schedules');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit')!
      .trigger('click');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'The submitted input is invalid. Please review it and try again.',
    );
    expect(wrapper.html()).not.toMatch(
      /private_stack_sentinel|database path|browser profile|fixture-only-token/iu,
    );
    wrapper.unmount();
  });

  it('refreshes the mounted Schedule view after SCHEDULE invalidation', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/schedules');
    const source = FakeEventSource.instances[0]!;
    const scheduleLoads = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith(`/api/accounts/${ACCOUNT_ID}/schedules`),
      ).length;
    expect(scheduleLoads()).toBe(1);
    vi.useFakeTimers();
    source.emit(
      'config-changed',
      configEvent('SCHEDULE', '00000000-0000-4000-8000-000000000003', ACCOUNT_ID),
    );
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();
    expect(scheduleLoads()).toBe(2);
    wrapper.unmount();
  });
});
