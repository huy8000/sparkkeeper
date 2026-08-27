<script setup lang="ts">
import type { SendRecord } from '../../types/api';
import { formatTimestamp } from '../../utils/format';
import InlineError from '../InlineError.vue';
import RunStatusBadge from '../RunStatusBadge.vue';
import SectionLoading from '../SectionLoading.vue';

defineProps<{
  records: readonly SendRecord[] | null;
  loading: boolean;
  errorMessage: string | null;
  friendName: (friendId: string) => string;
}>();
</script>

<template>
  <SectionLoading v-if="loading && records === null" label="Loading delivery records…" />
  <InlineError v-else-if="errorMessage" :message="errorMessage" />
  <div v-else-if="records !== null && records.length === 0" class="run-section-empty">
    <p>No delivery records were created.</p>
    <p class="run-section-empty__hint">
      The run may have stopped before any delivery was attempted.
    </p>
  </div>
  <div v-else-if="records !== null" class="table-wrap">
    <table>
      <caption class="visually-hidden">
        Send records for this run
      </caption>
      <thead>
        <tr>
          <th scope="col">Contact</th>
          <th scope="col">Status</th>
          <th scope="col">Attempts</th>
          <th scope="col">Failure code</th>
          <th scope="col">Started</th>
          <th scope="col">Finished</th>
          <th scope="col">Sent</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="record in records"
          :key="record.id"
          :class="record.status === 'DELIVERY_UNKNOWN' ? 'delivery-row--uncertain' : undefined"
        >
          <td>
            <span class="delivery-contact">{{ friendName(record.friendId) }}</span>
          </td>
          <td>
            <RunStatusBadge :status="record.status" />
            <p v-if="record.status === 'DELIVERY_UNKNOWN'" class="delivery-uncertain-note">
              Do not retry automatically.
            </p>
            <p v-if="record.status === 'RETRY_WAIT'" class="delivery-retry-note">
              Waiting to retry after {{ record.attempts }} attempt{{
                record.attempts === 1 ? '' : 's'
              }}.
            </p>
          </td>
          <td>{{ record.attempts }}</td>
          <td>{{ record.failureCode ?? '—' }}</td>
          <td>{{ formatTimestamp(record.startedAt) }}</td>
          <td>{{ formatTimestamp(record.finishedAt) }}</td>
          <td>{{ formatTimestamp(record.sentAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
