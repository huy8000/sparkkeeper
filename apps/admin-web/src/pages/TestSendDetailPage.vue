<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAdminApp } from '../appContext';
import { createTestSendApi } from '../api/testSendApi';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { useApiErrorText } from '../composables/useApiErrorText';
const app = useAdminApp(),
  route = useRoute(),
  { t } = useTranslation(),
  { apiErrorText } = useApiErrorText();
const api = createTestSendApi({
  csrfTokenProvider: app.auth.getCsrfToken,
  onUnauthenticated: () => app.auth.handleSessionLoss(),
});
const runId = computed(() => String(route.params.runId));
const detail = useRequest((signal) => api.detail(runId.value, signal));
watch(runId, () => {
  detail.reset();
  void detail.load();
});
</script>
<template>
  <section class="page-stack">
    <h2>{{ t('testSend.detail') }}</h2>
    <p>{{ t('testSend.noRetry') }}</p>
    <p v-if="detail.error.value" role="alert">{{ apiErrorText(detail.error.value) }}</p>
    <template v-if="detail.data.value"
      ><p>{{ detail.data.value.runId }} · {{ detail.data.value.status }}</p>
      <p>
        {{ detail.data.value.record.contactId }} · {{ detail.data.value.record.machineStatus }} ·
        {{ detail.data.value.record.failureCode }}
      </p></template
    ><button :disabled="detail.loading.value" @click="detail.load()">
      {{ t('testSend.refresh') }}
    </button>
  </section>
</template>
