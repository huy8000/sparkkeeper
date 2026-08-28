<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { useAdminApp } from '../appContext';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FormPanel from '../components/FormPanel.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import ScheduleForm from '../components/ScheduleForm.vue';
import { useRequest } from '../composables/useRequest';
import { useMutation } from '../composables/useMutation';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { useTranslation } from '../i18n';
import type { ConfigureScheduleInput, Schedule } from '../types/api';

const app = useAdminApp();
const { t } = useTranslation();
const result = useRequest(async (signal) => {
  const accounts = await app.api.listAccounts(signal);
  const groupedSchedules = await Promise.all(
    accounts.map(async (account) => ({
      account,
      schedules: await app.api.listSchedules(account.id, signal),
    })),
  );
  return groupedSchedules.flatMap(({ account, schedules }) =>
    schedules.map((schedule) => ({ schedule, accountName: account.name })),
  );
});
const runtimeSchedulerLabel = computed(() =>
  app.runtime.data.value?.schedulerEnabled ? 'ENABLED' : 'DISABLED',
);
watch(app.refreshVersion, () => void result.load());
useRealtimeRefresh(
  app.realtime,
  (event) =>
    event.type === 'CONFIG_CHANGED' &&
    (event.data.entityType === 'SCHEDULE' || event.data.entityType === 'ACCOUNT'),
  () => void result.load(),
);
const editingSchedule = ref<Schedule | null>(null);
const {
  submitting,
  error: formError,
  success: successMessage,
  execute,
  clearError,
} = useMutation();

async function saveSchedule(input: ConfigureScheduleInput): Promise<void> {
  const accountId = editingSchedule.value?.accountId;
  if (accountId === undefined) return;
  await execute(
    () => app.api.configureSchedule(accountId, input),
    async () => {
      editingSchedule.value = null;
      await result.load();
    },
    t('scheduleTab.savedToast'),
  );
}

function closeForm(): void {
  editingSchedule.value = null;
  clearError();
}
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">{{ t('pages.schedules') }}</p>
        <h2>{{ t('schedulesPage.title') }}</h2>
        <p>{{ t('schedulesPage.subtitle') }}</p>
      </div>
      <button class="button button--secondary" type="button" @click="result.load">
        {{ t('common.refresh') }}
      </button>
    </header>
    <section class="notice-card">
      <span>{{ t('schedulesPage.runtimeScheduler') }}</span>
      <StatusBadge v-if="app.runtime.data.value" :status="runtimeSchedulerLabel" />
      <span v-else>{{ t('scheduleTab.unavailable') }}</span>
      <small>{{ t('schedulesPage.rowNote') }}</small>
    </section>
    <p v-if="successMessage" class="success-message" role="status">{{ successMessage }}</p>
    <FormPanel
      v-if="editingSchedule"
      :title="t('scheduleTab.edit')"
      :description="t('schedulesPage.editPanelDescription')"
      @cancel="closeForm"
    >
      <ScheduleForm
        :schedule="editingSchedule"
        :submitting="submitting"
        :server-error="formError"
        @submit="saveSchedule"
        @cancel="closeForm"
      />
    </FormPanel>
    <LoadingState
      v-if="result.loading.value && !result.data.value"
      :label="t('schedulesPage.loading')"
    />
    <ErrorState
      v-else-if="result.error.value"
      :message="result.error.value.message"
      @retry="result.load"
    />
    <EmptyState
      v-else-if="result.data.value?.length === 0"
      :title="t('schedulesPage.emptyTitle')"
      :description="t('schedulesPage.emptyDescription')"
    />
    <div v-else-if="result.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('common.account') }}</th>
            <th>{{ t('schedulesPage.columnWindow') }}</th>
            <th>{{ t('scheduleTab.timezone') }}</th>
            <th>{{ t('scheduleTab.scheduleEnabled') }}</th>
            <th>{{ t('schedulesPage.columnMaxAttempts') }}</th>
            <th>{{ t('scheduleTab.retryInterval') }}</th>
            <th>{{ t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in result.data.value" :key="item.schedule.id">
            <td>
              <RouterLink class="table-link" :to="`/accounts/${item.schedule.accountId}`">{{
                item.accountName
              }}</RouterLink>
            </td>
            <td>{{ item.schedule.startTime }}–{{ item.schedule.endTime }}</td>
            <td>{{ item.schedule.timezone }}</td>
            <td><StatusBadge :status="item.schedule.enabled ? 'ENABLED' : 'DISABLED'" /></td>
            <td>{{ item.schedule.maxAttempts }}</td>
            <td>
              {{ t('schedulesPage.secondsShort', { n: item.schedule.retryIntervalSeconds }) }}
            </td>
            <td>
              <button
                class="button button--secondary button--compact"
                type="button"
                @click="
                  editingSchedule = item.schedule;
                  formError = '';
                "
              >
                {{ t('common.edit') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
