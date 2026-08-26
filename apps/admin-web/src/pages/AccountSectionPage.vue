<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import PageShell from '../components/PageShell.vue';

const route = useRoute();
const sectionTitle = computed(() => String(route.meta.sectionTitle ?? 'Section'));
const sectionDescription = computed(() => String(route.meta.sectionDescription ?? ''));
const overviewPath = computed(() => `/accounts/${route.params.accountId}/overview`);
</script>

<template>
  <PageShell eyebrow="Account workspace" :title="sectionTitle" :description="sectionDescription">
    <RouterLink class="button button--secondary" :to="overviewPath">
      ← Back to account overview
    </RouterLink>
  </PageShell>
</template>
