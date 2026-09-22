<script setup lang="ts">
/* global setInterval, clearInterval */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { ApiError } from '../api/client';
import { useAdminApp } from '../appContext';
import { useApiErrorText } from '../composables/useApiErrorText';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';

const app = useAdminApp();
const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const { apiErrorText } = useApiErrorText();
const sessionId = computed(() => String(route.params.sessionId ?? ''));
const session = useRequest((signal) => app.api.getAccountLogin(sessionId.value, signal));
const nowMs = ref(Date.now());
const cancelling = ref(false);
const cancelError = ref<ApiError | null>(null);
const consolePath = computed(
  () => `/api/account-login-sessions/${encodeURIComponent(sessionId.value)}/console`,
);
const remainingSeconds = computed(() => {
  if (!session.data.value) return 0;
  return Math.max(0, Math.ceil((Date.parse(session.data.value.expiresAt) - nowMs.value) / 1_000));
});
const isTerminal = computed(() =>
  ['COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED'].includes(session.data.value?.status ?? ''),
);

let refreshTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  refreshTimer = setInterval(() => {
    nowMs.value = Date.now();
    if (!isTerminal.value) void session.load();
  }, 3_000);
});
onBeforeUnmount(() => {
  if (refreshTimer !== undefined) clearInterval(refreshTimer);
});
watch(sessionId, () => session.reset());
watch(
  () => session.data.value,
  (value) => {
    if (value?.status === 'COMPLETED' && value.resultAccountId !== null) {
      void router.replace(`/accounts/${value.resultAccountId}/overview`);
    }
  },
);

async function cancel(): Promise<void> {
  const current = session.data.value;
  if (current === null || !current.cancellable || cancelling.value) return;
  cancelling.value = true;
  cancelError.value = null;
  try {
    const updated = await app.api.cancelAccountLogin(current.id, current.updatedAt);
    session.data.value = updated;
  } catch (error) {
    cancelError.value =
      error instanceof ApiError
        ? error
        : new ApiError('UNEXPECTED_ERROR', t('common.unexpectedError'), 0, 'MALFORMED');
    await session.load();
  } finally {
    cancelling.value = false;
  }
}
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">{{ t('nav.accounts') }}</p>
        <h2>{{ t('accountLogin.title') }}</h2>
        <p>{{ t('accountLogin.instructions') }}</p>
      </div>
      <div class="page-actions">
        <RouterLink class="button button--secondary" to="/accounts">{{
          t('account.backToAccounts')
        }}</RouterLink>
        <button class="button button--secondary" type="button" @click="session.load">
          {{ t('common.refresh') }}
        </button>
      </div>
    </header>

    <p v-if="session.initialLoading.value">{{ t('common.loadingPage') }}</p>
    <p v-else-if="session.initialError.value" role="alert">
      {{ apiErrorText(session.initialError.value) }}
    </p>
    <section v-else-if="session.data.value" class="account-summary-card" aria-live="polite">
      <p>
        {{ t('accountLogin.purpose') }}:
        {{
          session.data.value.purpose === 'ADD_ACCOUNT'
            ? t('accountLogin.add')
            : t('accountLogin.relogin')
        }}
      </p>
      <h3>{{ t(`accountLogin.status.${session.data.value.status}`) }}</h3>
      <p v-if="!isTerminal">{{ t('accountLogin.remaining', { seconds: remainingSeconds }) }}</p>
      <p v-if="session.data.value.failureCode">
        {{ t('accountLogin.failed') }}: {{ session.data.value.failureCode }}
      </p>
      <div class="page-actions">
        <a
          v-if="session.data.value.consoleAvailable"
          class="button button--primary"
          :href="consolePath"
          target="_blank"
          rel="noopener"
          >{{ t('accountLogin.openConsole') }}</a
        >
        <button
          v-if="session.data.value.cancellable"
          class="button button--secondary"
          type="button"
          :disabled="cancelling"
          @click="cancel"
        >
          {{ t('accountLogin.cancel') }}
        </button>
      </div>
      <p v-if="cancelError" role="alert">{{ apiErrorText(cancelError) }}</p>
    </section>
  </div>
</template>
