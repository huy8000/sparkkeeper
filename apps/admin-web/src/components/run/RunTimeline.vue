<script setup lang="ts">
import { useTranslation } from '../../i18n';
import { isKnownRuntimeEvent, runtimeEventKey } from '../../runs/runtimeEventLabels';
import type { SystemEvent, SystemEventLevel } from '../../types/api';
import { formatTimestamp } from '../../utils/format';
import InlineError from '../InlineError.vue';
import SectionLoading from '../SectionLoading.vue';
import BackgroundRefreshIndicator from '../BackgroundRefreshIndicator.vue';
import StaleDataNotice from '../StaleDataNotice.vue';

defineProps<{
  events: readonly SystemEvent[] | null;
  loading: boolean;
  errorMessage: string | null;
  friendName: (friendId: string) => string;
}>();

defineEmits<{ retry: [] }>();

const { t } = useTranslation();

const LEVEL_KEY: Record<SystemEventLevel, string> = {
  INFO: 'status.info',
  WARN: 'status.warning',
  ERROR: 'status.error',
};

const LEVEL_GLYPH: Record<SystemEventLevel, string> = {
  INFO: 'ℹ',
  WARN: '⚠',
  ERROR: '✕',
};
</script>

<template>
  <SectionLoading v-if="loading && events === null" :label="t('run.timeline.loading')" />
  <InlineError v-else-if="errorMessage && events === null" :message="errorMessage" />
  <template v-else>
    <BackgroundRefreshIndicator v-if="loading" :label="t('run.timeline.refreshing')" />
    <StaleDataNotice v-if="errorMessage" :message="errorMessage" @retry="$emit('retry')" />
    <div v-if="events !== null && events.length === 0" class="run-section-empty">
      <p>{{ t('run.timeline.empty') }}</p>
    </div>
    <ol v-else-if="events !== null" class="timeline" :aria-label="t('run.timeline.ariaLabel')">
      <li
        v-for="(event, index) in events"
        :key="`${event.createdAt}-${index}`"
        class="timeline__item"
      >
        <span
          class="timeline__marker timeline__marker--level"
          :class="`timeline__marker--${event.level.toLowerCase()}`"
          aria-hidden="true"
        >
          {{ LEVEL_GLYPH[event.level] ?? '•' }}
        </span>
        <div class="timeline__content">
          <div class="timeline__header">
            <div>
              <time :datetime="event.createdAt">{{ formatTimestamp(event.createdAt) }}</time>
              <h4>
                {{ t(runtimeEventKey(event.eventType)) }}
                <code v-if="!isKnownRuntimeEvent(event.eventType)" class="timeline__raw">{{
                  event.eventType
                }}</code>
              </h4>
            </div>
            <span class="event-level" :class="`event-level--${event.level.toLowerCase()}`">
              <span aria-hidden="true">{{ LEVEL_GLYPH[event.level] ?? '•' }}</span>
              {{ LEVEL_KEY[event.level] !== undefined ? t(LEVEL_KEY[event.level]) : event.level }}
            </span>
          </div>
          <p>{{ event.message }}</p>
          <dl class="event-meta">
            <div v-if="event.friendId">
              <dt>{{ t('run.timeline.contact') }}</dt>
              <dd>{{ friendName(event.friendId) }}</dd>
            </div>
            <div v-if="event.attempt !== null">
              <dt>{{ t('run.timeline.attempt') }}</dt>
              <dd>{{ event.attempt }}</dd>
            </div>
            <div v-if="event.errorCode">
              <dt>{{ t('run.timeline.errorCode') }}</dt>
              <dd>{{ event.errorCode }}</dd>
            </div>
          </dl>
          <!-- Evidence availability only: no Evidence API exists, so never View/Open/Download. -->
          <ul
            v-if="event.screenshotEvidenceAvailable || event.traceEvidenceAvailable"
            class="evidence-list"
            :aria-label="t('run.timeline.evidenceAria')"
          >
            <li v-if="event.screenshotEvidenceAvailable">
              {{ t('run.timeline.screenshotCaptured') }}
            </li>
            <li v-if="event.traceEvidenceAvailable">{{ t('run.timeline.traceCaptured') }}</li>
          </ul>
        </div>
      </li>
    </ol>
  </template>
</template>
