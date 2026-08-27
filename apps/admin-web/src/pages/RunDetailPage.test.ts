import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  ACCOUNT_ID,
  RUN_ID,
  runFixture,
  sendRecordFixture,
  systemEventFixture,
} from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, installEventSource, readyEvent, runtimeEvent } from '../test/realtime';

const RUN_PATH = `/runs/${RUN_ID}`;
const RUN_API = `/api/runs/${RUN_ID}`;
const SECONDARY_PATHS = [
  `${RUN_API}/send-records`,
  `${RUN_API}/events`,
  `/api/accounts/${ACCOUNT_ID}`,
  `/api/accounts/${ACCOUNT_ID}/friends`,
];

const FORBIDDEN_ACTION_LABELS = ['retry', 'resend', 'send again', 'force send', 'run again'];

function pathname(input: RequestInfo | URL): string {
  return new URL(String(input), 'http://127.0.0.1').pathname;
}

function runDetailCalls(fetchMock: ReturnType<typeof installApiFetch>) {
  return fetchMock.mock.calls.filter(([input]) => pathname(input) === RUN_API);
}

function secondaryCalls(fetchMock: ReturnType<typeof installApiFetch>) {
  return fetchMock.mock.calls.filter(([input]) => SECONDARY_PATHS.includes(pathname(input)));
}

/** The read-only run detail must never expose any re-execution action. */
function assertNoExecutionActions(wrapper: VueWrapper): void {
  for (const element of [...wrapper.findAll('button'), ...wrapper.findAll('a')]) {
    const label = element.text().toLowerCase();
    for (const forbidden of FORBIDDEN_ACTION_LABELS) expect(label).not.toContain(forbidden);
  }
}

function runWith(status: (typeof runFixture)['status']): typeof runFixture {
  return {
    ...runFixture,
    status,
    ...(status === 'RUNNING' ? { finishedAt: null } : {}),
    ...(status === 'READY' ? { startedAt: null, finishedAt: null } : {}),
  };
}

