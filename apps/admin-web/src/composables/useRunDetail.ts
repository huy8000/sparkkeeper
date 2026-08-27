import {
  computed,
  onBeforeUnmount,
  readonly,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type ShallowRef,
} from 'vue';

import { ApiError } from '../api/client';
import { invalidatesRunDetail } from '../api/realtimeInvalidation';
import { useAdminApp } from '../appContext';
import { deriveRunDetailState, type RunDetailState } from '../runs/deriveRunDetailState';
import type { Account, DailyRun, SendRecord, SystemEvent } from '../types/api';
import { useRealtimeRefresh } from './useRealtimeRefresh';
import { useRequest, type RequestState } from './useRequest';

export interface RunDetailSection<T> {
  readonly data: ShallowRef<T | null>;
  readonly error: Ref<ApiError | null>;
  readonly loading: Ref<boolean>;
}

export interface RunDetailModel {
  readonly run: RequestState<DailyRun>;
  readonly account: RunDetailSection<Account>;
  readonly sendRecords: RunDetailSection<readonly SendRecord[]>;
  readonly events: RunDetailSection<readonly SystemEvent[]>;
  readonly orderedEvents: ComputedRef<readonly SystemEvent[]>;
  readonly detailState: ComputedRef<RunDetailState | null>;
  readonly accountName: ComputedRef<string>;
  readonly friendName: (friendId: string) => string;
  readonly connectionState: Readonly<Ref<string>>;
  readonly liveUpdatesUnavailable: ComputedRef<boolean>;
  readonly refresh: () => void;
}

function safeError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError('UNEXPECTED_ERROR', 'Something went wrong. Please try again.', 0, 'MALFORMED');
}

/**
 * Run Detail orchestration. The primary Run GET gates every secondary request:
 * account, send records and system events load in parallel after it succeeds,
 * each with independent failure state so one secondary error never blanks the
 * whole page. Friend display names resolve through ONE account-scoped friends
 * list (cached per account) instead of N per-friend detail requests.
 *
 * SSE reuses the shared realtime client; the existing invalidation set ignores
 * high-frequency phases (FRIEND_RESOLVING, MESSAGE_BUILDING, MESSAGE_SENDING,
 * VERIFYING) and useRealtimeRefresh coalesces bursts at 500ms.
 */
export function useRunDetail(runId: string): RunDetailModel {
  const app = useAdminApp();
  const run = useRequest((signal) => app.api.getRun(runId, signal));

  const accountData = shallowRef<Account | null>(null);
  const accountError = ref<ApiError | null>(null);
  const accountLoading = ref(false);
  const sendRecordsData = shallowRef<readonly SendRecord[] | null>(null);
  const sendRecordsError = ref<ApiError | null>(null);
  const sendRecordsLoading = ref(false);
  const eventsData = shallowRef<readonly SystemEvent[] | null>(null);
  const eventsError = ref<ApiError | null>(null);
  const eventsLoading = ref(false);
  const friendNames = ref<ReadonlyMap<string, string>>(new Map());

  let secondaryController: AbortController | undefined;
  let secondaryRequest = 0;
  let resolvedAccountId: string | null = null;
  let friendsLoadedFor: string | null = null;

  function cancelSecondaries(): void {
    secondaryController?.abort();
    secondaryController = undefined;
  }

  async function loadAccount(accountId: string, signal: AbortSignal): Promise<void> {
    if (resolvedAccountId === accountId && accountData.value !== null) return;
    accountLoading.value = true;
    accountError.value = null;
    try {
      const account = await app.api.getAccount(accountId, signal);
      if (!signal.aborted) {
        accountData.value = account;
        resolvedAccountId = accountId;
      }
    } catch (cause) {
      const requestError = safeError(cause);
      if (!signal.aborted && requestError.kind !== 'ABORT') {
        accountError.value = requestError;
        resolvedAccountId = accountId;
      }
    } finally {
      if (!signal.aborted) accountLoading.value = false;
    }
  }

  async function loadFriends(accountId: string, signal: AbortSignal): Promise<void> {
    if (friendsLoadedFor === accountId) return;
    try {
      const friends = await app.api.listFriends(accountId, signal);
      if (signal.aborted) return;
      friendNames.value = new Map(friends.map((friend) => [friend.id, friend.displayName]));
      friendsLoadedFor = accountId;
    } catch {
      // Friend lookup failure is non-fatal: records fall back to "Unknown friend".
      friendsLoadedFor = accountId;
    }
  }

  async function loadSecondaries(currentRun: DailyRun): Promise<void> {
    cancelSecondaries();
    const requestNumber = ++secondaryRequest;
    const controller = new AbortController();
    secondaryController = controller;
    const signal = controller.signal;

    sendRecordsLoading.value = true;
    sendRecordsError.value = null;
    eventsLoading.value = true;
    eventsError.value = null;

    const accountTask = loadAccount(currentRun.accountId, signal);
    const recordsTask = app.api
      .listSendRecords(runId, signal)
      .then(async (records) => {
        if (signal.aborted) return;
        sendRecordsData.value = records;
        await loadFriends(currentRun.accountId, signal);
      })
      .catch((cause) => {
        const requestError = safeError(cause);
        if (!signal.aborted && requestError.kind !== 'ABORT') sendRecordsError.value = requestError;
      })
      .finally(() => {
        if (!signal.aborted) sendRecordsLoading.value = false;
      });
    const eventsTask = app.api
      .listSystemEvents(runId, signal)
      .then((events) => {
        if (!signal.aborted) eventsData.value = events;
      })
      .catch((cause) => {
        const requestError = safeError(cause);
        if (!signal.aborted && requestError.kind !== 'ABORT') eventsError.value = requestError;
      })
      .finally(() => {
        if (!signal.aborted) eventsLoading.value = false;
      });

    await Promise.allSettled([accountTask, recordsTask, eventsTask]);
    if (requestNumber !== secondaryRequest) return;
  }

  watch(run.data, (currentRun) => {
    if (currentRun === null) return;
    void loadSecondaries(currentRun);
  });
  watch(app.refreshVersion, () => void run.load());
  useRealtimeRefresh(
    app.realtime,
    (event) => invalidatesRunDetail(event, runId),
    () => void run.load(),
  );
  onBeforeUnmount(cancelSecondaries);

  const orderedEvents = computed(() =>
    [...(eventsData.value ?? [])].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    ),
  );
  const detailState = computed(() =>
    run.data.value === null
      ? null
      : deriveRunDetailState(run.data.value, sendRecordsData.value ?? []),
  );
  const accountName = computed(() => accountData.value?.name ?? 'Unknown account');

  return {
    run,
    account: { data: accountData, error: accountError, loading: accountLoading },
    sendRecords: {
      data: sendRecordsData,
      error: sendRecordsError,
      loading: sendRecordsLoading,
    },
    events: { data: eventsData, error: eventsError, loading: eventsLoading },
    orderedEvents,
    detailState,
    accountName,
    friendName: (friendId) => friendNames.value.get(friendId) ?? 'Unknown friend',
    connectionState: readonly(app.realtime.connectionState) as Readonly<Ref<string>>,
    liveUpdatesUnavailable: computed(
      () =>
        run.data.value?.status === 'RUNNING' &&
        app.realtime.connectionState.value === 'RECONNECTING',
    ),
    refresh: () => void run.load(),
  };
}
