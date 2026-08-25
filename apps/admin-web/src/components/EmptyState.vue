<script setup lang="ts">
withDefaults(defineProps<{ title: string; description?: string }>(), { description: '' });
</script>

<template>
  <section class="state-panel state-panel--empty">
    <div>
      <h2 class="state-panel__title">{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
    </div>
  </section>
</template>
