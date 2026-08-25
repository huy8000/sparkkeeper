<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { useAdminApp } from '../appContext';
import StatusBadge from '../components/StatusBadge.vue';

const route = useRoute();
const app = useAdminApp();
const pageTitle = computed(() => String(route.meta.title ?? 'SparkKeeper'));
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink class="brand" to="/" aria-label="SparkKeeper Dashboard">
        <span class="brand__mark" aria-hidden="true">SK</span>
        <span>SparkKeeper</span>
      </RouterLink>
      <nav class="navigation" aria-label="Primary navigation">
        <RouterLink to="/" exact-active-class="navigation__link--active">Dashboard</RouterLink>
        <RouterLink to="/accounts" active-class="navigation__link--active">Accounts</RouterLink>
        <RouterLink to="/schedules" active-class="navigation__link--active">Schedules</RouterLink>
        <RouterLink to="/templates" active-class="navigation__link--active">Templates</RouterLink>
        <RouterLink to="/runs" active-class="navigation__link--active">Runs</RouterLink>
      </nav>
      <p class="sidebar__note">Local configuration administration</p>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div>
          <p class="topbar__product">SparkKeeper</p>
          <h1>{{ pageTitle }}</h1>
        </div>
        <div class="topbar__actions">
          <StatusBadge
            v-if="app.runtime.data.value"
            :status="app.runtime.data.value.serverStatus"
            :label="`Runtime ${app.runtime.data.value.serverStatus}`"
          />
          <StatusBadge
            v-else-if="app.runtime.error.value"
            status="DEGRADED"
            label="Runtime unavailable"
          />
          <span v-else class="topbar__loading" role="status">Checking runtime…</span>
          <button class="button button--secondary" type="button" @click="app.refresh">
            Refresh
          </button>
        </div>
      </header>
      <main id="main-content" class="content">
        <RouterView />
      </main>
    </div>
  </div>
</template>
