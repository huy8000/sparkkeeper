<script setup lang="ts">
import { watch } from 'vue';

import { useAdminApp } from '../appContext';
import PageError from '../components/PageError.vue';
import PageLoading from '../components/PageLoading.vue';
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
        <p class="eyebrow">Operations</p>
        <h2>System status</h2>
        <p>Runtime environment, browser profile readiness and safety gates — read-only.</p>
      </div>
    </header>

    <template v-if="health.loading.value && !health.data.value && !health.error.value">
      <PageLoading label="Checking system…" />
    </template>
    <PageError
      v-else-if="health.error.value"
      title="System status unavailable"
      :message="health.error.value.message"
      @retry="health.load"
    />
    <template v-else>
      <div class="dashboard-grid">
        <section v-if="health.data.value" class="card" aria-labelledby="system-health-title">
          <div class="card__header">
            <div>
              <p class="eyebrow">Health</p>
              <h3 id="system-health-title">Runtime environment</h3>
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

        <section v-if="app.runtime.data.value" class="card" aria-labelledby="system-runtime-title">
          <div class="card__header">
            <div>
              <p class="eyebrow">Runtime</p>
              <h3 id="system-runtime-title">Runtime dependencies</h3>
            </div>
            <StatusBadge :status="app.runtime.data.value.serverStatus" />
          </div>
          <dl class="definition-grid">
            <div>
              <dt>Database ready</dt>
              <dd>
                <StatusBadge
                  :status="app.runtime.data.value.databaseReady ? 'READY' : 'NOT_READY'"
                />
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
              <dt>Browser profile</dt>
              <dd>
                <StatusBadge
                  :status="app.runtime.data.value.browserProfileConfigured ? 'READY' : 'UNKNOWN'"
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
              <dt>Reported</dt>
              <dd>{{ formatTimestamp(app.runtime.data.value.timestamp) }}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section class="card" aria-labelledby="system-gates-title">
        <div class="card__header">
          <div>
            <p class="eyebrow">Safety</p>
            <h3 id="system-gates-title">Runtime safety gates</h3>
          </div>
        </div>
        <p class="form-note">
          These switches are configured by the server operator through environment variables. The
          Admin UI presents them read-only; no toggle is available here.
        </p>
        <dl v-if="app.runtime.data.value" class="definition-grid">
          <div>
            <dt>Scheduler</dt>
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
            <dt>Manual run</dt>
            <dd>
              <StatusBadge
                :status="app.runtime.data.value.manualRunEnabled ? 'ENABLED' : 'DISABLED'"
              />
            </dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>
