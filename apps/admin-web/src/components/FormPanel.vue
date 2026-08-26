<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
defineEmits<{ cancel: [] }>();
</script>

<template>
  <section class="form-panel" role="region" :aria-label="title">
    <header class="form-panel__header">
      <div>
        <h3>{{ title }}</h3>
        <p v-if="description">{{ description }}</p>
      </div>
      <button class="button button--secondary" type="button" @click="$emit('cancel')">
        Cancel
      </button>
    </header>
    <slot />
  </section>
</template>
