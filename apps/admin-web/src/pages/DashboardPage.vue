<script setup lang="ts">
import { watch } from 'vue';

import { useAdminApp } from '../appContext';
import ErrorState from '../components/ErrorState.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const health = useRequest((signal) => app.api.getHealth(signal));
watch(app.refreshVersion, () => void health.load());
</script>

<template>
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p class="eyebrow">System overview</p>
        <h2>Runtime at a glance</h2>
        <p>Read-only service health and safety-control state.</p>
      </div>
    </header>

    <div v-if="health.loading.value && !health.data.value" class="dashboard-grid">
      <LoadingState label="Loading service health…" />
      <LoadingState label="Loading runtime status…" />
    </div>
    <ErrorState
      v-else-if="health.error.value"
      :message="health.error.value.message"
      @retry="health.load"
    />
    <div v-else class="dashboard-grid">
      <section v-if="health.data.value" class="card" aria-labelledby="health-title">
        <div class="card__header">
          <div>
            <p class="eyebrow">Health</p>
            <h3 id="health-title">{{ health.data.value.serviceName }}</h3>
          </div>
          <StatusBadge :status="health.data.value.status" />
        </div>
        <dl class="definition-grid">
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
      </section>

      <LoadingState
        v-if="app.runtime.loading.value && !app.runtime.data.value"
        label="Loading runtime status…"
      />
      <ErrorState
        v-else-if="app.runtime.error.value"
        :message="app.runtime.error.value.message"
        @retry="app.runtime.load"
      />
      <section v-else-if="app.runtime.data.value" class="card" aria-labelledby="runtime-title">
        <div class="card__header">
          <div>
            <p class="eyebrow">Runtime</p>
            <h3 id="runtime-title">Safety controls</h3>
          </div>
          <StatusBadge :status="app.runtime.data.value.serverStatus" />
        </div>
        <div
          v-if="app.runtime.data.value.realSendAuthorizationEnabled"
          class="risk-banner"
          role="alert"
        >
          <strong>Real send authorization enabled</strong>
          <span>This dashboard cannot change authorization or execute a run.</span>
        </div>
        <dl class="definition-grid">
          <div>
            <dt>Runtime scheduler</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.schedulerEnabled ? 'ENABLED' : 'DISABLED'"
              />
            </dd>
          </div>
          <div>
            <dt>Real send authorization</dt>
            <dd>
              <StatusBadge
                :status="
                  app.runtime.data.value.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'
                "
              />
            </dd>
          </div>
          <div>
            <dt>Manual Run</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.manualRunEnabled ? 'ENABLED' : 'DISABLED'"
              />
            </dd>
          </div>
          <div>
            <dt>Database ready</dt>
            <dd>
              <StatusBadge :status="app.runtime.data.value.databaseReady ? 'READY' : 'NOT_READY'" />
            </dd>
          </div>
          <div>
            <dt>Migration ready</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.migrationReady ? 'READY' : 'NOT_READY'"
              />
            </dd>
          </div>
          <div>
            <dt>Observability ready</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.observabilityReady ? 'READY' : 'NOT_READY'"
              />
            </dd>
          </div>
          <div>
            <dt>Browser profile configured</dt>
            <dd>{{ app.runtime.data.value.browserProfileConfigured ? 'Yes' : 'No' }}</dd>
          </div>
          <div>
            <dt>Business timezone</dt>
            <dd>{{ app.runtime.data.value.timezone }}</dd>
          </div>
          <div>
            <dt>Reported</dt>
            <dd>{{ formatTimestamp(app.runtime.data.value.timestamp) }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>
