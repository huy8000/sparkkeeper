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
import type { ConfigureScheduleInput, Schedule } from '../types/api';

const app = useAdminApp();
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
    'Schedule configuration saved.',
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
        <p class="eyebrow">Schedules</p>
        <h2>Account schedule windows</h2>
        <p>Schedule configuration is distinct from the runtime scheduler control.</p>
      </div>
      <button class="button button--secondary" type="button" @click="result.load">Refresh</button>
    </header>
    <section class="notice-card">
      <span>Runtime scheduler</span>
      <StatusBadge v-if="app.runtime.data.value" :status="runtimeSchedulerLabel" />
      <span v-else>Unavailable</span>
      <small>Each row below independently reports whether that schedule is enabled.</small>
    </section>
    <p v-if="successMessage" class="success-message" role="status">{{ successMessage }}</p>
    <FormPanel
      v-if="editingSchedule"
      title="Edit schedule"
      description="Saving updates configuration only; it does not run the scheduler."
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
    <LoadingState v-if="result.loading.value && !result.data.value" label="Loading schedules…" />
    <ErrorState
      v-else-if="result.error.value"
      :message="result.error.value.message"
      @retry="result.load"
    />
    <EmptyState
      v-else-if="result.data.value?.length === 0"
      title="No schedules"
      description="No account schedules are available."
    />
    <div v-else-if="result.data.value" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Window</th>
            <th>Timezone</th>
            <th>Schedule enabled</th>
            <th>Max attempts</th>
            <th>Retry interval</th>
            <th>Actions</th>
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
            <td>{{ item.schedule.retryIntervalSeconds }} sec</td>
            <td>
              <button
                class="button button--secondary button--compact"
                type="button"
                @click="
                  editingSchedule = item.schedule;
                  formError = '';
                "
              >
                Edit
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
