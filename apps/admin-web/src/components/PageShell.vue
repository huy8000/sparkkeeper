<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description?: string }>();
</script>

<template>
  <!-- V3 placeholder page shell; business UIs migrate onto this frame page by page. -->
  <div class="page-stack">
    <header class="page-heading">
      <div>
        <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
        <h2>{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
    </header>
    <section class="page-shell">
      <slot>
        <p class="page-shell__note">
          This area is part of the V3 foundation and will be completed in a follow-up task.
        </p>
      </slot>
    </section>
  </div>
</template>
