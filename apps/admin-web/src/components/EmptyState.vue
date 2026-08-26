<script setup lang="ts">
withDefaults(defineProps<{ title: string; description?: string }>(), { description: '' });
</script>

<template>
  <section class="state-panel state-panel--empty empty-state">
    <div class="empty-state__icon" aria-hidden="true">
      <slot name="icon">
        <svg viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="27" fill="var(--sk-surface-secondary)" />
          <circle
            cx="40"
            cy="40"
            r="11"
            fill="none"
            stroke="var(--sk-text-tertiary)"
            stroke-width="3"
          />
        </svg>
      </slot>
    </div>
    <div>
      <h2 class="state-panel__title">{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.action" class="empty-state__action">
      <slot name="action" />
    </div>
  </section>
</template>