describe('Run detail', () => {
  it('renders skeletons instead of a full-screen spinner while the run loads', async () => {
    installApiFetch((url) =>
      url.pathname === RUN_API ? new Promise<Response>(() => {}) : undefined,
    );
    const wrapper = await mountAdmin(RUN_PATH);

    const skeleton = wrapper.find('.run-detail-skeleton');
    expect(skeleton.exists()).toBe(true);
    expect(skeleton.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('.spinner').exists()).toBe(false);
    wrapper.unmount();
  });

  it('shows Run not found for a 404 and never requests secondary data', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === RUN_API ? failure('RUN_NOT_FOUND', 'Run not found.', 404) : undefined,
    );
    const wrapper = await mountAdmin(RUN_PATH);

    expect(wrapper.text()).toContain('Run not found');
    expect(wrapper.find('.state-panel a[href="/runs"]').text()).toContain('Back to Runs');
    expect(secondaryCalls(fetchMock).length).toBe(0);
    assertNoExecutionActions(wrapper);
    wrapper.unmount();
  });

  it('shows a retryable page error when the run request fails, without secondary calls', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === RUN_API ? failure('RUN_UNAVAILABLE', 'Run unavailable.', 500) : undefined,
    );
    const wrapper = await mountAdmin(RUN_PATH);

    const error = wrapper.find('.page-error');
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain('Try loading again');
    expect(secondaryCalls(fetchMock).length).toBe(0);
    wrapper.unmount();
  });

  it('presents SUCCESS as a verified outcome with the verification chain', async () => {
    installApiFetch((url) =>
      url.pathname === `${RUN_API}/send-records`
        ? success([
            { ...sendRecordFixture, status: 'SUCCESS', sentAt: '2026-01-02T03:04:30.000Z' },
            {
              ...sendRecordFixture,
              id: `${RUN_ID}99`,
              status: 'SUCCESS',
              sentAt: '2026-01-02T03:04:40.000Z',
            },
          ])
        : undefined,
    );
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(wrapper.find('.run-hero--success').exists()).toBe(true);
    expect(text).toContain('Verified Success');
    expect(text).toContain('This run has completed.');
    expect(text).toContain('Delivery results were verified by new outgoing message bubbles.');
    expect(text).toContain('2 successful deliveries');
    expect(text).not.toContain('deliveryies');
    expect(text).toContain('Resolve contact');
    expect(text).toContain('Observe new outgoing bubble');
    expect(text).toContain('Persist SUCCESS');
    assertNoExecutionActions(wrapper);
    wrapper.unmount();
  });

  it('shows a live running state without progress claims', async () => {
    installApiFetch((url) => (url.pathname === RUN_API ? success(runWith('RUNNING')) : undefined));
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(text).toContain('Running · Live');
    expect(wrapper.find('.run-live-chip').exists()).toBe(true);
    expect(text).toContain('In progress');
    expect(text).not.toContain('%');
    wrapper.unmount();
  });

  it('explains FAILED runs with persisted failure codes and summary', async () => {
    installApiFetch((url) => (url.pathname === RUN_API ? success(runWith('FAILED')) : undefined));
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(wrapper.find('.run-hero--danger').exists()).toBe(true);
    expect(text).toContain('Run failed');
    expect(text).toContain('TEST_FAILURE');
    expect(text).toContain('A safe test event summary.');
    wrapper.unmount();
  });

  it('presents AUTH_EXPIRED as an expired login with the account link and no actions', async () => {
    installApiFetch((url) => {
      if (url.pathname === RUN_API) return success(runWith('AUTH_EXPIRED'));
      if (url.pathname === `${RUN_API}/send-records`) return success([]);
      return undefined;
    });
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(text).toContain('Login expired');
    expect(text).toContain('Authentication verification stopped the run.');
    const accountLink = wrapper.find(`a[href="/accounts/${ACCOUNT_ID}/overview"]`);
    expect(accountLink.exists()).toBe(true);
    expect(accountLink.text()).toContain('View account');
    expect(text).not.toContain('Mark Ready');
    expect(text).not.toContain('Auto Login');
    expect(text).not.toContain('noVNC');
    assertNoExecutionActions(wrapper);
    wrapper.unmount();
  });

  it('makes an uncertain delivery the primary state and proves no retry action exists', async () => {
    installApiFetch((url) => {
      if (url.pathname === RUN_API) return success(runWith('FAILED'));
      if (url.pathname === `${RUN_API}/send-records`)
        return success([{ ...sendRecordFixture, status: 'DELIVERY_UNKNOWN', failureCode: null }]);
      return undefined;
    });
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    const hero = wrapper.find('.run-hero--uncertain');
    expect(hero.exists()).toBe(true);
    expect(hero.attributes('role')).toBe('alert');
    expect(text).toContain('Delivery uncertain');
    expect(text).toContain(
      'A send action occurred, but SparkKeeper could not verify a new outgoing message.',
    );
    expect(text).toContain('The message may already have been delivered.');
    expect(text).toContain('Do not retry automatically.');
    expect(wrapper.find('.delivery-row--uncertain').exists()).toBe(true);
    // Diagnostic raw statuses stay visible in the collapsed technical section only.
    expect(text).toContain('Send status: DELIVERY_UNKNOWN');
    expect(text).toContain('FAILED');
    // Hard safety acceptance: no retry/resend execution surface anywhere on the page.
    assertNoExecutionActions(wrapper);
    wrapper.unmount();
  });

  it('shows READY runs as not started yet', async () => {
    installApiFetch((url) => {
      if (url.pathname === RUN_API) return success(runWith('READY'));
      if (url.pathname === `${RUN_API}/send-records`) return success([]);
      if (url.pathname === `${RUN_API}/events`) return success([]);
      return undefined;
    });
    const wrapper = await mountAdmin(RUN_PATH);

    expect(wrapper.text()).toContain('The run is ready and has not started yet.');
    wrapper.unmount();
  });

  it('explains RETRY_WAIT with the attempt count instead of a fabricated countdown', async () => {
    installApiFetch((url) => {
      if (url.pathname === RUN_API) return success(runWith('RUNNING'));
      if (url.pathname === `${RUN_API}/send-records`)
        return success([{ ...sendRecordFixture, status: 'RETRY_WAIT', attempts: 2 }]);
      return undefined;
    });
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(text).toContain('Waiting to retry after 2 attempts.');
    expect(text).not.toContain('next retry');
    expect(text).not.toMatch(/\bin \d+s\b/);
    wrapper.unmount();
  });

  it('orders the timeline chronologically and renders human labels and levels', async () => {
    const runStarted = {
      ...systemEventFixture,
      eventType: 'RUN_STARTED',
      level: 'INFO',
      friendId: null,
      attempt: null,
      errorCode: null,
      screenshotEvidenceAvailable: false,
      traceEvidenceAvailable: false,
      createdAt: '2026-01-02T03:04:00.000Z',
      message: 'First fixture event.',
    };
    const authUnknown = {
      ...systemEventFixture,
      eventType: 'AUTH_UNKNOWN',
      level: 'WARN',
      friendId: null,
      attempt: null,
      errorCode: null,
      screenshotEvidenceAvailable: false,
      traceEvidenceAvailable: false,
      createdAt: '2026-01-02T03:04:10.000Z',
      message: 'Second fixture event.',
    };
    installApiFetch((url) =>
      // The API deliberately returns events out of order; the page must sort them.
      url.pathname === `${RUN_API}/events`
        ? success([authUnknown, systemEventFixture, runStarted])
        : undefined,
    );
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    const startedIndex = text.indexOf('Run started');
    const failedIndex = text.indexOf('Delivery attempt failed');
    const uncertainIndex = text.indexOf('Login status uncertain');
    expect(startedIndex).toBeGreaterThan(-1);
    expect(startedIndex).toBeLessThan(failedIndex);
    expect(failedIndex).toBeLessThan(uncertainIndex);
    expect(text).toContain('Info');
    expect(text).toContain('Warning');
    expect(text).toContain('Error');
    expect(text).toContain('Demo Contact Alpha');
    wrapper.unmount();
  });

  it('shows evidence availability only and never exposes View/Open/Download links', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(text).toContain('Screenshot captured');
    expect(text).toContain('Trace captured');
    const timeline = wrapper.find('.timeline');
    expect(timeline.findAll('a').length).toBe(0);
    expect(timeline.findAll('button').length).toBe(0);
    expect(text).not.toContain('Download');
    wrapper.unmount();
  });

  it('keeps the page alive when individual secondary requests fail', async () => {
    installApiFetch((url) =>
      url.pathname === `${RUN_API}/send-records`
        ? failure('RECORDS_UNAVAILABLE', 'Delivery records unavailable.', 500)
        : undefined,
    );
    const withRecordsError = await mountAdmin(RUN_PATH);
    expect(withRecordsError.text()).toContain('Verified Success');
    expect(withRecordsError.text()).toContain('Delivery records unavailable.');
    expect(withRecordsError.find('.page-error').exists()).toBe(false);
    withRecordsError.unmount();

    installApiFetch((url) =>
      url.pathname === `${RUN_API}/events`
        ? failure('EVENTS_UNAVAILABLE', 'System events unavailable.', 500)
        : undefined,
    );
    const withEventsError = await mountAdmin(RUN_PATH);
    expect(withEventsError.text()).toContain('Demo Contact Alpha');
    expect(withEventsError.text()).toContain('System events unavailable.');
    expect(withEventsError.find('.page-error').exists()).toBe(false);
    withEventsError.unmount();

    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}`
        ? failure('ACCOUNT_UNAVAILABLE', 'Account unavailable.', 500)
        : undefined,
    );
    const withAccountError = await mountAdmin(RUN_PATH);
    expect(withAccountError.text()).toContain('Unknown account');
    expect(withAccountError.text()).toContain('Verified Success');
    expect(withAccountError.find('.page-error').exists()).toBe(false);
    withAccountError.unmount();

    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/friends`
        ? failure('FRIENDS_UNAVAILABLE', 'Friends unavailable.', 500)
        : undefined,
    );
    const withFriendsError = await mountAdmin(RUN_PATH);
    expect(withFriendsError.text()).toContain('Unknown friend');
    expect(withFriendsError.find('.page-error').exists()).toBe(false);
    withFriendsError.unmount();
  });

  it('survives every secondary failing at once without a blank page', async () => {
    installApiFetch((url) =>
      SECONDARY_PATHS.includes(url.pathname)
        ? failure('SECTION_UNAVAILABLE', 'Section unavailable.', 500)
        : undefined,
    );
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(text).toContain('Verified Success');
    expect(text).toContain('Unknown account');
    expect(wrapper.find('.page-error').exists()).toBe(false);
    wrapper.unmount();
  });

  it('resolves friend names through one account-scoped friends list (no N+1)', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === `${RUN_API}/send-records`
        ? success([sendRecordFixture, { ...sendRecordFixture, id: `${RUN_ID}99` }])
        : undefined,
    );
    const wrapper = await mountAdmin(RUN_PATH);

    expect(wrapper.text()).toContain('Demo Contact Alpha');
    const friendsCalls = fetchMock.mock.calls.filter(
      ([input]) => pathname(input) === `/api/accounts/${ACCOUNT_ID}/friends`,
    );
    expect(friendsCalls.length).toBe(1);
    const friendDetailCalls = fetchMock.mock.calls.filter(([input]) =>
      /\/api\/friends\//.test(pathname(input)),
    );
    expect(friendDetailCalls.length).toBe(0);
    wrapper.unmount();
  });

  it('only issues GET requests while viewing and refreshing', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin(RUN_PATH);
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

  it('refreshes once for matching run events and ignores other runs and noisy phases', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin(RUN_PATH);
    const source = FakeEventSource.instances[0]!;
    const initialCount = runDetailCalls(fetchMock).length;

    vi.useFakeTimers();
    source.emit('runtime', runtimeEvent(`${RUN_ID}9`, 'RUN_FINISHED'));
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    expect(runDetailCalls(fetchMock).length).toBe(initialCount);

    source.emit('runtime', runtimeEvent(RUN_ID, 'FRIEND_RESOLVING', '3'));
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    expect(runDetailCalls(fetchMock).length).toBe(initialCount);

    source.emit('runtime', runtimeEvent(RUN_ID, 'RUN_FINISHED', '4'));
    source.emit('runtime', runtimeEvent(RUN_ID, 'TASK_FAILED', '5'));
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    vi.useRealTimers();
    expect(runDetailCalls(fetchMock).length).toBe(initialCount + 1);
    wrapper.unmount();
  });

  it('reflects a RUNNING → SUCCESS transition after a live event refresh', async () => {
    let currentRun = runWith('RUNNING');
    installApiFetch((url) => (url.pathname === RUN_API ? success(currentRun) : undefined));
    installEventSource();
    const wrapper = await mountAdmin(RUN_PATH);
    expect(wrapper.text()).toContain('Running · Live');

    currentRun = runWith('SUCCESS');
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();
    source.emit('runtime', runtimeEvent(RUN_ID, 'RUN_FINISHED'));
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    vi.useRealTimers();

    expect(wrapper.text()).toContain('Verified Success');
    expect(wrapper.text()).not.toContain('Running · Live');
    wrapper.unmount();
  });

  it('warns about unavailable live updates while reconnecting and refreshes once after recovery', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === RUN_API ? success(runWith('RUNNING')) : undefined,
    );
    installEventSource();
    const wrapper = await mountAdmin(RUN_PATH);
    const source = FakeEventSource.instances[0]!;
    const initialCount = runDetailCalls(fetchMock).length;

    source.emit('error');
    await flushPromises();
    expect(wrapper.text()).toContain('Live updates temporarily unavailable.');
    // The last known snapshot stays visible; the run is never marked failed.
    expect(wrapper.text()).toContain('Running · Live');
    expect(wrapper.text()).not.toContain('Run failed');

    vi.useFakeTimers();
    source.emit('open');
    source.emit('ready', readyEvent());
    await vi.advanceTimersByTimeAsync(600);
    await flushPromises();
    vi.useRealTimers();

    expect(runDetailCalls(fetchMock).length).toBe(initialCount + 1);
    expect(wrapper.text()).not.toContain('Live updates temporarily unavailable.');
    wrapper.unmount();
  });

  it('confirms an accepted manual run without exposing the request payload', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`${RUN_PATH}?accepted=manual-run`);
    const text = wrapper.text();

    expect(text).toContain('Manual Run request accepted.');
    expect(text).not.toContain('manual-run');
    wrapper.unmount();
  });

  it('renders calm empty states for runs without records or events', async () => {
    installApiFetch((url) => {
      if (url.pathname === `${RUN_API}/send-records`) return success([]);
      if (url.pathname === `${RUN_API}/events`) return success([]);
      return undefined;
    });
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(text).toContain('No delivery records were created.');
    expect(text).toContain('No persisted events for this run.');
    wrapper.unmount();
  });

  it('never leaks unknown response fields into the page', async () => {
    installApiFetch((url) =>
      url.pathname === RUN_API
        ? success({ ...runFixture, password: 'secret-fixture-token', leakedNote: 'hidden-leak' })
        : undefined,
    );
    const wrapper = await mountAdmin(RUN_PATH);
    const text = wrapper.text();

    expect(text).toContain('Verified Success');
    expect(text).not.toContain('secret-fixture-token');
    expect(text).not.toContain('hidden-leak');
    wrapper.unmount();
  });
});
