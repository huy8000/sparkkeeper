<script setup lang="ts">
import { watch } from 'vue';
import { useRoute } from 'vue-router';

import { useAdminApp } from '../appContext';
import { invalidatesRunDetail } from '../api/realtimeInvalidation';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import IdentifierValue from '../components/IdentifierValue.vue';
import LoadingState from '../components/LoadingState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRequest } from '../composables/useRequest';
import { useRealtimeRefresh } from '../composables/useRealtimeRefresh';
import { formatTimestamp } from '../utils/format';

const app = useAdminApp();
const route = useRoute();
const runId = String(route.params.runId);
const detail = useRequest(async (signal) => {
  const run = await app.api.getRun(runId, signal);
  const [account, sendRecords, events] = await Promise.all([
    app.api.getAccount(run.accountId, signal),
    app.api.listSendRecords(runId, signal),
    app.api.listSystemEvents(runId, signal),
  ]);
  return { run, account, sendRecords, events };
});
watch(app.refreshVersion, () => void detail.load());
useRealtimeRefresh(
  app.realtime,
  (event) => invalidatesRunDetail(event, runId),
  () => void detail.load(),
);
</script>

<template>
  <div class="page-stack">
    <p v-if="route.query.accepted === 'manual-run'" class="success-message" role="status">
      Manual Run request accepted. The final outcome appears below.
    </p>
    <header class="page-heading">
      <div>
        <p class="eyebrow">Run detail</p>
        <h2>{{ detail.data.value?.run.businessDate ?? 'Daily run' }}</h2>
        <p>Safe execution metadata, delivery outcomes, and system events.</p>
      </div>
      <button class="button button--secondary" type="button" @click="detail.load">Refresh</button>
    </header>
    <LoadingState v-if="detail.loading.value && !detail.data.value" label="Loading run detail…" />
    <ErrorState
      v-else-if="detail.error.value"
      :title="detail.error.value.httpStatus === 404 ? 'Run not found' : 'Unable to load run'"
      :message="
        detail.error.value.httpStatus === 404
          ? 'This run is not available.'
          : detail.error.value.message
      "
      @retry="detail.load"
    />
    <template v-else-if="detail.data.value">
      <section class="card" aria-labelledby="run-summary-title">
        <div class="card__header">
          <div>
            <p class="eyebrow">Run summary</p>
            <h3 id="run-summary-title">{{ detail.data.value.account.name }}</h3>
          </div>
          <StatusBadge :status="detail.data.value.run.status" />
        </div>
        <dl class="definition-grid">
          <div>
            <dt>Business date</dt>
            <dd>{{ detail.data.value.run.businessDate }}</dd>
          </div>
          <div>
            <dt>Run identifier</dt>
            <dd><IdentifierValue :value="detail.data.value.run.id" /></dd>
          </div>
          <div>
            <dt>Started</dt>
            <dd>{{ formatTimestamp(detail.data.value.run.startedAt) }}</dd>
          </div>
          <div>
            <dt>Finished</dt>
            <dd>{{ formatTimestamp(detail.data.value.run.finishedAt) }}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{{ formatTimestamp(detail.data.value.run.createdAt) }}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{{ formatTimestamp(detail.data.value.run.updatedAt) }}</dd>
          </div>
        </dl>
      </section>

      <section class="section-stack" aria-labelledby="send-records-title">
        <header class="section-heading">
          <div>
            <p class="eyebrow">Delivery metadata</p>
            <h3 id="send-records-title">Send records</h3>
          </div>
          <span class="count">{{ detail.data.value.sendRecords.length }}</span>
        </header>
        <EmptyState
          v-if="detail.data.value.sendRecords.length === 0"
          title="No send records"
          description="This run has no delivery records."
        />
        <div v-else class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Friend ID</th>
                <th>Business date</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Failure code</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in detail.data.value.sendRecords" :key="record.id">
                <td><IdentifierValue :value="record.friendId" compact /></td>
                <td>{{ record.businessDate }}</td>
                <td><StatusBadge :status="record.status" /></td>
                <td>{{ record.attempts }}</td>
                <td>{{ record.failureCode ?? '—' }}</td>
                <td>{{ formatTimestamp(record.finishedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="section-stack" aria-labelledby="events-title">
        <header class="section-heading">
          <div>
            <p class="eyebrow">Observability</p>
            <h3 id="events-title">System events</h3>
          </div>
          <span class="count">{{ detail.data.value.events.length }}</span>
        </header>
        <EmptyState
          v-if="detail.data.value.events.length === 0"
          title="No system events"
          description="This run has no recorded events."
        />
        <ol v-else class="timeline">
          <li
            v-for="(event, index) in detail.data.value.events"
            :key="`${event.createdAt}-${index}`"
            class="timeline__item"
          >
            <div class="timeline__marker" aria-hidden="true" />
            <div class="timeline__content">
              <div class="timeline__header">
                <div>
                  <time :datetime="event.createdAt">{{ formatTimestamp(event.createdAt) }}</time>
                  <h4>{{ event.eventType.replaceAll('_', ' ') }}</h4>
                </div>
                <StatusBadge :status="event.level" />
              </div>
              <p>{{ event.message }}</p>
              <dl class="event-meta">
                <div v-if="event.friendId">
                  <dt>Friend ID</dt>
                  <dd>{{ event.friendId }}</dd>
                </div>
                <div v-if="event.attempt !== null">
                  <dt>Attempt</dt>
                  <dd>{{ event.attempt }}</dd>
                </div>
                <div v-if="event.errorCode">
                  <dt>Error code</dt>
                  <dd>{{ event.errorCode }}</dd>
                </div>
              </dl>
              <div
                v-if="event.screenshotEvidenceAvailable || event.traceEvidenceAvailable"
                class="evidence-list"
                aria-label="Evidence availability"
              >
                <span v-if="event.screenshotEvidenceAvailable">Screenshot available</span
                ><span v-if="event.traceEvidenceAvailable">Trace available</span>
              </div>
            </div>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>
