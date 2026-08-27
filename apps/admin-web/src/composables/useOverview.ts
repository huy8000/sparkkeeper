import { resolveBusinessDate } from '@sparkkeeper/shared';
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
import { invalidatesOverviewAccounts, invalidatesOverviewRuns } from '../api/overviewInvalidation';
import { useAdminApp } from '../appContext';
import {
  classifyOverviewState,
  type OverviewClassification,
} from '../overview/classifyOverviewState';
import type { Account, DailyRun } from '../types/api';
import { useRealtimeRefresh } from './useRealtimeRefresh';
import { useRequest, type RequestState } from './useRequest';

export interface OverviewStateModel {
  readonly accounts: RequestState<Account[]>;
  readonly runs: {
    readonly data: ShallowRef<readonly DailyRun[] | null>;
    readonly error: Ref<ApiError | null>;
    readonly loading: Ref<boolean>;
    readonly load: () => Promise<void>;
  };
  readonly businessDate: Readonly<Ref<string | null>>;
  readonly classification: ComputedRef<OverviewClassification | null>;
  readonly classificationWarning: ComputedRef<string | null>;
  readonly refresh: () => void;
}

export interface OverviewOptions {
  readonly now?: () => Date;
}

function safeError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError('UNEXPECTED_ERROR', 'Something went wrong. Please try again.', 0, 'MALFORMED');
}

export function useOverview(options: OverviewOptions = {}): OverviewStateModel {
  const app = useAdminApp();
  const now = options.now ?? (() => new Date());
  const accounts = useRequest((signal) => app.api.listAccounts(signal));
  const runsData = shallowRef<readonly DailyRun[] | null>(null);
  const runsError = ref<ApiError | null>(null);
  const runsLoading = ref(true);
  const businessDate = ref<string | null>(null);
  const deliveryUnknownRunIds = ref<ReadonlySet<string>>(new Set());
  const detailUnavailableRunIds = ref<ReadonlySet<string>>(new Set());
  let controller: AbortController | undefined;
  let requestNumber = 0;

  function cancelRuns(): void {
    controller?.abort();
    controller = undefined;
  }

  async function loadRuns(): Promise<void> {
    const runtime = app.runtime.data.value;
    if (runtime === null) {
      runsLoading.value = app.runtime.error.value === null;
      runsError.value = app.runtime.error.value;
      return;
    }

    cancelRuns();
    const currentRequest = ++requestNumber;
    const requestController = new AbortController();
    controller = requestController;
    runsLoading.value = true;
    runsError.value = null;
    let date: string;
    try {
      date = resolveBusinessDate(now(), runtime.timezone);
      businessDate.value = date;
      const runs = await app.api.listRuns(
        { businessDate: date, limit: 100 },
        requestController.signal,
      );
      const uncertain = new Set<string>();
      const unavailable = new Set<string>();
      await Promise.all(
        runs
          .filter((run) => run.status === 'FAILED')
          .map(async (run) => {
            try {
              const records = await app.api.listSendRecords(run.id, requestController.signal);
              if (records.some((record) => record.status === 'DELIVERY_UNKNOWN')) {
                uncertain.add(run.id);
              }
            } catch (error) {
              const requestError = safeError(error);
              if (requestError.kind !== 'ABORT') unavailable.add(run.id);
            }
          }),
      );
      if (currentRequest === requestNumber) {
        runsData.value = runs;
        deliveryUnknownRunIds.value = uncertain;
        detailUnavailableRunIds.value = unavailable;
      }
    } catch (error) {
      const requestError = safeError(error);
      if (currentRequest === requestNumber && requestError.kind !== 'ABORT') {
        runsError.value = requestError;
      }
    } finally {
      if (currentRequest === requestNumber) runsLoading.value = false;
    }
  }

  const classification = computed(() => {
    if (accounts.data.value === null || runsData.value === null) return null;
    return classifyOverviewState({
      accounts: accounts.data.value,
      runs: runsData.value,
      deliveryUnknownRunIds: deliveryUnknownRunIds.value,
      detailUnavailableRunIds: detailUnavailableRunIds.value,
    });
  });
  const classificationWarning = computed(() =>
    detailUnavailableRunIds.value.size > 0
      ? 'Unable to determine detailed failure reason for one or more runs.'
      : null,
  );

  watch(
    () => app.runtime.data.value?.timezone,
    (timezone, previousTimezone) => {
      if (timezone !== undefined && timezone !== previousTimezone) void loadRuns();
    },
    { immediate: true },
  );
  watch(
    [app.runtime.loading, app.runtime.error],
    ([loading, error]) => {
      if (app.runtime.data.value !== null) return;
      runsLoading.value = loading || error === null;
      runsError.value = error;
    },
    { immediate: true },
  );
  watch(app.refreshVersion, () => {
    void accounts.load();
    void loadRuns();
  });

  useRealtimeRefresh(app.realtime, invalidatesOverviewAccounts, () => void accounts.load());
  useRealtimeRefresh(app.realtime, invalidatesOverviewRuns, () => void loadRuns());
  onBeforeUnmount(cancelRuns);

  return {
    accounts,
    runs: {
      data: runsData,
      error: runsError,
      loading: runsLoading,
      load: loadRuns,
    },
    businessDate: readonly(businessDate),
    classification,
    classificationWarning,
    refresh() {
      void accounts.load();
      void loadRuns();
    },
  };
}
