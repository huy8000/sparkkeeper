<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { useAdminApp } from '../appContext';
import { createSecurityApi, type AdminSessionSummary } from '../api/securityApi';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { formatTimestamp } from '../utils/format';
const app = useAdminApp(),
  { t } = useTranslation();
const api = createSecurityApi({
  csrfTokenProvider: app.auth.getCsrfToken,
  onUnauthenticated: () => app.auth.handleSessionLoss(),
});
const sessions = useRequest((signal) => api.sessions(signal));
const password = ref(''),
  currentPassword = ref(''),
  replacement = ref(''),
  repeat = ref(''),
  confirmed = ref(false),
  busy = ref(false),
  message = ref('');
function clear() {
  password.value = '';
  currentPassword.value = '';
  replacement.value = '';
  repeat.value = '';
}
onBeforeUnmount(clear);
async function act(action: 'reauth' | 'password' | 'revoke', session?: AdminSessionSummary) {
  if (busy.value || (action !== 'reauth' && !confirmed.value)) return;
  if (action === 'password' && replacement.value !== repeat.value) {
    message.value = 'v410.mismatch';
    return;
  }
  if (
    action === 'password' &&
    ([...replacement.value].length < 14 || [...replacement.value].length > 256)
  ) {
    message.value = 'v410.securityError';
    return;
  }
  busy.value = true;
  message.value = '';
  try {
    if (action === 'reauth') {
      await api.reauth(password.value);
      message.value = 'v410.reauthSuccess';
    } else if (action === 'password') {
      await api.changePassword(currentPassword.value, replacement.value);
      app.auth.handleSessionLoss();
    } else if (session) {
      await api.revoke(session);
      if (session.current) app.auth.handleSessionLoss();
      else await sessions.load();
    }
    confirmed.value = false;
  } catch {
    message.value = 'v410.securityError';
  } finally {
    clear();
    busy.value = false;
  }
}
</script>
<template>
  <div class="page-stack security-page">
    <h2>{{ t('v410.security') }}</h2>
    <p>{{ t('v410.reauthNote') }}</p>
    <p v-if="message" role="status">{{ t(message) }}</p>
    <form class="panel form-stack" @submit.prevent="act('reauth')">
      <label
        >{{ t('v410.password')
        }}<input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
          :disabled="busy"
      /></label>
      <button class="button button--secondary" :disabled="busy">{{ t('v410.reauth') }}</button>
    </form>
    <form class="panel form-stack" @submit.prevent="act('password')">
      <label
        >{{ t('v410.password')
        }}<input
          v-model="currentPassword"
          type="password"
          autocomplete="current-password"
          required
          :disabled="busy"
      /></label>
      <label
        >{{ t('v410.newPassword')
        }}<input
          v-model="replacement"
          type="password"
          autocomplete="new-password"
          required
          minlength="14"
          maxlength="512"
          :disabled="busy"
      /></label>
      <label
        >{{ t('v410.repeatPassword')
        }}<input
          v-model="repeat"
          type="password"
          autocomplete="new-password"
          required
          minlength="14"
          maxlength="512"
          :disabled="busy"
      /></label>
      <label
        ><input v-model="confirmed" type="checkbox" :disabled="busy" />{{
          t('v410.confirmSecurity')
        }}</label
      >
      <button class="button button--danger" :disabled="busy || !confirmed">
        {{ t('v410.changePassword') }}
      </button>
    </form>
    <h3>{{ t('v410.sessions') }}</h3>
    <button class="button button--secondary" :disabled="busy" @click="sessions.load()">
      {{ t('common.refresh') }}
    </button>
    <p v-if="sessions.error.value" role="alert">{{ t('v410.readError') }}</p>
    <p v-if="sessions.loading.value" role="status">{{ t('v410.loading') }}</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ t('v410.time') }}</th>
            <th>{{ t('v410.status') }}</th>
            <th>{{ t('v410.action') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in sessions.data.value ?? []" :key="r.id">
            <td>{{ formatTimestamp(r.lastSeenAt) }}</td>
            <td>
              {{ r.current ? t('v410.current') : r.id }} {{ r.revokedAt ? t('v410.revoked') : '' }}
            </td>
            <td>
              <button
                class="button button--danger"
                :disabled="busy || !confirmed || !!r.revokedAt"
                @click="act('revoke', r)"
              >
                {{ t('v410.revoke') }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
