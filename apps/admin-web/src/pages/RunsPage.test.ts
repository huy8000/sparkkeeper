import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { ACCOUNT_ID, RUN_ID, runFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, installEventSource, readyEvent, runtimeEvent } from '../test/realtime';

const UNKNOWN_ACCOUNT_ID = '00000000-0000-4000-8000-000000000099';

describe('Runs list', () => {
  it('renders business date, account name, human status, duration, and a View link', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/runs');

    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.text()).toContain('Success');
    expect(wrapper.text()).toContain('1m');
    expect(wrapper.find(`a[href="/runs/${RUN_ID}"]`).exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders human status labels for every supported run status', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs'
        ? success([
            runFixture,
            { ...runFixture, id: `${RUN_ID}1`, status: 'RUNNING', finishedAt: null },
            { ...runFixture, id: `${RUN_ID}2`, status: 'FAILED' },
            { ...runFixture, id: `${RUN_ID}3`, status: 'AUTH_EXPIRED' },
            { ...runFixture, id: `${RUN_ID}4`, status: 'READY', startedAt: null, finishedAt: null },
          ])
        : undefined,
    );
    const wrapper = await mountAdmin('/runs');
    const text = wrapper.text();

    expect(text).toContain('Success');
    expect(text).toContain('Running');
    expect(text).toContain('Failed');
    expect(text).toContain('Login expired');
    expect(text).toContain('Ready');
    wrapper.unmount();
  });

  it('shows a lightweight Live indicator for RUNNING rows without progress claims', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs'
        ? success([{ ...runFixture, status: 'RUNNING', finishedAt: null }])
        : undefined,
    );
    const wrapper = await mountAdmin('/runs');
    const text = wrapper.text();

    expect(wrapper.find('.run-row--live').exists()).toBe(true);
    expect(text).toContain('Live');
    expect(text).toContain('In progress');
    expect(text).not.toContain('%');
    wrapper.unmount();
  });

  it('initializes filters from URL query and submits only supported filters', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(
      `/runs?accountId=${ACCOUNT_ID}&businessDate=2026-01-02&status=FAILED&limit=100`,
    );
    await flushPromises();

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes(
          `/api/runs?accountId=${ACCOUNT_ID}&businessDate=2026-01-02&status=FAILED&limit=100`,
        ),
      ),
    ).toBe(true);

    const selects = wrapper.findAll('.filter-bar select');
    await selects[0]!.setValue('');
    await wrapper.find('input[type="date"]').setValue('');
    await selects[1]!.setValue('SUCCESS');
    await selects[2]!.setValue('25');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/api/runs?status=SUCCESS&limit=25'),
      ),
    ).toBe(true);
    wrapper.unmount();
  });

  it('reset clears filters and the URL query', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(`/runs?status=FAILED&limit=100`);
    await flushPromises();

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Reset')!
      .trigger('click');
    await flushPromises();

    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith('/api/runs?limit=50')),
    ).toBe(true);
    const selects = wrapper.findAll('.filter-bar select');
    expect((selects[1]!.element as HTMLSelectElement).value).toBe('');
    wrapper.unmount();
  });

  it('exposes only the supported filter controls', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/runs');
    const form = wrapper.find('form');

    expect(form.findAll('input[type="date"]').length).toBe(1);
    expect(form.findAll('select').length).toBe(3);
    expect(form.findAll('input[type="text"]').length).toBe(0);
    expect(form.findAll('input[type="search"]').length).toBe(0);
    expect(form.text()).not.toContain('Failure code');
    expect(form.text()).not.toContain('Keyword');
    wrapper.unmount();
  });

  it('resolves account names from a single bounded accounts list (no N+1)', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/runs'
        ? success([runFixture, { ...runFixture, id: `${RUN_ID}2`, accountId: UNKNOWN_ACCOUNT_ID }])
        : undefined,
    );
    const wrapper = await mountAdmin('/runs');
    const text = wrapper.text();

    expect(text).toContain('Demo Account');
    expect(text).toContain('Unknown account');
    const accountDetailCalls = fetchMock.mock.calls.filter(([input]) =>
      /\/api\/accounts\/[^/]+$/.test(new URL(String(input), 'http://127.0.0.1').pathname),
    );
    expect(accountDetailCalls.length).toBe(0);
    wrapper.unmount();
  });

  it('keeps the run list alive when the accounts lookup fails', async () => {
    installApiFetch((url) => {
      if (url.pathname === '/api/accounts')
        return failure('ACCOUNTS_UNAVAILABLE', 'Accounts unavailable.', 500);
      return undefined;
    });
    const wrapper = await mountAdmin('/runs');

    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.text()).toContain('Unknown account');
    expect(wrapper.find('.page-error').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders skeletons instead of a full-screen spinner while loading', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs' ? new Promise<Response>(() => {}) : undefined,
    );
    const wrapper = await mountAdmin('/runs');

    expect(wrapper.find('.runs-skeleton').exists()).toBe(true);
    expect(wrapper.find('.runs-skeleton').attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.spinner').exists()).toBe(false);
    wrapper.unmount();
  });

  it('distinguishes filtered empty results from a brand-new installation', async () => {
    installApiFetch((url) => (url.pathname === '/api/runs' ? success([]) : undefined));

    const filtered = await mountAdmin('/runs?status=FAILED');
    expect(filtered.text()).toContain('No runs found');
    expect(filtered.text()).toContain('Adjust the filters');
    filtered.unmount();

    const unfiltered = await mountAdmin('/runs');
    expect(unfiltered.text()).toContain('No runs yet');
    unfiltered.unmount();
  });

  it('keeps the previous list and filter state when a filtered background load fails', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs' && url.search.includes('status=FAILED')
        ? failure('RUNS_UNAVAILABLE', 'Runs unavailable.', 500)
        : undefined,
    );
    const wrapper = await mountAdmin('/runs');
    const selects = wrapper.findAll('.filter-bar select');
    await selects[1]!.setValue('FAILED');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.page-error').exists()).toBe(false);
    expect(wrapper.get('.stale-data-notice').text()).toContain('Runs unavailable.');
    expect(wrapper.text()).toContain('2026-01-02');
    expect((selects[1]!.element as HTMLSelectElement).value).toBe('FAILED');
    wrapper.unmount();
  });

  it('shows a full page error when the initial Runs request fails', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/runs'
        ? failure('RUNS_UNAVAILABLE', 'Runs unavailable.', 500)
        : undefined,
    );
    const wrapper = await mountAdmin('/runs');

    expect(wrapper.get('.page-error').text()).toContain('Runs unavailable.');
    expect(wrapper.text()).toContain('Try loading again');
    expect(wrapper.find('.stale-data-notice').exists()).toBe(false);
    wrapper.unmount();
  });

  it('retains the run snapshot after a background refresh error', async () => {
    let reads = 0;
    installApiFetch((url) => {
      if (url.pathname !== '/api/runs') return undefined;
      reads += 1;
      return reads === 1
        ? success([runFixture])
        : failure('RUNS_REFRESH_FAILED', 'Latest runs could not be loaded.', 503);
    });
    const wrapper = await mountAdmin('/runs');
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Refresh')!
      .trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('2026-01-02');
    expect(wrapper.text()).toContain('Latest runs could not be loaded.');
    expect(wrapper.find('.stale-data-notice').exists()).toBe(true);
    expect(wrapper.find('.page-error').exists()).toBe(false);
    wrapper.unmount();
  });

  it('ignores a late filter response after a newer filter request wins', async () => {
    let resolveFailed!: (response: Response) => void;
    const failedPending = new Promise<Response>((resolve) => {
      resolveFailed = resolve;
    });
    installApiFetch((url) => {
      if (url.pathname !== '/api/runs') return undefined;
      if (url.searchParams.get('status') === 'FAILED') return failedPending;
      if (url.searchParams.get('status') === 'SUCCESS') return success([runWithStatus('SUCCESS')]);
      return success([runFixture]);
    });
    const wrapper = await mountAdmin('/runs');
    const status = wrapper.findAll('.filter-bar select')[1]!;
    await status.setValue('FAILED');
    await wrapper.find('form').trigger('submit');
    await status.setValue('SUCCESS');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    resolveFailed(success([runWithStatus('FAILED')]));
    await flushPromises();

    expect(wrapper.find('.status-badge').text()).toBe('Success');
    expect(wrapper.find('tbody').text()).not.toContain('Failed');
    wrapper.unmount();
  });

  it('navigates from a row to the run detail', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/runs');

    await wrapper.find(`a[href="/runs/${RUN_ID}"]`).trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Run detail');
    wrapper.unmount();
  });

  it('only issues GET requests while browsing, filtering, and refreshing', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/runs');
    const selects = wrapper.findAll('.filter-bar select');
    await selects[1]!.setValue('FAILED');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Refresh')!
      .trigger('click');
    await flushPromises();

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.method ?? 'GET').toBe('GET');
    }
    wrapper.unmount();
  });

  it('filters noisy runtime phases, debounces live refresh, and recovers the current query on reconnect', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/runs');
    const selects = wrapper.findAll('.filter-bar select');
    await selects[0]!.setValue(ACCOUNT_ID);
    await wrapper.find('input[type="date"]').setValue('2026-01-02');
    await selects[1]!.setValue('FAILED');
    await selects[2]!.setValue('100');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();
    source.emit('runtime', runtimeEvent(RUN_ID, 'FRIEND_RESOLVING'));
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    let filteredCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(
        `/api/runs?accountId=${ACCOUNT_ID}&businessDate=2026-01-02&status=FAILED&limit=100`,
      ),
    );
    expect(filteredCalls.length).toBe(1);

    source.emit('runtime', runtimeEvent(RUN_ID));
    source.emit('runtime', runtimeEvent(RUN_ID, 'RUN_FINISHED', '3'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    filteredCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(
        `/api/runs?accountId=${ACCOUNT_ID}&businessDate=2026-01-02&status=FAILED&limit=100`,
      ),
    );
    expect(filteredCalls.length).toBe(2);

    source.emit('error');
    source.emit('open');
    source.emit('ready', readyEvent('4'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();
    filteredCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(
        `/api/runs?accountId=${ACCOUNT_ID}&businessDate=2026-01-02&status=FAILED&limit=100`,
      ),
    );
    expect(filteredCalls.length).toBe(3);
    wrapper.unmount();
  });

  it('bounds the complete runtime event storm to one Runs GET', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/runs');
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();
    for (const [index, eventType] of [
      'RUN_STARTED',
      'FRIEND_RESOLVING',
      'MESSAGE_BUILDING',
      'MESSAGE_SENDING',
      'VERIFYING',
      'VERIFY_SUCCESS',
      'RUN_FINISHED',
    ].entries()) {
      source.emit('runtime', runtimeEvent(RUN_ID, eventType, `storm-${index}`));
    }
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();

    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          new URL(String(input), 'http://127.0.0.1').pathname === '/api/runs' &&
          (init?.method ?? 'GET') === 'GET',
      ),
    ).toHaveLength(2);
    wrapper.unmount();
  });
});

function runWithStatus(status: (typeof runFixture)['status']) {
  return { ...runFixture, status };
}
