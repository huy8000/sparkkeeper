<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAdminApp } from '../appContext';
import { createMigrationApi } from '../api/migrationApi';
import { createContactsApi } from '../api/contactApi';
import { useRequest } from '../composables/useRequest';
import type { LegacyFriendSummary, LegacyScheduleSummary } from '@sparkkeeper/shared';
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
    error.value = '操作被拒绝。若版本冲突，请刷新；敏感操作需要五分钟内重新登录。不会自动重试。';
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
    <header class="page-heading"><h2>Legacy 迁移</h2></header>
    <p>
      不按名称自动匹配。请先对账号重新登录并同步 Contact，再明确选择绑定对象；导入的 Task 始终
      disabled，不触发发送。
    </p>
    <p>
      旧 profile 只允许服务/maintenance 全部停止并完整备份后使用离线
      CLI；多账号请逐账号使用现有重新登录流程。此页面不接收路径。
    </p>
    <label
      >账号
      <select v-model="account">
        <option value="">请选择</option>
        <option v-for="a in accounts.data.value ?? []" :key="a.id" :value="a.id">
          {{ a.name }} — {{ a.profileState }} / {{ a.loginStatus }}
        </option>
      </select></label
    >
    <RouterLink v-if="account" :to="`/accounts/${account}/overview`"
      >账号重新登录 / 状态</RouterLink
    >
    <label
      >明确选择 Contact（最多100个，Friend绑定只选1个）<select v-model="selected" multiple>
        <option v-for="c in contacts.data.value?.items ?? []" :key="c.id" :value="c.id">
          {{ c.displayName }} — {{ c.type }} — {{ c.id }}
        </option>
      </select></label
    >
    <label
      ><input v-model="confirmed" type="checkbox" :disabled="busy" />我已人工确认所选内部
      ID；此操作不会发送或启用 Task。</label
    >
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="friends.error.value || schedules.error.value || contacts.error.value" role="alert">
      迁移数据读取失败，请刷新后操作。
    </p>
    <section>
      <h3>Friend 绑定</h3>
      <div v-for="r in friends.data.value?.items ?? []" :key="r.id">
        <p>
          Legacy Friend {{ r.friendId }} — {{ r.status }} — Contact {{ r.contactId ?? '未绑定' }}
        </p>
        <button
          :disabled="busy || !confirmed || r.status !== 'PENDING' || selected.length !== 1"
          @click="bind(r)"
        >
          显式绑定</button
        ><button
          :disabled="busy || !confirmed || r.status !== 'PENDING'"
          @click="act(() => api.dismissFriend(r))"
        >
          忽略，保留历史
        </button>
      </div>
      <button
        v-if="friends.data.value?.nextCursor"
        @click="
          friendCursor = friends.data.value!.nextCursor!;
          friends.load();
        "
      >
        下一页
      </button>
    </section>
    <section>
      <h3>Schedule 导入</h3>
      <label>新 Task 名称 <input v-model="name" maxlength="120" /></label
      ><label
        >模板
        <select v-model="template">
          <option value="">请选择</option>
          <option v-for="t in templates.data.value ?? []" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </select></label
      >
      <div v-for="r in schedules.data.value?.items ?? []" :key="r.id">
        <p>
          {{ r.startTimeSnapshot }}–{{ r.endTimeSnapshot }} / {{ r.timezoneSnapshot }} —
          {{ r.status }} — 原 enabled={{ r.legacyEnabledSnapshot }}
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
          导入为 disabled Task</button
        ><button
          :disabled="busy || !confirmed || r.status !== 'PENDING'"
          @click="act(() => api.dismissSchedule(r))"
        >
          忽略，保留历史
        </button>
      </div>
      <button
        v-if="schedules.data.value?.nextCursor"
        @click="
          scheduleCursor = schedules.data.value!.nextCursor!;
          schedules.load();
        "
      >
        下一页
      </button>
    </section>
  </div>
</template>
