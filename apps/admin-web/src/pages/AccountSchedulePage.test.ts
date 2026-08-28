import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import ScheduleForm from '../components/ScheduleForm.vue';
import { ACCOUNT_ID, scheduleFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, configEvent, installEventSource } from '../test/realtime';

describe('Account Schedule', () => {
  it('loads the existing 0..1 schedule and renders current configuration semantics', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/schedule`);
    expect(wrapper.text()).toContain('09:00–10:30');
    expect(wrapper.text()).toContain('Asia/Shanghai');
    expect(wrapper.text()).toContain('Maximum attempts');
    expect(wrapper.text()).toContain('3');
    expect(wrapper.text()).toContain('30 seconds');
    expect(wrapper.text()).toContain('Manual Run uses server preflight');
    expect(wrapper.text()).toContain('Runtime Scheduler');
    expect(wrapper.find('input[name="schedulerEnabled"]').exists()).toBe(false);
    expect(wrapper.find('input[name="realSendAuthorizationEnabled"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders no Schedule as an empty configuration state', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/schedules` ? success([]) : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/schedule`);
    expect(wrapper.text()).toContain('No schedule configured');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it.each([
    [[], 'Configure schedule'],
    [[scheduleFixture], 'Edit schedule'],
  ])('saves create/update through the same account PUT contract', async (schedules, action) => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/schedules` ? success(schedules) : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/schedule`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === action)!
      .trigger('click');
    const form = wrapper.getComponent(ScheduleForm);
    await form.get('form').trigger('submit');
    await flushPromises();
    const calls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith(`/api/accounts/${ACCOUNT_ID}/schedule`) && init?.method === 'PUT',
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]![1]?.body))).toMatchObject({
      startTime: schedules.length === 0 ? '09:00' : '09:00',
      enabled: true,
      maxAttempts: 3,
    });
    expect(wrapper.text()).toContain('Schedule configuration saved.');
    wrapper.unmount();
  });

  it.each([
    ['startTime', '11:00', 'Start time must be before end time.'],
    ['maxAttempts', '6', 'Maximum attempts must be from 1 through 5.'],
    ['retryIntervalSeconds', '0', 'Retry interval must be from 1 through 86400 seconds.'],
  ])('validates %s before sending PUT', async (field, value, message) => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/schedule`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit schedule')!
      .trigger('click');
    const form = wrapper.getComponent(ScheduleForm);
    await form.get(`input[name="${field}"]`).setValue(value);
    await form.get('form').trigger('submit');
    expect(form.get('[role="alert"]').text()).toContain(message);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/schedule') && init?.method === 'PUT',
      ),
    ).toBe(false);
    wrapper.unmount();
  });

  it('protects against duplicate save submissions and exposes loading', async () => {
    let resolvePut!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    const fetchMock = installApiFetch((url, init) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/schedule` && init?.method === 'PUT'
        ? pending
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/schedule`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit schedule')!
      .trigger('click');
    const form = wrapper.getComponent(ScheduleForm);
    await form.get('form').trigger('submit');
    await form.get('form').trigger('submit');
    expect(form.text()).toContain('Saving…');
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/schedule') && init?.method === 'PUT',
      ),
    ).toHaveLength(1);
    resolvePut(success(scheduleFixture));
    await flushPromises();
    wrapper.unmount();
  });

  it('retains schedule values after a save API error', async () => {
    installApiFetch((url, init) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/schedule` && init?.method === 'PUT'
        ? failure('INVALID_SCHEDULE', 'Schedule could not be saved.', 400)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/schedule`);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit schedule')!
      .trigger('click');
    const form = wrapper.getComponent(ScheduleForm);
    await form.get('input[name="timezone"]').setValue('Asia/Tokyo');
    await form.get('form').trigger('submit');
    await flushPromises();
    expect(form.get('input[name="timezone"]').element).toHaveProperty('value', 'Asia/Tokyo');
    expect(form.get('[role="alert"]').text()).toContain('Schedule could not be saved.');
    expect(wrapper.text()).toContain('Schedule configuration could not be saved.');
    expect(document.body.querySelector('.drawer')).not.toBeNull();
    wrapper.unmount();
  });

  it('keeps the tab visible while Schedule GET is pending', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/schedules`
        ? new Promise<Response>(() => undefined)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/schedule`);
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.find('.account-tabs').exists()).toBe(true);
    expect(wrapper.get('.section-loading[role="status"]').text()).toContain('Loading schedule');
    wrapper.unmount();
  });

  it('does not overwrite a dirty Schedule form after CONFIG_CHANGED', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/schedule`);
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Edit schedule')!
      .trigger('click');
    const form = wrapper.getComponent(ScheduleForm);
    await form.get('input[name="timezone"]').setValue('Asia/Tokyo');

    vi.useFakeTimers();
    FakeEventSource.instances[0]!.emit(
      'config-changed',
      configEvent('SCHEDULE', scheduleFixture.id, ACCOUNT_ID),
    );
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();

    expect(form.get('input[name="timezone"]').element).toHaveProperty('value', 'Asia/Tokyo');
    expect(document.body.textContent).toContain('Schedule settings changed on the server.');
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(`/api/accounts/${ACCOUNT_ID}/schedules`),
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });
});
