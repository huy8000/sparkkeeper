<script setup lang="ts">
import { useTranslation } from '../../i18n';
import type { DailyRun, SendRecord } from '../../types/api';
import { formatTimestamp } from '../../utils/format';

defineProps<{
  run: DailyRun;
  sendRecords: readonly SendRecord[] | null;
}>();

const { t } = useTranslation();
</script>

<template>
  <!-- Collapsed by default: diagnostic identifiers stay out of the primary UI. -->
  <details class="technical-details">
    <summary>{{ t('technicalDetails.summary') }}</summary>
    <dl class="definition-grid">
      <div>
        <dt>{{ t('technicalDetails.runId') }}</dt>
        <dd>
          <code>{{ run.id }}</code>
        </dd>
      </div>
      <div>
        <dt>{{ t('technicalDetails.accountId') }}</dt>
        <dd>
          <code>{{ run.accountId }}</code>
        </dd>
      </div>
      <div>
        <dt>{{ t('technicalDetails.rawStatus') }}</dt>
        <dd>
          <code>{{ run.status }}</code>
        </dd>
      </div>
      <div>
        <dt>{{ t('technicalDetails.createdAt') }}</dt>
        <dd>{{ formatTimestamp(run.createdAt) }}</dd>
      </div>
      <div>
        <dt>{{ t('technicalDetails.updatedAt') }}</dt>
        <dd>{{ formatTimestamp(run.updatedAt) }}</dd>
      </div>
      <div v-for="record in sendRecords ?? []" :key="record.id">
        <dt>{{ t('technicalDetails.sendRecord', { friendId: record.friendId }) }}</dt>
        <dd>
          <code>{{ record.id }}</code>
          <small v-if="record.status === 'DELIVERY_UNKNOWN'">{{
            t('technicalDetails.sendStatus')
          }}</small>
        </dd>
      </div>
    </dl>
  </details>
</template>
