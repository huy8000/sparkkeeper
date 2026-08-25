import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID, RUN_ID, sendRecordFixture, systemEventFixture } from '../test/fixtures';
import { installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Runs', () => {
  it('renders run status, account name, business date, and detail link', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/runs');

    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.text()).toContain('SUCCESS');
    expect(wrapper.find(`a[href="/runs/${RUN_ID}"]`).exists()).toBe(true);
    wrapper.unmount();
  });

  it('submits only supported filters with a bounded limit', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/runs');
    const selects = wrapper.findAll('select');
    await selects[0]!.setValue(ACCOUNT_ID);
    await wrapper.find('input[type="date"]').setValue('2026-01-02');
    await selects[1]!.setValue('FAILED');
    await selects[2]!.setValue('100');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(
          `/api/runs?accountId=${ACCOUNT_ID}&businessDate=2026-01-02&status=FAILED&limit=100`,
        ),
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it('renders an empty filtered result', async () => {
    installApiFetch((url) => (url.pathname === '/api/runs' ? success([]) : undefined));
    const wrapper = await mountAdmin('/runs');

    expect(wrapper.text()).toContain('No runs');
    wrapper.unmount();
  });

  it('renders run summary, send records, system events, and evidence availability only', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/runs/${RUN_ID}`);

    expect(wrapper.text()).toContain('Run summary');
    expect(wrapper.text()).toContain(sendRecordFixture.failureCode);
    expect(wrapper.text()).toContain(systemEventFixture.message);
    expect(wrapper.text()).toContain('Screenshot available');
    expect(wrapper.text()).toContain('Trace available');
    expect(wrapper.findAll('a').some((link) => /screenshot|trace/i.test(link.text()))).toBe(false);
    wrapper.unmount();
  });

  it('does not render private response extras, paths, tokens, cookies, or stack traces', async () => {
    installApiFetch((url) => {
      if (url.pathname === `/api/runs/${RUN_ID}/send-records`) {
        return success([
          {
            ...sendRecordFixture,
            token: 'PRIVATE_TOKEN_SENTINEL',
          },
        ]);
      }
      if (url.pathname === `/api/runs/${RUN_ID}/events`) {
        return success([
          {
            ...systemEventFixture,
            evidencePath: '/private/runtime/evidence',
            stack: 'PRIVATE_STACK_SENTINEL',
            cookie: 'PRIVATE_COOKIE_SENTINEL',
          },
        ]);
      }
      return undefined;
    });
    const wrapper = await mountAdmin(`/runs/${RUN_ID}`);
    const dom = wrapper.text();

    expect(dom).not.toContain('PRIVATE_TOKEN_SENTINEL');
    expect(dom).not.toContain('/private/runtime/evidence');
    expect(dom).not.toContain('PRIVATE_STACK_SENTINEL');
    expect(dom).not.toContain('PRIVATE_COOKIE_SENTINEL');
    wrapper.unmount();
  });

  it('renders run not found without leaking the API detail', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/runs/${RUN_ID}`
        ? new Response(
            JSON.stringify({
              success: false,
              error: { code: 'RUN_NOT_FOUND', message: 'Internal lookup detail.' },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          )
        : undefined,
    );
    const wrapper = await mountAdmin(`/runs/${RUN_ID}`);

    expect(wrapper.text()).toContain('Run not found');
    expect(wrapper.text()).not.toContain('Internal lookup detail.');
    wrapper.unmount();
  });
});
