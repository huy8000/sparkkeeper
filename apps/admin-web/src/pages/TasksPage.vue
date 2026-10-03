<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import type { TaskConfiguration, TaskDetail } from '@sparkkeeper/shared';
import { useAdminApp } from '../appContext';
import { createTaskApi } from '../api/taskApi';
import { createContactsApi } from '../api/contactApi';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { useApiErrorText } from '../composables/useApiErrorText';
import { ApiError } from '../api/client';
const app = useAdminApp(),
  route = useRoute();
const { t } = useTranslation(),
  { apiErrorText } = useApiErrorText();
const filter = computed(() =>
  typeof route.params.accountId === 'string' ? route.params.accountId : undefined,
);
const options = {
  csrfTokenProvider: app.auth.getCsrfToken,
  onUnauthenticated: () => app.auth.handleSessionLoss(),
};
const api = createTaskApi(options),
  contactsApi = createContactsApi(options);
const tasks = useRequest((signal) => api.list(filter.value, signal));
const accounts = useRequest((signal) => app.api.listAccounts(signal)),
  templates = useRequest((signal) => app.api.listTemplates(signal));
const cfg = ref<TaskConfiguration>({
  name: '',
  accountId: filter.value ?? '',
  templateId: '',
  contactIds: [],
  schedule: {
    type: 'DAILY_WINDOW',
    startTime: '09:00',
    endTime: '18:00',
    timezone: 'Asia/Shanghai',
    maxAttempts: 3,
    retryIntervalSeconds: 60,
  },
});
const contacts = useRequest(
  (signal) =>
    contactsApi.list(
      cfg.value.accountId,
      { limit: '200', availability: 'AVAILABLE', identityStatus: 'READY' },
      signal,
    ),
  { immediate: false },
);
const selected = ref<TaskDetail | null>(null),
  busy = ref(false),
  confirm = ref(false),
  error = ref<ApiError | string>('');
