<script setup lang="ts">
/* global Event, HTMLSelectElement */
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';

import { useAdminApp } from '../appContext';
import BrandMark from '../components/BrandMark.vue';
import RuntimeStatus from '../components/RuntimeStatus.vue';
import SseStatus from '../components/SseStatus.vue';
import ToastHost from '../components/ToastHost.vue';
import { useTheme } from '../composables/useTheme';
import { setLocale, useLocale, type AppLocale } from '../i18n';
import { useTranslation } from '../i18n';
import { classifyRuntimeReadiness } from '../operations/runtimeReadiness';

const route = useRoute();
const app = useAdminApp();
const theme = useTheme();
const { locale } = useLocale();
const { t } = useTranslation();
const sidebarCollapsed = ref(false);

const pageTitle = computed(() => {
  const key = String(route.meta.title ?? '');
  return key === '' ? 'SparkKeeper' : t(key);
});
const activeSection = computed(() => String(route.meta.section ?? ''));

const runtimeIndicator = computed(() => {
  if (app.runtime.error.value) return 'UNAVAILABLE';
  if (!app.runtime.data.value) return 'LOADING';
  return classifyRuntimeReadiness(app.runtime.data.value);
});

const safetyWarnings = computed(() => {
  const runtime = app.runtime.data.value;
  if (!runtime) return [];
  const warnings: string[] = [];
  if (runtime.realSendAuthorizationEnabled) warnings.push('layout.safety.realSend');
  if (runtime.manualRunEnabled) warnings.push('layout.safety.manualRun');
  if (runtime.schedulerEnabled) warnings.push('layout.safety.scheduler');
  return warnings;
});

function navigationClasses(section: string): Record<string, boolean> {
  return { 'navigation__link--active': activeSection.value === section };
}

/** Locale switching is presentation-only: no reload, no route change, no mutation. */
function handleLocaleChange(event: Event): void {
  setLocale((event.target as HTMLSelectElement).value as AppLocale);
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <RouterLink class="brand" to="/" :aria-label="t('nav.brandAria')">
        <BrandMark />
        <span class="brand__name">SparkKeeper</span>
      </RouterLink>
      <nav class="navigation" :aria-label="t('nav.primaryNav')">
        <p class="navigation__label">{{ t('nav.workspace') }}</p>
        <RouterLink to="/" :class="navigationClasses('overview')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z" />
            </svg>
          </span>
          <span>{{ t('nav.overview') }}</span>
        </RouterLink>
        <RouterLink to="/accounts" :class="navigationClasses('accounts')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c.8-4.2 3.1-6.2 7-6.2s6.2 2 7 6.2" />
            </svg>
          </span>
          <span>{{ t('nav.accounts') }}</span>
        </RouterLink>
        <RouterLink to="/templates" :class="navigationClasses('templates')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6 3h9l3 3v15H6z" />
              <path d="M14 3v4h4M9 11h6M9 15h6" />
            </svg>
          </span>
          <span>{{ t('nav.templates') }}</span>
        </RouterLink>
        <RouterLink to="/runs" :class="navigationClasses('runs')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M20 12a8 8 0 1 1-2.3-5.7L20 8" />
              <path d="M20 4v4h-4" />
            </svg>
          </span>
          <span>{{ t('nav.runs') }}</span>
        </RouterLink>
        <p class="navigation__label">{{ t('nav.operations') }}</p>
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
          <span>{{ t('nav.notifications') }}</span>
        </RouterLink>
        <RouterLink to="/operations/system" :class="navigationClasses('operations/system')">
          <span class="navigation__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          </span>
          <span>{{ t('nav.system') }}</span>
        </RouterLink>
      </nav>
      <p class="sidebar__note">{{ t('nav.sidebarNote') }}</p>
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
            {{ t(warning) }}
          </span>
          <button
            class="button button--secondary button--compact"
            type="button"
            @click="app.refresh"
          >
            {{ t('common.refresh') }}
          </button>
          <div class="language-switcher">
            <span class="language-switcher__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <circle cx="12" cy="12" r="8.5" />
                <path
                  d="M3.5 12h17M12 3.5c2.6 2.3 3.9 5.2 3.9 8.5s-1.3 6.2-3.9 8.5c-2.6-2.3-3.9-5.2-3.9-8.5s1.3-6.2 3.9-8.5z"
                />
              </svg>
            </span>
            <select
              class="language-switcher__select"
              :value="locale"
              :aria-label="t('common.languageSwitcher')"
              @change="handleLocaleChange"
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </div>
          <button
            class="theme-toggle"
            type="button"
            :aria-label="
              theme.theme.value === 'dark' ? t('common.themeLight') : t('common.themeDark')
            "
            @click="theme.toggleTheme()"
          >
            <span aria-hidden="true">{{ theme.theme.value === 'dark' ? '☀' : '☾' }}</span>
            {{ theme.theme.value === 'dark' ? t('layout.light') : t('layout.dark') }}
          </button>
          <button
            class="sidebar-toggle"
            type="button"
            :aria-label="sidebarCollapsed ? t('common.showSidebar') : t('common.hideSidebar')"
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
