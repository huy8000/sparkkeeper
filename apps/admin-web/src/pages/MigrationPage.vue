<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAdminApp } from '../appContext';
import { createMigrationApi } from '../api/migrationApi';
import { createContactsApi } from '../api/contactApi';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import type { LegacyFriendSummary, LegacyScheduleSummary } from '@sparkkeeper/shared';
const { t } = useTranslation();
const app = useAdminApp(),
  options = {
    csrfTokenProvider: app.auth.getCsrfToken,
    onUnauthenticated: () => app.auth.handleSessionLoss(),
  };
const api = createMigrationApi(options),
  contactApi = createContactsApi(options);
const account = ref(''),
  selected = ref<string[]>([]),
  template = ref(''),
  name = ref(''),
  confirmed = ref(false),
  busy = ref(false),
  error = ref('');
const friendCursor = ref(''),
  scheduleCursor = ref('');
const accounts = useRequest((s) => app.api.listAccounts(s)),
  templates = useRequest((s) => app.api.listTemplates(s));
const friends = useRequest(() => api.friends(account.value, friendCursor.value), {
    immediate: false,
  }),
  schedules = useRequest(() => api.schedules(account.value, scheduleCursor.value), {
    immediate: false,
  });
const contacts = useRequest((s) => contactApi.list(account.value, { limit: '200' }, s), {
  immediate: false,
});
watch(account, () => {
  selected.value = [];
  confirmed.value = false;
  friendCursor.value = '';
  scheduleCursor.value = '';
  friends.reset();
  schedules.reset();
  contacts.reset();
  if (account.value) {
    void friends.load();
    void schedules.load();
    void contacts.load();
  }
});
async function act(fn: () => Promise<unknown>) {
  if (busy.value || !confirmed.value) return;
  busy.value = true;
  error.value = '';
  try {
    await fn();
    confirmed.value = false;
    await Promise.all([friends.load(), schedules.load()]);
  } catch {
    error.value = 'v410.mutationError';
  } finally {
    busy.value = false;
  }
}
function bind(r: LegacyFriendSummary) {
  if (selected.value.length === 1) void act(() => api.bind(r, selected.value[0]!));
}
function convert(r: LegacyScheduleSummary) {
  if (selected.value.length && template.value && name.value.trim())
    void act(() => api.convert(r, name.value, template.value, [...selected.value]));
}
</script>
<template>
  <div class="page-stack">
    <header class="page-heading">
      <h2>{{ t('v410.migration') }}</h2>
    </header>
    <p>
      {{ t('v410.migrationNote') }}
    </p>
    <p>
      {{ t('v410.profileNote') }}
    </p>
    <label
      >{{ t('v410.account') }}
      <select v-model="account">
        <option value="">{{ t('v410.choose') }}</option>
        <option v-for="a in accounts.data.value ?? []" :key="a.id" :value="a.id">
          {{ a.name }} — {{ a.profileState }} / {{ a.loginStatus }}
        </option>
      </select></label
    >
    <RouterLink v-if="account" :to="`/accounts/${account}/overview`">{{
      t('v410.relogin')
    }}</RouterLink>
    <label
      >{{ t('v410.selectContacts')
      }}<select v-model="selected" multiple>
        <option v-for="c in contacts.data.value?.items ?? []" :key="c.id" :value="c.id">
          {{ c.displayName }} — {{ c.type }} — {{ c.id }}
        </option>
      </select></label
    >
    <label
      ><input v-model="confirmed" type="checkbox" :disabled="busy" />{{
        t('v410.confirmMigration')
      }}</label
    >
    <p v-if="error" role="alert">{{ t(error) }}</p>
    <p v-if="friends.error.value || schedules.error.value || contacts.error.value" role="alert">
      {{ t('v410.readError') }}
    </p>
    <section>
      <h3>{{ t('v410.friends') }}</h3>
      <div v-for="r in friends.data.value?.items ?? []" :key="r.id">
        <p>
          Legacy Friend {{ r.friendId }} — {{ r.status }} — Contact
          {{ r.contactId ?? t('v410.unbound') }}
        </p>
        <button
          :disabled="busy || !confirmed || r.status !== 'PENDING' || selected.length !== 1"
          @click="bind(r)"
        >
          {{ t('v410.bind') }}</button
        ><button
          :disabled="busy || !confirmed || r.status !== 'PENDING'"
          @click="act(() => api.dismissFriend(r))"
        >
          {{ t('v410.dismiss') }}
        </button>
      </div>
      <button
        v-if="friends.data.value?.nextCursor"
        @click="
          friendCursor = friends.data.value!.nextCursor!;
          friends.load();
        "
      >
        {{ t('v410.next') }}
      </button>
    </section>
    <section>
      <h3>{{ t('v410.schedules') }}</h3>
      <label>{{ t('v410.taskName') }} <input v-model="name" maxlength="120" /></label
      ><label
        >{{ t('v410.template') }}
        <select v-model="template">
          <option value="">{{ t('v410.choose') }}</option>
          <option
            v-for="templateOption in templates.data.value ?? []"
            :key="templateOption.id"
            :value="templateOption.id"
          >
            {{ templateOption.name }}
          </option>
        </select></label
      >
      <div v-for="r in schedules.data.value?.items ?? []" :key="r.id">
        <p>
          {{ r.startTimeSnapshot }}–{{ r.endTimeSnapshot }} / {{ r.timezoneSnapshot }} —
          {{ r.status }} — {{ t('v410.originalEnabled') }}={{ r.legacyEnabledSnapshot }}
        </p>
        <button
          :disabled="
            busy ||
            !confirmed ||
            r.status !== 'PENDING' ||
            !selected.length ||
            selected.length > 100 ||
            !template ||
            !name.trim()
          "
          @click="convert(r)"
        >
          {{ t('v410.importDisabled') }}</button
        ><button
          :disabled="busy || !confirmed || r.status !== 'PENDING'"
          @click="act(() => api.dismissSchedule(r))"
        >
          {{ t('v410.dismiss') }}
        </button>
      </div>
      <button
        v-if="schedules.data.value?.nextCursor"
        @click="
          scheduleCursor = schedules.data.value!.nextCursor!;
          schedules.load();
        "
      >
        {{ t('v410.next') }}
      </button>
    </section>
  </div>
</template>