const dirty = computed(
  () =>
    !!selected.value &&
    JSON.stringify({ ...cfg.value, contactIds: [...cfg.value.contactIds].sort() }) !==
      JSON.stringify({
        name: selected.value.name,
        accountId: selected.value.accountId,
        templateId: selected.value.templateId,
        schedule: selected.value.schedule,
        contactIds: [...selected.value.contactIds].sort(),
      }),
);
let epoch = 0;
let controller: InstanceType<typeof globalThis.AbortController> | undefined;
watch(
  () => cfg.value.accountId,
  () => {
    cfg.value.contactIds = [];
    contacts.reset();
    if (cfg.value.accountId) void contacts.load();
  },
  { flush: 'sync', immediate: true },
);
watch(filter, () => {
  epoch++;
  controller?.abort();
  busy.value = false;
  selected.value = null;
  confirm.value = false;
  cfg.value.accountId = filter.value ?? '';
  tasks.reset();
  void tasks.load();
});
watch(
  () => app.auth.state.value,
  () => {
    if (!app.auth.isAuthenticated()) {
      epoch++;
      controller?.abort();
      busy.value = false;
      selected.value = null;
      confirm.value = false;
    }
  },
);
onBeforeUnmount(() => {
  epoch++;
  controller?.abort();
  tasks.cancel();
  contacts.cancel();
  accounts.cancel();
  templates.cancel();
});
function edit(task: TaskDetail) {
  selected.value = task;
  cfg.value = {
    name: task.name,
    accountId: task.accountId,
    templateId: task.templateId,
    schedule: { ...task.schedule },
    contactIds: [],
  };
  cfg.value.contactIds = [...task.contactIds];
  confirm.value = false;
}
async function mutate(operation: 'save' | 'enable' | 'disable' | 'archive', task = selected.value) {
  if (
    busy.value ||
    ((operation === 'enable' || operation === 'archive') && (!confirm.value || dirty.value))
  )
    return;
  const version = epoch;
  controller = new globalThis.AbortController();
  busy.value = true;
  error.value = '';
  try {
    if (operation === 'save') {
      if (task) await api.update(task, cfg.value, controller.signal);
      else await api.create(cfg.value, controller.signal);
    } else if (task) await api.operate(task, operation, controller.signal);
    if (version !== epoch) return;
    selected.value = null;
    confirm.value = false;
    await tasks.load();
  } catch (e) {
    if (version === epoch) error.value = e instanceof ApiError ? e : t('tasks.error');
  } finally {
    if (version === epoch) busy.value = false;
  }
}
</script>
<template>
  <section class="page-stack">
    <h2>{{ t('tasks.title') }}</h2>
    <p>{{ t('tasks.scope') }}</p>
    <p>
      {{ t('tasks.master') }}: {{ tasks.data.value?.masterOpen ?? false }} ·
      {{ t('tasks.released') }}: {{ tasks.data.value?.released ?? false }}
    </p>
    <button :disabled="busy" @click="tasks.load()">{{ t('common.refresh') }}</button>
    <p
      v-if="
        error ||
        tasks.error.value ||
        contacts.error.value ||
        accounts.error.value ||
        templates.error.value
      "
      role="alert"
    >
      {{
        apiErrorText(
          error ||
            tasks.error.value ||
            contacts.error.value ||
            accounts.error.value ||
            templates.error.value,
        )
      }}
    </p>
    <article v-for="task in tasks.data.value?.items ?? []" :key="task.id" class="panel">
      <p>
        {{ task.name }} · {{ task.state }} · {{ task.schedule.startTime }}–{{
          task.schedule.endTime
        }}
        {{ task.schedule.timezone }}
      </p>
      <p>
        {{ task.contactIds.length }} {{ t('tasks.targets') }} · {{ t('tasks.overlaps') }}:
        {{ task.overlaps.join(', ') || '—' }}
      </p>
      <RouterLink v-if="task.latestRun" :to="`/scheduled-runs/${task.latestRun.id}`"
        >{{ task.latestRun.businessDate }} · {{ task.latestRun.status }}</RouterLink
      >
      <button :disabled="busy || task.enabled || !!task.archivedAt" @click="edit(task)">
        {{ t('tasks.edit') }}</button
      ><button :disabled="busy || !task.enabled" @click="mutate('disable', task)">
        {{ t('tasks.disable') }}
      </button>
    </article>
    <form class="panel page-stack" @submit.prevent="mutate('save')">
      <h3>{{ selected ? t('tasks.edit') : t('tasks.create') }}</h3>
      <label
        >{{ t('tasks.name') }}<input v-model="cfg.name" required maxlength="120" :disabled="busy"
      /></label>
      <label
        >{{ t('tasks.account')
        }}<select v-model="cfg.accountId" required :disabled="busy">
          <option value="">—</option>
          <option v-for="a in accounts.data.value ?? []" :key="a.id" :value="a.id">
            {{ a.name }}
          </option>
        </select></label
      >
      <label
        >{{ t('tasks.template')
        }}<select v-model="cfg.templateId" required :disabled="busy">
          <option value="">—</option>
          <option v-for="v in templates.data.value ?? []" :key="v.id" :value="v.id">
            {{ v.name }}
          </option>
        </select></label
      >
      <fieldset :disabled="busy">
        <legend>{{ t('tasks.targets') }} ({{ cfg.contactIds.length }}/100)</legend>
        <label
          v-for="c in contacts.data.value?.items.filter(
            (c) => c.type === 'PERSON' || c.type === 'GROUP',
          ) ?? []"
          :key="c.id"
          ><input
            v-model="cfg.contactIds"
            type="checkbox"
            :value="c.id"
            :disabled="!cfg.contactIds.includes(c.id) && cfg.contactIds.length >= 100"
          />{{ c.displayName }} · {{ c.type }} · {{ c.id.slice(-8) }}</label
        >
      </fieldset>
      <label
        >{{ t('tasks.start')
        }}<input v-model="cfg.schedule.startTime" type="time" required :disabled="busy" /></label
      ><label
        >{{ t('tasks.end')
        }}<input v-model="cfg.schedule.endTime" type="time" required :disabled="busy" /></label
      ><label
        >{{ t('tasks.timezone') }}<input v-model="cfg.schedule.timezone" required :disabled="busy"
      /></label>
      <label
        >{{ t('tasks.attempts')
        }}<input
          v-model.number="cfg.schedule.maxAttempts"
          type="number"
          min="1"
          max="5"
          required
          :disabled="busy" /></label
      ><label
        >{{ t('tasks.interval')
        }}<input
          v-model.number="cfg.schedule.retryIntervalSeconds"
          type="number"
          min="1"
          max="86400"
          required
          :disabled="busy"
      /></label>
      <button data-testid="save-task" :disabled="busy || !cfg.contactIds.length" type="submit">
        {{ t('tasks.save') }}
      </button>
      <template v-if="selected"
        ><label
          ><input v-model="confirm" type="checkbox" :disabled="busy" />{{ t('tasks.confirm') }} ·
          {{ t('tasks.overlaps') }}: {{ selected.overlaps.join(', ') || '—' }}</label
        ><button
          data-testid="enable-task"
          type="button"
          :disabled="busy || dirty || !confirm || !tasks.data.value?.released"
          @click="mutate('enable')"
        >
          {{ t('tasks.enable') }}</button
        ><button
          data-testid="archive-task"
          type="button"
          :disabled="busy || dirty || !confirm"
          @click="mutate('archive')"
        >
          {{ t('tasks.archive') }}</button
        ><button
          type="button"
          :disabled="busy"
          @click="
            selected = null;
            confirm = false;
          "
        >
          {{ t('common.cancel') }}
        </button></template
      >
    </form>
  </section>
</template>
