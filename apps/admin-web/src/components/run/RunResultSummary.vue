<script setup lang="ts">
import type { RunDetailState } from '../../runs/deriveRunDetailState';

defineProps<{
  state: RunDetailState;
  accountId: string;
  durationLabel: string;
  successfulDeliveryCount: number;
  failureCodes: readonly string[];
  failureSummary: string | null;
}>();
</script>

<template>
  <!-- Primary product conclusion for the run; never a raw enum. -->
  <section
    v-if="state === 'SUCCESS'"
    class="run-hero run-hero--success"
    aria-labelledby="run-hero-title"
  >
    <span class="run-hero__mark" aria-hidden="true">✓</span>
    <div class="run-hero__body">
      <h3 id="run-hero-title">Verified Success</h3>
      <p>This run has completed.</p>
      <p v-if="successfulDeliveryCount > 0">
        Delivery results were verified by new outgoing message bubbles.
      </p>
      <p class="run-hero__stats">
        <span
          >{{ successfulDeliveryCount }}
          {{
            successfulDeliveryCount === 1 ? 'successful delivery' : 'successful deliveries'
          }}</span
        >
        <span aria-hidden="true">·</span>
        <span>{{ durationLabel }} duration</span>
      </p>
    </div>
    <ol class="verification-chain" aria-label="How success is verified">
      <li>Resolve contact</li>
      <li>Send once</li>
      <li>Observe new outgoing bubble</li>
      <li>Persist SUCCESS</li>
    </ol>
  </section>

  <section
    v-else-if="state === 'DELIVERY_UNKNOWN'"
    class="run-hero run-hero--uncertain"
    role="alert"
    aria-labelledby="run-hero-title"
  >
    <span class="run-hero__mark" aria-hidden="true">?</span>
    <div class="run-hero__body">
      <h3 id="run-hero-title">Delivery uncertain</h3>
      <p>A send action occurred, but SparkKeeper could not verify a new outgoing message.</p>
      <p><strong>The message may already have been delivered.</strong></p>
      <p>Do not retry automatically.</p>
    </div>
  </section>

  <section
    v-else-if="state === 'AUTH_EXPIRED'"
    class="run-hero run-hero--danger"
    aria-labelledby="run-hero-title"
  >
    <span class="run-hero__mark" aria-hidden="true">!</span>
    <div class="run-hero__body">
      <h3 id="run-hero-title">Login expired</h3>
      <p>Authentication verification stopped the run.</p>
      <p>This is the run status at the time it executed; the account may have recovered since.</p>
    </div>
    <RouterLink class="button button--secondary" :to="`/accounts/${accountId}/overview`">
      View account
    </RouterLink>
  </section>

  <section
    v-else-if="state === 'FAILED'"
    class="run-hero run-hero--danger"
    aria-labelledby="run-hero-title"
  >
    <span class="run-hero__mark" aria-hidden="true">!</span>
    <div class="run-hero__body">
      <h3 id="run-hero-title">Run failed</h3>
      <p v-if="failureCodes.length > 0">
        Failure codes:
        <code v-for="code in failureCodes" :key="code" class="run-hero__code">{{ code }}</code>
      </p>
      <p v-if="failureSummary">{{ failureSummary }}</p>
      <p v-if="failureCodes.length === 0 && failureSummary === null">
        The run ended in a failure. Check the timeline for persisted details.
      </p>
    </div>
  </section>

  <section
    v-else-if="state === 'RUNNING'"
    class="run-hero run-hero--live"
    aria-labelledby="run-hero-title"
  >
    <span class="run-hero__pulse" aria-hidden="true" />
    <div class="run-hero__body">
      <h3 id="run-hero-title">Running · Live</h3>
      <p>The run is in progress. The timeline updates as events are persisted.</p>
    </div>
  </section>

  <section v-else class="run-hero" aria-labelledby="run-hero-title">
    <span class="run-hero__pulse" aria-hidden="true" />
    <div class="run-hero__body">
      <h3 id="run-hero-title">Ready</h3>
      <p>The run is ready and has not started yet.</p>
    </div>
  </section>
</template>
