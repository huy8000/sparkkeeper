<script setup lang="ts">
import { computed, watch } from 'vue';

import { useAdminApp } from '../appContext';
import BackgroundRefreshIndicator from '../components/BackgroundRefreshIndicator.vue';
import InlineError from '../components/InlineError.vue';
import PageError from '../components/PageError.vue';
import RuntimeStatus from '../components/RuntimeStatus.vue';
import SectionLoading from '../components/SectionLoading.vue';
import Skeleton from '../components/Skeleton.vue';
import StatusBadge from '../components/StatusBadge.vue';
import StaleDataNotice from '../components/StaleDataNotice.vue';
import { useRequest } from '../composables/useRequest';
import { useTranslation } from '../i18n';
import { classifyRuntimeReadiness, classifySystemSummary } from '../operations/runtimeReadiness';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const { t } = useTranslation();
const health = useRequest((signal) => app.api.getHealth(signal));

watch(app.refreshVersion, () => void health.load());

const systemSummary = computed(() =>
  classifySystemSummary({
    health: health.data.value,
    runtime: app.runtime.data.value,
    healthError: health.error.value !== null,
    runtimeError: app.runtime.error.value !== null,
  }),
);
const runtimeReadiness = computed(() =>
  app.runtime.data.value === null ? null : classifyRuntimeReadiness(app.runtime.data.value),
);
const fullError = computed(
  () =>
    health.error.value !== null &&
    app.runtime.error.value !== null &&
    health.data.value === null &&
    app.runtime.data.value === null,
);

function retryAll(): void {
  void health.load();
  void app.runtime.load();
}
</script>

