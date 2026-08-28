<script setup lang="ts">
import { useTranslation } from '../../i18n';
import type { RunDetailState } from '../../runs/deriveRunDetailState';

defineProps<{
  state: RunDetailState;
  accountId: string;
  durationLabel: string;
  successfulDeliveryCount: number;
  failureCodes: readonly string[];
  failureSummary: string | null;
}>();

const { t } = useTranslation();
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
      <h3 id="run-hero-title">{{ t('runHero.successTitle') }}</h3>
      <p>{{ t('runHero.successBody') }}</p>
      <p v-if="successfulDeliveryCount > 0">
        {{ t('runHero.successVerified') }}
      </p>
      <p class="run-hero__stats">
        <span>{{ t('runHero.successDeliveries', successfulDeliveryCount) }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ t('runHero.successDuration', { duration: durationLabel }) }}</span>
      </p>
    </div>
    <ol class="verification-chain" :aria-label="t('runHero.chainAria')">
      <li>{{ t('runHero.chainResolve') }}</li>
      <li>{{ t('runHero.chainSend') }}</li>
      <li>{{ t('runHero.chainObserve') }}</li>
      <li>{{ t('runHero.chainPersist') }}</li>
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
      <h3 id="run-hero-title">{{ t('runHero.uncertainTitle') }}</h3>
      <p>{{ t('runHero.uncertainBody') }}</p>
      <p>
        <strong>{{ t('runHero.uncertainMayDelivered') }}</strong>
      </p>
      <p>{{ t('runHero.uncertainNoRetry') }}</p>
    </div>
  </section>

  <section
    v-else-if="state === 'AUTH_EXPIRED'"
    class="run-hero run-hero--danger"
    aria-labelledby="run-hero-title"
  >
    <span class="run-hero__mark" aria-hidden="true">!</span>
    <div class="run-hero__body">
      <h3 id="run-hero-title">{{ t('runHero.authExpiredTitle') }}</h3>
      <p>{{ t('runHero.authExpiredBody') }}</p>
      <p>{{ t('runHero.authExpiredNote') }}</p>
    </div>
    <RouterLink class="button button--secondary" :to="`/accounts/${accountId}/overview`">
      {{ t('runHero.viewAccount') }}
    </RouterLink>
  </section>

  <section
    v-else-if="state === 'FAILED'"
    class="run-hero run-hero--danger"
    aria-labelledby="run-hero-title"
  >
    <span class="run-hero__mark" aria-hidden="true">!</span>
    <div class="run-hero__body">
      <h3 id="run-hero-title">{{ t('runHero.failedTitle') }}</h3>
      <p v-if="failureCodes.length > 0">
        {{ t('runHero.failedCodes') }}
        <code v-for="code in failureCodes" :key="code" class="run-hero__code">{{ code }}</code>
      </p>
      <p v-if="failureSummary">{{ failureSummary }}</p>
      <p v-if="failureCodes.length === 0 && failureSummary === null">
        {{ t('runHero.failedFallback') }}
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
      <h3 id="run-hero-title">{{ t('runHero.runningTitle') }}</h3>
      <p>{{ t('runHero.runningBody') }}</p>
    </div>
  </section>

  <section v-else class="run-hero" aria-labelledby="run-hero-title">
    <span class="run-hero__pulse" aria-hidden="true" />
    <div class="run-hero__body">
      <h3 id="run-hero-title">{{ t('runHero.readyTitle') }}</h3>
      <p>{{ t('runHero.readyBody') }}</p>
    </div>
  </section>
</template>
