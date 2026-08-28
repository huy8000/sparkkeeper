<script setup lang="ts">
import { useTranslation } from '../../i18n';
import type { SendRecord } from '../../types/api';
import { formatTimestamp } from '../../utils/format';
import InlineError from '../InlineError.vue';
import RunStatusBadge from '../RunStatusBadge.vue';
import SectionLoading from '../SectionLoading.vue';
import BackgroundRefreshIndicator from '../BackgroundRefreshIndicator.vue';
import StaleDataNotice from '../StaleDataNotice.vue';

defineProps<{
  records: readonly SendRecord[] | null;
  loading: boolean;
  errorMessage: string | null;
  friendName: (friendId: string) => string;
}>();

defineEmits<{ retry: [] }>();

const { t } = useTranslation();
</script>

<template>
  <SectionLoading v-if="loading && records === null" :label="t('deliveryList.loading')" />
  <InlineError v-else-if="errorMessage && records === null" :message="errorMessage" />
  <template v-else>
    <BackgroundRefreshIndicator v-if="loading" :label="t('deliveryList.refreshing')" />
    <StaleDataNotice v-if="errorMessage" :message="errorMessage" @retry="$emit('retry')" />
    <div v-if="records !== null && records.length === 0" class="run-section-empty">
      <p>{{ t('deliveryList.emptyTitle') }}</p>
      <p class="run-section-empty__hint">
        {{ t('deliveryList.emptyHint') }}
      </p>
    </div>
    <div v-else-if="records !== null" class="table-wrap">
      <table>
        <caption class="visually-hidden">
          {{
            t('deliveryList.caption')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('deliveryList.contact') }}</th>
            <th scope="col">{{ t('common.status') }}</th>
            <th scope="col">{{ t('deliveryList.attempts') }}</th>
            <th scope="col">{{ t('deliveryList.failureCode') }}</th>
            <th scope="col">{{ t('runs.started') }}</th>
            <th scope="col">{{ t('runs.finished') }}</th>
            <th scope="col">{{ t('deliveryList.sent') }}</th>
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
                {{ t('runHero.uncertainNoRetry') }}
              </p>
              <p v-if="record.status === 'RETRY_WAIT'" class="delivery-retry-note">
                {{ t('deliveryList.retryWait', record.attempts) }}
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
</template>
