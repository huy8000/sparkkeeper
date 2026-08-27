<script setup lang="ts">
import { isKnownRuntimeEvent, runtimeEventLabel } from '../../runs/runtimeEventLabels';
import type { SystemEvent, SystemEventLevel } from '../../types/api';
import { formatTimestamp } from '../../utils/format';
import InlineError from '../InlineError.vue';
import SectionLoading from '../SectionLoading.vue';

defineProps<{
  events: readonly SystemEvent[] | null;
  loading: boolean;
  errorMessage: string | null;
  friendName: (friendId: string) => string;
}>();

const LEVEL_TEXT: Record<SystemEventLevel, string> = {
  INFO: 'Info',
  WARN: 'Warning',
  ERROR: 'Error',
};

const LEVEL_GLYPH: Record<SystemEventLevel, string> = {
  INFO: 'ℹ',
  WARN: '⚠',
  ERROR: '✕',
};
</script>

<template>
  <SectionLoading v-if="loading && events === null" label="Loading timeline…" />
  <InlineError v-else-if="errorMessage" :message="errorMessage" />
  <div v-else-if="events !== null && events.length === 0" class="run-section-empty">
    <p>No persisted events for this run.</p>
  </div>
  <ol v-else-if="events !== null" class="timeline" aria-label="Run timeline">
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
              {{ runtimeEventLabel(event.eventType) }}
              <code v-if="!isKnownRuntimeEvent(event.eventType)" class="timeline__raw">{{
                event.eventType
              }}</code>
            </h4>
          </div>
          <span class="event-level" :class="`event-level--${event.level.toLowerCase()}`">
            <span aria-hidden="true">{{ LEVEL_GLYPH[event.level] ?? '•' }}</span>
            {{ LEVEL_TEXT[event.level] ?? event.level }}
          </span>
        </div>
        <p>{{ event.message }}</p>
        <dl class="event-meta">
          <div v-if="event.friendId">
            <dt>Contact</dt>
            <dd>{{ friendName(event.friendId) }}</dd>
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
        <!-- Evidence availability only: no Evidence API exists, so never View/Open/Download. -->
        <ul
          v-if="event.screenshotEvidenceAvailable || event.traceEvidenceAvailable"
          class="evidence-list"
          aria-label="Evidence available on server"
        >
          <li v-if="event.screenshotEvidenceAvailable">Screenshot captured</li>
          <li v-if="event.traceEvidenceAvailable">Trace captured</li>
        </ul>
      </div>
    </li>
  </ol>
</template>
