import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ManualRunPreflight from '../components/account/ManualRunPreflight.vue';
import { setLocale } from '../i18n';
import {
  ACCOUNT_ID,
  TEMPLATE_ID,
  manualRunAcceptedFixture,
  manualRunPreflightFixture,
  templateSummaryFixture,
} from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import type { ManualRunBlockedReason } from '../types/api';

async function selectTemplate(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('select[name="manualRunTemplate"]').setValue(TEMPLATE_ID);
  await flushPromises();
}

async function acknowledgeAndReview(wrapper: VueWrapper): Promise<void> {
  const preflight = wrapper.getComponent(ManualRunPreflight);
  await preflight.get('input[type="checkbox"]').setValue(true);
  await preflight.get('button').trigger('click');
  await flushPromises();
}

function confirmationButton(): HTMLButtonElement {
  const button = [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Start Manual Run',
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('Confirmation button not found.');
  return button;
}

describe('Account Manual Run', () => {
  it('loads all templates, including disabled templates, and preflights after selection', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/templates'
        ? success([
            templateSummaryFixture,
            {
              ...templateSummaryFixture,
              id: '00000000-0000-4000-8000-000000000099',
              name: 'Disabled Template',
              enabled: false,
            },
          ])
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    expect(wrapper.text()).toContain('Disabled Template — Disabled');
    expect(wrapper.findComponent(ManualRunPreflight).exists()).toBe(false);
    await selectTemplate(wrapper);
    expect(wrapper.text()).toContain('Ready to run');
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(
          `/api/accounts/${ACCOUNT_ID}/manual-run/preflight?templateId=${TEMPLATE_ID}`,
        ),
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it.each<[ManualRunBlockedReason, string]>([
    ['MANUAL_RUN_DISABLED', 'Manual Run is disabled by the server operator.'],
    ['REAL_SEND_NOT_AUTHORIZED', 'Real sending is not authorized.'],
    ['NO_ENABLED_FRIENDS', 'There are no enabled friends.'],
    ['RUN_ALREADY_COMPLETE', "Today's run is already complete."],
    ['RUN_IN_PROGRESS', 'A run is already in progress.'],
  ])('renders blocker %s and exposes no Start action', async (reason, copy) => {
    const fetchMock = installApiFetch((url) =>
      url.pathname.endsWith('/manual-run/preflight')
        ? success({
            ...manualRunPreflightFixture,
            canRun: false,
            currentDailyRunStatus: reason === 'RUN_ALREADY_COMPLETE' ? 'SUCCESS' : null,
            blockedReasons: [reason],
          })
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    await selectTemplate(wrapper);
    expect(wrapper.text()).toContain(copy);
    expect(wrapper.text()).toContain(reason);
    expect(wrapper.findAll('button').some((button) => /Review and start/.test(button.text()))).toBe(
      false,
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/manual-runs'))).toBe(false);
    wrapper.unmount();
  });

  it('requires acknowledgement before opening DangerConfirmation', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    await selectTemplate(wrapper);
    const button = wrapper.getComponent(ManualRunPreflight).get('button');
    expect(button.attributes('disabled')).toBeDefined();
    await button.trigger('click');
    expect(document.body.querySelector('.danger-confirmation')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/manual-runs'))).toBe(false);
    wrapper.unmount();
  });

  it('shows reviewed account/template/friend count in the danger confirmation', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    await selectTemplate(wrapper);
    await acknowledgeAndReview(wrapper);
    const modal = document.body.querySelector('.danger-confirmation');
    expect(modal?.textContent).toContain('This action may send real messages.');
    expect(modal?.textContent).toContain('Demo Account');
    expect(modal?.textContent).toContain('Demo Template');
    expect(modal?.textContent).toContain('2');
    wrapper.unmount();
  });

  it('submits exactly once under a double click and sends the required acknowledgement', async () => {
    let resolvePost!: (response: Response) => void;
    const pendingPost = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchMock = installApiFetch((url, init) =>
      url.pathname.endsWith('/manual-runs') && init?.method === 'POST' ? pendingPost : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    await selectTemplate(wrapper);
    await acknowledgeAndReview(wrapper);
    const button = confirmationButton();
    button.click();
    button.click();
    await Promise.resolve();
    const calls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/manual-runs') && init?.method === 'POST',
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({
      templateId: TEMPLATE_ID,
      acknowledgeRealSend: true,
    });
    expect(document.body.textContent).toContain('Starting…');
    resolvePost(success(manualRunAcceptedFixture, 202));
    await flushPromises();
    expect(wrapper.text()).toContain('Run accepted');
    wrapper.unmount();
  });

  it('shows Accepted without waiting for completion or auto-navigating', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    await selectTemplate(wrapper);
    await acknowledgeAndReview(wrapper);
    confirmationButton().click();
    await flushPromises();
    expect(wrapper.text()).toContain('Run accepted');
    expect(wrapper.text()).toContain('background task is now managed by the server');
    expect(wrapper.get(`a[href="/runs/${manualRunAcceptedFixture.runId}"]`).text()).toContain(
      'View live run',
    );
    expect(window.location.pathname).toBe(`/accounts/${ACCOUNT_ID}/manual-run`);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/manual-runs') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it('treats an uncertain network result as non-retryable and never POSTs again', async () => {
    const fetchMock = installApiFetch((url, init) =>
      url.pathname.endsWith('/manual-runs') && init?.method === 'POST'
        ? Promise.reject(new TypeError('Synthetic network disconnect'))
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    await selectTemplate(wrapper);
    await acknowledgeAndReview(wrapper);
    confirmationButton().click();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Request result is uncertain.');
    expect(wrapper.text()).toContain('Do not retry automatically.');
    expect(wrapper.text()).toContain('Check Runs to confirm whether a run was accepted.');
    expect(wrapper.get('.manual-result a[href="/runs"]').text()).toBe('View Runs');
    expect(wrapper.text()).not.toContain('Synthetic network disconnect');
    expect(wrapper.findComponent(ManualRunPreflight).exists()).toBe(false);
    await flushPromises();
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/manual-runs') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it('shows an authoritative POST rejection without automatic retry', async () => {
    const fetchMock = installApiFetch((url, init) =>
      url.pathname.endsWith('/manual-runs') && init?.method === 'POST'
        ? failure('RUN_ALREADY_IN_PROGRESS', 'A run is already in progress.', 409)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    await selectTemplate(wrapper);
    await acknowledgeAndReview(wrapper);
    confirmationButton().click();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('A run is already in progress today.');
    expect(wrapper.findComponent(ManualRunPreflight).exists()).toBe(false);
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/manual-runs') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it('localizes authoritative POST rejections in zh-CN without leaking raw copy', async () => {
    const fetchMock = installApiFetch((url, init) =>
      url.pathname.endsWith('/manual-runs') && init?.method === 'POST'
        ? failure('RUN_ALREADY_COMPLETE', 'The daily run already finished.', 409)
        : undefined,
    );
    setLocale('zh-CN');
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    await selectTemplate(wrapper);
    await acknowledgeAndReview(wrapper);
    const button = [...document.body.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === '启动手动执行',
    );
    expect(button).toBeDefined();
    (button as HTMLButtonElement).click();
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('今天的执行已经完成。');
    expect(wrapper.text()).not.toContain('The daily run already finished.');
    // Security rejections stay authoritative: exactly one POST, no retry.
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/manual-runs') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it('distinguishes template loading/error without any mutation', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/templates'
        ? failure('TEMPLATES_UNAVAILABLE', 'Templates could not be loaded.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/manual-run`);
    expect(wrapper.get('[role="alert"]').text()).toContain('Templates could not be loaded.');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/manual-runs'))).toBe(false);
    wrapper.unmount();
  });
});
