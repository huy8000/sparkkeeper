<script setup lang="ts">
/* global Event, HTMLInputElement */
import { manualRunBlockedReasonLabel } from '../../manualRunLabels';
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

function updateAcknowledged(event: Event): void {
  emit('update:acknowledged', (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <section class="manual-preflight" aria-labelledby="manual-preflight-title">
    <header class="manual-preflight__header">
      <div>
        <p class="eyebrow">Server preflight</p>
        <h3 id="manual-preflight-title">
          {{ props.preflight.canRun ? 'Ready to run' : 'Manual Run blocked' }}
        </h3>
      </div>
      <StatusBadge
        :status="props.preflight.canRun ? 'READY' : 'BLOCKED'"
        :label="props.preflight.canRun ? 'Ready' : 'Blocked'"
      />
    </header>

    <dl class="manual-preflight-grid">
      <div>
        <dt>Account</dt>
        <dd>{{ props.accountName }}</dd>
      </div>
      <div>
        <dt>Template</dt>
        <dd>{{ props.templateName }}</dd>
      </div>
      <div>
        <dt>Enabled friends</dt>
        <dd>{{ props.preflight.enabledFriendCount }}</dd>
      </div>
      <div>
        <dt>Schedule</dt>
        <dd>{{ props.preflight.scheduleConfigured ? 'Configured' : 'Not configured' }}</dd>
      </div>
      <div>
        <dt>BusinessDate</dt>
        <dd>{{ props.preflight.businessDate ?? 'Unavailable' }}</dd>
      </div>
      <div>
        <dt>Today’s run</dt>
        <dd>
          <RunStatusBadge
            v-if="props.preflight.currentDailyRunStatus"
            :status="props.preflight.currentDailyRunStatus"
          />
          <span v-else>Not started</span>
        </dd>
      </div>
      <div>
        <dt>Manual Run gate</dt>
        <dd>
          <StatusBadge :status="props.preflight.manualRunEnabled ? 'ENABLED' : 'DISABLED'" />
        </dd>
      </div>
      <div>
        <dt>Real send authorization</dt>
        <dd>
          <StatusBadge
            :status="props.preflight.realSendAuthorizationEnabled ? 'ENABLED' : 'DISABLED'"
          />
        </dd>
      </div>
    </dl>

    <ul v-if="props.preflight.blockedReasons.length > 0" class="manual-blockers" role="alert">
      <li v-for="reason in props.preflight.blockedReasons" :key="reason">
        <strong>{{ manualRunBlockedReasonLabel(reason) }}</strong>
        <code>{{ reason }}</code>
      </li>
    </ul>

    <template v-if="props.preflight.canRun">
      <p class="manual-preflight__warning">
        This run may send real messages to {{ props.preflight.enabledFriendCount }} enabled
        {{ props.preflight.enabledFriendCount === 1 ? 'friend' : 'friends' }}.
      </p>
      <label class="confirmation-row">
        <input :checked="props.acknowledged" type="checkbox" @change="updateAcknowledged" />
        <span>I understand this action may send real messages.</span>
      </label>
      <button
        class="button button--danger"
        type="button"
        :disabled="!props.acknowledged"
        @click="$emit('start')"
      >
        Review and start
      </button>
    </template>
  </section>
</template>
