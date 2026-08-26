<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';

import { useAdminApp } from '../appContext';
import BrandMark from '../components/BrandMark.vue';
import RuntimeStatus from '../components/RuntimeStatus.vue';
import SseStatus from '../components/SseStatus.vue';
import ToastHost from '../components/ToastHost.vue';
import { useTheme } from '../composables/useTheme';

const route = useRoute();
const app = useAdminApp();
const theme = useTheme();
const sidebarCollapsed = ref(false);

const pageTitle = computed(() => String(route.meta.title ?? 'SparkKeeper'));
const activeSection = computed(() => String(route.meta.section ?? ''));

const runtimeIndicator = computed(() => {
  if (app.runtime.error.value) return 'UNAVAILABLE';
  if (!app.runtime.data.value) return 'LOADING';
  return app.runtime.data.value.serverStatus === 'READY' ? 'READY' : 'DEGRADED';
});

const safetyWarnings = computed(() => {
  const runtime = app.runtime.data.value;
  if (!runtime) return [];
  const warnings: string[] = [];
  if (runtime.realSendAuthorizationEnabled) warnings.push('Real Send Enabled');
  if (runtime.manualRunEnabled) warnings.push('Manual Run Enabled');
  if (runtime.schedulerEnabled) warnings.push('Scheduler Enabled');
  return warnings;
});

function navigationClasses(section: string): Record<string, boolean> {
  return { 'navigation__link--active': activeSection.value === section };
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <RouterLink class="brand" to="/" aria-label="SparkKeeper Overview">
        <BrandMark />
        <span class="brand__name">SparkKeeper</span>
      </RouterLink>
      <nav class="navigation" aria-label="Primary navigation">
        <p class="navigation__label">Workspace</p>
        <RouterLink to="/" :class="navigationClasses('overview')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z" />
            </svg>
          </span>
          <span>Overview</span>
        </RouterLink>
        <RouterLink to="/accounts" :class="navigationClasses('accounts')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c.8-4.2 3.1-6.2 7-6.2s6.2 2 7 6.2" />
            </svg>
          </span>
          <span>Accounts</span>
        </RouterLink>
        <RouterLink to="/templates" :class="navigationClasses('templates')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6 3h9l3 3v15H6z" />
              <path d="M14 3v4h4M9 11h6M9 15h6" />
            </svg>
          </span>
          <span>Templates</span>
        </RouterLink>
        <RouterLink to="/runs" :class="navigationClasses('runs')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8" />
              <path d="M20 4v4h-4" />
            </svg>
          </span>
          <span>Runs</span>
        </RouterLink>
        <p class="navigation__label">Operations</p>
        <RouterLink
          to="/operations/notifications"
          :class="navigationClasses('operations/notifications')"
        >
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M7 17h10l-1.2-2.1V10a3.8 3.8 0 0 0-7.6 0v4.9z" />
              <path d="M10 20h4" />
            </svg>
          </span>
          <span>Notifications</span>
        </RouterLink>
        <RouterLink to="/operations/system" :class="navigationClasses('operations/system')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </span>
          <span>System</span>
        </RouterLink>
      </nav>
      <p class="sidebar__note">Local configuration administration</p>
    </aside>

    <div class="workspace">
      <header class="topbar">
        <div class="topbar__title">
          <p class="topbar__product">SparkKeeper</p>
          <h1>{{ pageTitle }}</h1>
        </div>
        <div class="topbar__actions">
          <RuntimeStatus :status="runtimeIndicator" />
          <SseStatus :state="app.realtime.connectionState.value" />
          <span
            v-for="warning in safetyWarnings"
            :key="warning"
            class="safety-warning"
            role="status"
          >
            {{ warning }}
          </span>
          <button
            class="button button--secondary button--compact"
            type="button"
            @click="app.refresh"
          >
            Refresh
          </button>
          <button
            class="theme-toggle"
            type="button"
            :aria-label="
              theme.theme.value === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
            "
            @click="theme.toggleTheme()"
          >
            <span aria-hidden="true">{{ theme.theme.value === 'dark' ? '☀' : '☾' }}</span>
            {{ theme.theme.value === 'dark' ? 'Light' : 'Dark' }}
          </button>
          <button
            class="sidebar-toggle"
            type="button"
            :aria-label="sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'"
            :aria-pressed="sidebarCollapsed"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            ☰
          </button>
        </div>
      </header>
      <main id="main-content" class="content">
        <RouterView />
      </main>
    </div>
    <ToastHost />
  </div>
</template>
