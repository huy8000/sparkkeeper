<script setup lang="ts">
import { computed, watch } from 'vue';

import { useAdminApp } from '../appContext';
import InlineError from '../components/InlineError.vue';
import PageError from '../components/PageError.vue';
import RuntimeStatus from '../components/RuntimeStatus.vue';
import SectionLoading from '../components/SectionLoading.vue';
import Skeleton from '../components/Skeleton.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';
import { classifyRuntimeReadiness, classifySystemSummary } from '../operations/runtimeReadiness';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
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
        <p class="eyebrow">Operations</p>
        <h2>System</h2>
        <p>Runtime health and safety status.</p>
      </div>
      <RuntimeStatus :status="systemSummary" />
    </header>

    <PageError
      v-if="fullError"
      title="System status unavailable"
      message="Health and runtime status could not be loaded."
      retry-label="Try loading again"
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
              <p class="eyebrow">Health</p>
              <h3 id="system-health-title">SparkKeeper Server</h3>
              <p>Service response and foundational persistence checks.</p>
            </div>
            <StatusBadge v-if="health.data.value" :status="health.data.value.status" />
          </header>

          <div
            v-if="health.loading.value && health.data.value === null"
            class="system-section-loading"
          >
            <Skeleton height="18px" width="38%" label="Loading server status…" />
            <Skeleton height="74px" label="Loading health checks…" />
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
              Retry
            </button>
          </div>
          <template v-else-if="health.data.value">
            <InlineError v-if="health.error.value" :message="health.error.value.message" />
            <dl class="system-definition-list">
              <div>
                <dt>Server</dt>
                <dd><StatusBadge :status="health.data.value.status" /></dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd><StatusBadge :status="health.data.value.database.status" /></dd>
              </div>
              <div>
                <dt>Migration</dt>
                <dd><StatusBadge :status="health.data.value.migration.status" /></dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{{ health.data.value.version }}</dd>
              </div>
              <div>
                <dt>Reported</dt>
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
              <p class="eyebrow">Runtime status</p>
              <h3 id="system-runtime-title">Runtime dependencies</h3>
              <p>Readiness reported by the current runtime snapshot.</p>
            </div>
            <StatusBadge v-if="runtimeReadiness" :status="runtimeReadiness" />
          </header>

          <div
            v-if="app.runtime.loading.value && app.runtime.data.value === null"
            class="system-section-loading"
          >
            <Skeleton height="18px" width="38%" label="Loading runtime status…" />
            <Skeleton height="120px" label="Loading runtime dependencies…" />
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
              Retry
            </button>
          </div>
          <template v-else-if="app.runtime.data.value">
            <InlineError
              v-if="app.runtime.error.value"
              :message="app.runtime.error.value.message"
            />
            <dl class="system-definition-list">
              <div>
                <dt>Database</dt>
                <dd>
                  <StatusBadge
                    :status="app.runtime.data.value.databaseReady ? 'READY' : 'NOT_READY'"
                  />
                </dd>
              </div>
              <div>
                <dt>Migration</dt>
                <dd>
                  <StatusBadge
                    :status="app.runtime.data.value.migrationReady ? 'READY' : 'NOT_READY'"
                  />
                </dd>
              </div>
              <div>
                <dt>Observability</dt>
                <dd>
                  <StatusBadge
                    :status="app.runtime.data.value.observabilityReady ? 'READY' : 'NOT_READY'"
                  />
                </dd>
              </div>
              <div>
                <dt>Browser profile</dt>
                <dd>
                  <StatusBadge
                    :status="
                      app.runtime.data.value.browserProfileConfigured ? 'READY' : 'NOT_READY'
                    "
                    :label="
                      app.runtime.data.value.browserProfileConfigured
                        ? 'Configured'
                        : 'Not configured'
                    "
                  />
                </dd>
              </div>
              <div>
                <dt>Business timezone</dt>
                <dd>{{ app.runtime.data.value.timezone }}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{{ app.runtime.data.value.version }}</dd>
              </div>
              <div>
                <dt>Reported</dt>
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
          <strong>Real message delivery is authorized.</strong>
          <span>This operator-controlled runtime gate is enabled outside Admin.</span>
        </div>
        <StatusBadge status="ENABLED" />
      </section>

      <section class="card system-section system-gates" aria-labelledby="system-gates-title">
        <header class="card__header">
          <div>
            <p class="eyebrow">Safety gates</p>
            <h3 id="system-gates-title">Runtime authorization</h3>
            <p>Configured outside Admin. These values are observation-only.</p>
          </div>
          <span class="read-only-chip">Read only</span>
        </header>

        <SectionLoading
          v-if="app.runtime.loading.value && app.runtime.data.value === null"
          label="Loading safety gates…"
        />
        <InlineError
          v-else-if="app.runtime.error.value && app.runtime.data.value === null"
          :message="app.runtime.error.value.message"
        />
        <dl v-else-if="app.runtime.data.value" class="system-gate-grid">
          <div>
            <dt>Scheduler</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.schedulerEnabled ? 'ENABLED' : 'DISABLED'"
              />
            </dd>
            <p>Operator-controlled. Enabled does not mean a send is currently running.</p>
          </div>
          <div :class="{ 'system-gate--warning': app.runtime.data.value.manualRunEnabled }">
            <dt>Manual Run</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.manualRunEnabled ? 'ENABLED' : 'DISABLED'"
              />
            </dd>
            <p>Configured outside Admin. Runs are initiated only from Account Workspace.</p>
          </div>
          <div
            :class="{ 'system-gate--warning': app.runtime.data.value.realSendAuthorizationEnabled }"
          >
            <dt>Real Send Authorization</dt>
            <dd>
              <StatusBadge
                :status="
                  app.runtime.data.value.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'
                "
              />
            </dd>
            <p>Operator-controlled. No send or test action is available on this page.</p>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>
