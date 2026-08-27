<script setup lang="ts">
import type { DailyRun, SendRecord } from '../../types/api';
import { formatTimestamp } from '../../utils/format';

defineProps<{
  run: DailyRun;
  sendRecords: readonly SendRecord[] | null;
}>();
</script>

<template>
  <!-- Collapsed by default: diagnostic identifiers stay out of the primary UI. -->
  <details class="technical-details">
    <summary>Technical details</summary>
    <dl class="definition-grid">
      <div>
        <dt>Run ID</dt>
        <dd>
          <code>{{ run.id }}</code>
        </dd>
      </div>
      <div>
        <dt>Account ID</dt>
        <dd>
          <code>{{ run.accountId }}</code>
        </dd>
      </div>
      <div>
        <dt>Raw status</dt>
        <dd>
          <code>{{ run.status }}</code>
        </dd>
      </div>
      <div>
        <dt>Created at</dt>
        <dd>{{ formatTimestamp(run.createdAt) }}</dd>
      </div>
      <div>
        <dt>Updated at</dt>
        <dd>{{ formatTimestamp(run.updatedAt) }}</dd>
      </div>
      <div v-for="record in sendRecords ?? []" :key="record.id">
        <dt>Send record {{ record.friendId }}</dt>
        <dd>
          <code>{{ record.id }}</code>
          <small v-if="record.status === 'DELIVERY_UNKNOWN'">Send status: DELIVERY_UNKNOWN</small>
        </dd>
      </div>
    </dl>
  </details>
</template>
