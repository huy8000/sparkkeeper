<script setup lang="ts">
/* global Event, HTMLInputElement */
import { useTranslation } from '../../i18n';
import { manualRunBlockedReasonKey } from '../../manualRunLabels';
import type { ManualRunPreflight } from '../../types/api';
import RunStatusBadge from '../RunStatusBadge.vue';
import StatusBadge from '../StatusBadge.vue';

const props = defineProps<{
  preflight: ManualRunPreflight;
  accountName: string;
  templateName: string;
  acknowledged: boolean;
}>();
const emit = defineEmits<{ 'update:acknowledged': [value: boolean]; start: [] }>();

const { t } = useTranslation();

function updateAcknowledged(event: Event): void {
  emit('update:acknowledged', (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <section class="manual-preflight" aria-labelledby="manual-preflight-title">
    <header class="manual-preflight__header">
      <div>
        <p class="eyebrow">{{ t('manualRun.eyebrow') }}</p>
        <h3 id="manual-preflight-title">
          {{ props.preflight.canRun ? t('manualRun.readyTitle') : t('manualRun.blockedTitle') }}
        </h3>
      </div>
      <StatusBadge :status="props.preflight.canRun ? 'READY' : 'BLOCKED'" />
    </header>

    <dl class="manual-preflight-grid">
      <div>
        <dt>{{ t('common.account') }}</dt>
        <dd>{{ props.accountName }}</dd>
      </div>
      <div>
        <dt>{{ t('manualRun.template') }}</dt>
        <dd>{{ props.templateName }}</dd>
      </div>
      <div>
        <dt>{{ t('manualRun.enabledFriends') }}</dt>
        <dd>{{ props.preflight.enabledFriendCount }}</dd>
      </div>
      <div>
        <dt>{{ t('manualRun.schedule') }}</dt>
        <dd>
          {{
            props.preflight.scheduleConfigured
              ? t('manualRun.scheduleConfigured')
              : t('manualRun.scheduleNotConfiguredValue')
          }}
        </dd>
      </div>
      <div>
        <dt>{{ t('manualRun.businessDate') }}</dt>
        <dd>{{ props.preflight.businessDate ?? t('status.unavailable') }}</dd>
      </div>
      <div>
        <dt>{{ t('manualRun.todayRun') }}</dt>
        <dd>
          <RunStatusBadge
            v-if="props.preflight.currentDailyRunStatus"
            :status="props.preflight.currentDailyRunStatus"
          />
          <span v-else>{{ t('manualRun.notStarted') }}</span>
        </dd>
      </div>
      <div>
        <dt>{{ t('manualRun.gate') }}</dt>
        <dd>
          <StatusBadge :status="props.preflight.manualRunEnabled ? 'ENABLED' : 'DISABLED'" />
        </dd>
      </div>
      <div>
        <dt>{{ t('manualRun.realSendAuth') }}</dt>
        <dd>
          <StatusBadge
            :status="props.preflight.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'"
          />
        </dd>
      </div>
    </dl>

    <ul v-if="props.preflight.blockedReasons.length > 0" class="manual-blockers" role="alert">
      <li v-for="reason in props.preflight.blockedReasons" :key="reason">
        <strong>{{ t(manualRunBlockedReasonKey(reason)) }}</strong>
        <code>{{ reason }}</code>
      </li>
    </ul>

    <template v-if="props.preflight.canRun">
      <p class="manual-preflight__warning">
        {{ t('manualRun.realSendWarning', props.preflight.enabledFriendCount) }}
      </p>
      <label class="confirmation-row">
        <input :checked="props.acknowledged" type="checkbox" @change="updateAcknowledged" />
        <span>{{ t('manualRun.acknowledge') }}</span>
      </label>
      <button
        class="button button--danger"
        type="button"
        :disabled="!props.acknowledged"
        @click="$emit('start')"
      >
        {{ t('manualRun.reviewAndStart') }}
      </button>
    </template>
  </section>
</template>