<template>
  <div class="page-stack system-page">
    <header class="page-heading system-heading">
      <div>
        <p class="eyebrow">{{ t('nav.operations') }}</p>
        <h2>{{ t('nav.system') }}</h2>
        <p>{{ t('systemPage.subtitle') }}</p>
      </div>
      <RuntimeStatus :status="systemSummary" />
    </header>

    <PageError
      v-if="fullError"
      :title="t('systemPage.unavailableTitle')"
      :message="t('systemPage.unavailableMessage')"
      :retry-label="t('runs.tryAgain')"
      @retry="retryAll"
    />

    <template v-else>
      <div class="system-status-grid">
        <section
          class="card system-section"
          aria-labelledby="system-health-title"
          :aria-busy="health.loading.value"
        >
          <header class="card__header">
            <div>
              <p class="eyebrow">{{ t('systemPage.healthEyebrow') }}</p>
              <h3 id="system-health-title">{{ t('systemPage.healthTitle') }}</h3>
              <p>{{ t('systemPage.healthSubtitle') }}</p>
            </div>
            <StatusBadge v-if="health.data.value" :status="health.data.value.status" />
          </header>

          <div
            v-if="health.loading.value && health.data.value === null"
            class="system-section-loading"
          >
            <Skeleton height="18px" width="38%" :label="t('systemPage.loadingServer')" />
            <Skeleton height="74px" :label="t('systemPage.loadingHealth')" />
          </div>
          <div
            v-else-if="health.error.value && health.data.value === null"
            class="section-error-stack"
          >
            <InlineError :message="health.error.value.message" />
            <button
              class="button button--secondary button--compact"
              type="button"
              @click="health.load"
            >
              {{ t('common.retry') }}
            </button>
          </div>
          <template v-else-if="health.data.value">
            <BackgroundRefreshIndicator
              v-if="health.refreshing.value"
              :label="t('systemPage.refreshingHealth')"
            />
            <StaleDataNotice
              v-if="health.refreshError.value"
              :message="health.refreshError.value.message"
              @retry="health.load"
            />
            <dl class="system-definition-list">
              <div>
                <dt>{{ t('systemPage.server') }}</dt>
                <dd><StatusBadge :status="health.data.value.status" /></dd>
              </div>
              <div>
                <dt>{{ t('systemPage.database') }}</dt>
                <dd><StatusBadge :status="health.data.value.database.status" /></dd>
              </div>
              <div>
                <dt>{{ t('systemPage.migration') }}</dt>
                <dd><StatusBadge :status="health.data.value.migration.status" /></dd>
              </div>
              <div>
                <dt>{{ t('systemPage.version') }}</dt>
                <dd>{{ health.data.value.version }}</dd>
              </div>
              <div>
                <dt>{{ t('systemPage.reported') }}</dt>
                <dd>{{ formatTimestamp(health.data.value.timestamp) }}</dd>
              </div>
            </dl>
          </template>
        </section>

        <section
          class="card system-section"
          aria-labelledby="system-runtime-title"
          :aria-busy="app.runtime.loading.value"
        >
          <header class="card__header">
            <div>
              <p class="eyebrow">{{ t('systemPage.runtimeEyebrow') }}</p>
              <h3 id="system-runtime-title">{{ t('systemPage.runtimeTitle') }}</h3>
              <p>{{ t('systemPage.runtimeSubtitle') }}</p>
            </div>
            <StatusBadge v-if="runtimeReadiness" :status="runtimeReadiness" />
          </header>

          <div
            v-if="app.runtime.loading.value && app.runtime.data.value === null"
            class="system-section-loading"
          >
            <Skeleton height="18px" width="38%" :label="t('systemPage.loadingRuntimeStatus')" />
            <Skeleton height="120px" :label="t('systemPage.loadingRuntime')" />
          </div>
          <div
            v-else-if="app.runtime.error.value && app.runtime.data.value === null"
            class="section-error-stack"
          >
            <InlineError :message="app.runtime.error.value.message" />
            <button
              class="button button--secondary button--compact"
              type="button"
              @click="app.runtime.load"
            >
              {{ t('common.retry') }}
            </button>
          </div>
          <template v-else-if="app.runtime.data.value">
            <BackgroundRefreshIndicator
              v-if="app.runtime.refreshing.value"
              :label="t('systemPage.refreshingRuntime')"
            />
            <StaleDataNotice
              v-if="app.runtime.refreshError.value"
              :message="app.runtime.refreshError.value.message"
              @retry="app.runtime.load"
            />
            <dl class="system-definition-list">
              <div>
                <dt>{{ t('systemPage.database') }}</dt>
                <dd>
                  <StatusBadge
                    :status="app.runtime.data.value.databaseReady ? 'READY' : 'NOT_READY'"
                  />
                </dd>
              </div>
              <div>
                <dt>{{ t('systemPage.migration') }}</dt>
                <dd>
                  <StatusBadge
                    :status="app.runtime.data.value.migrationReady ? 'READY' : 'NOT_READY'"
                  />
                </dd>
              </div>
              <div>
                <dt>{{ t('systemPage.observability') }}</dt>
                <dd>
                  <StatusBadge
                    :status="app.runtime.data.value.observabilityReady ? 'READY' : 'NOT_READY'"
                  />
                </dd>
              </div>
              <div>
                <dt>{{ t('systemPage.browserProfile') }}</dt>
                <dd>
                  <StatusBadge
                    :status="
                      app.runtime.data.value.browserProfileConfigured ? 'READY' : 'NOT_READY'
                    "
                    :label="
                      app.runtime.data.value.browserProfileConfigured
                        ? t('notificationsPage.configured')
                        : t('notificationsPage.notConfigured')
                    "
                  />
                </dd>
              </div>
              <div>
                <dt>{{ t('systemPage.businessTimezone') }}</dt>
                <dd>{{ app.runtime.data.value.timezone }}</dd>
              </div>
              <div>
                <dt>{{ t('systemPage.version') }}</dt>
                <dd>{{ app.runtime.data.value.version }}</dd>
              </div>
              <div>
                <dt>{{ t('systemPage.reported') }}</dt>
                <dd>{{ formatTimestamp(app.runtime.data.value.timestamp) }}</dd>
              </div>
            </dl>
          </template>
        </section>
      </div>

      <section
        v-if="app.runtime.data.value?.realSendAuthorizationEnabled"
        class="system-critical-warning"
        role="status"
      >
        <div>
          <strong>{{ t('systemPage.criticalTitle') }}</strong>
          <span>{{ t('systemPage.criticalBody') }}</span>
        </div>
        <StatusBadge status="ENABLED" />
      </section>

      <section class="card system-section system-gates" aria-labelledby="system-gates-title">
        <header class="card__header">
          <div>
            <p class="eyebrow">{{ t('systemPage.gatesEyebrow') }}</p>
            <h3 id="system-gates-title">{{ t('systemPage.gatesTitle') }}</h3>
            <p>{{ t('systemPage.gatesSubtitle') }}</p>
          </div>
          <span class="read-only-chip">{{ t('systemPage.readOnly') }}</span>
        </header>

        <SectionLoading
          v-if="app.runtime.loading.value && app.runtime.data.value === null"
          :label="t('systemPage.loadingGates')"
        />
        <InlineError
          v-else-if="app.runtime.error.value && app.runtime.data.value === null"
          :message="app.runtime.error.value.message"
        />
        <dl v-else-if="app.runtime.data.value" class="system-gate-grid">
          <div>
            <dt>{{ t('systemPage.scheduler') }}</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.schedulerEnabled ? 'ENABLED' : 'DISABLED'"
              />
            </dd>
            <p>{{ t('systemPage.schedulerNote') }}</p>
          </div>
          <div :class="{ 'system-gate--warning': app.runtime.data.value.manualRunEnabled }">
            <dt>{{ t('systemPage.manualRun') }}</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.manualRunEnabled ? 'ENABLED' : 'DISABLED'"
              />
            </dd>
            <p>{{ t('systemPage.manualRunNote') }}</p>
          </div>
          <div
            :class="{ 'system-gate--warning': app.runtime.data.value.realSendAuthorizationEnabled }"
          >
            <dt>{{ t('systemPage.realSend') }}</dt>
            <dd>
              <StatusBadge
                :status="
                  app.runtime.data.value.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'
                "
              />
            </dd>
            <p>{{ t('systemPage.realSendNote') }}</p>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>
