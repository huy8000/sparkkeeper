<script setup lang="ts">
/* global Event, HTMLSelectElement, setInterval, clearInterval */
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAdminApp } from '../appContext';
import BrandMark from '../components/BrandMark.vue';
import { useTheme } from '../composables/useTheme';
import { setLocale, useLocale, useTranslation, type AppLocale } from '../i18n';
import type { ApiError } from '../api/client';

const { auth } = useAdminApp();
const router = useRouter();
const route = useRoute();
const theme = useTheme();
const { locale } = useLocale();
const { t } = useTranslation();

const username = ref('');
const password = ref('');
const errorMessage = ref<string | null>(null);
const retryAfterSeconds = ref<number | null>(null);
let countdownTimer: ReturnType<typeof setInterval> | null = null;

const displayErrorMessage = computed(() => {
  if (retryAfterSeconds.value !== null) {
    return t('auth.rateLimitedNotice', { seconds: retryAfterSeconds.value });
  }
  return errorMessage.value;
});

const sessionNoticeMessage = computed(() => {
  const notice = auth.sessionNotice.value;
  if (!notice) return null;
  if (notice === 'SESSION_EXPIRED') return t('auth.sessionExpiredNotice');
  if (notice === 'SESSION_REVOKED') return t('auth.sessionRevokedNotice');
  return t('auth.unauthenticated');
});

function clearPassword(): void {
  password.value = '';
}

onBeforeUnmount(() => {
  clearPassword();
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
});

function sanitizeRedirect(redirect: unknown): string {
  if (
    typeof redirect === 'string' &&
    redirect.startsWith('/') &&
    !redirect.startsWith('//') &&
    !redirect.startsWith('/\\')
  ) {
    return redirect;
  }
  return '/';
}

function startCountdown(seconds: number): void {
  retryAfterSeconds.value = seconds;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    if (retryAfterSeconds.value !== null && retryAfterSeconds.value > 1) {
      retryAfterSeconds.value -= 1;
    } else {
      retryAfterSeconds.value = null;
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    }
  }, 1000);
}

async function handleLogin(): Promise<void> {
  errorMessage.value = null;
  const inputUsername = username.value;
  const inputPassword = password.value;
  clearPassword();

  if (!inputUsername || !inputPassword) {
    errorMessage.value = t('errors.api.validationError');
    return;
  }

  try {
    await auth.login({ username: inputUsername, password: inputPassword });
    auth.clearSessionNotice();
    const destination = sanitizeRedirect(route.query.redirect);
    await router.push(destination);
  } catch (err: unknown) {
    const error = err as ApiError;
    if (error.code === 'INVALID_CREDENTIALS') {
      errorMessage.value = t('auth.invalidCredentials');
    } else if (error.code === 'RATE_LIMITED') {
      const wait = error.retryAfter ?? 60;
      startCountdown(wait);
    } else if (error.code === 'SERVICE_NOT_INITIALIZED') {
      errorMessage.value = t('auth.bootstrapGuidance');
    } else if (error.code === 'AUTH_SERVICE_UNAVAILABLE') {
      errorMessage.value = t('auth.serviceUnavailable');
    } else if (error.kind === 'NETWORK') {
      errorMessage.value = t('common.unableToLoadData');
    } else {
      errorMessage.value = error.message || t('common.unexpectedError');
    }
  }
}

function handleLocaleChange(event: Event): void {
  setLocale((event.target as HTMLSelectElement).value as AppLocale);
}
</script>

<template>
  <div class="login-container">
    <div class="login-topbar">
      <div class="language-switcher">
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
        :aria-label="theme.theme.value === 'dark' ? t('common.themeLight') : t('common.themeDark')"
        @click="theme.toggleTheme()"
      >
        <span aria-hidden="true">{{ theme.theme.value === 'dark' ? '☀' : '☾' }}</span>
      </button>
    </div>

    <div class="login-card">
      <div class="login-card__header">
        <div class="login-card__brand">
          <BrandMark />
          <span class="brand__name">SparkKeeper</span>
        </div>
        <h1 class="login-card__title">{{ t('auth.title') }}</h1>
        <p class="login-card__subtitle">{{ t('auth.subtitle') }}</p>
      </div>

      <div
        v-if="sessionNoticeMessage && !displayErrorMessage"
        class="login-alert login-alert--info"
        role="status"
      >
        {{ sessionNoticeMessage }}
      </div>

      <div v-if="displayErrorMessage" class="login-alert login-alert--error" role="alert">
        {{ displayErrorMessage }}
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="form-group">
          <label for="admin-username" class="form-label">
            {{ t('auth.usernameLabel') }}
          </label>
          <input
            id="admin-username"
            v-model="username"
            type="text"
            class="form-input"
            autocomplete="username"
            autofocus
            required
            :placeholder="t('auth.usernamePlaceholder')"
            :disabled="auth.isLoggingIn.value || retryAfterSeconds !== null"
          />
        </div>

        <div class="form-group">
          <label for="admin-password" class="form-label">
            {{ t('auth.passwordLabel') }}
          </label>
          <input
            id="admin-password"
            v-model="password"
            type="password"
            class="form-input"
            autocomplete="current-password"
            required
            :placeholder="t('auth.passwordPlaceholder')"
            :disabled="auth.isLoggingIn.value || retryAfterSeconds !== null"
          />
        </div>

        <button
          type="submit"
          class="button button--primary button--block"
          :disabled="auth.isLoggingIn.value || retryAfterSeconds !== null"
        >
          <span v-if="auth.isLoggingIn.value">{{ t('auth.loggingIn') }}</span>
          <span v-else-if="retryAfterSeconds !== null">
            {{ t('auth.rateLimitedNotice', { seconds: retryAfterSeconds }) }}
          </span>
          <span v-else>{{ t('auth.loginButton') }}</span>
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: var(--color-bg-base, #f8fafc);
}

.login-topbar {
  position: absolute;
  top: 1rem;
  right: 1rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.login-card {
  width: 100%;
  max-width: 420px;
  background: var(--color-bg-surface, #ffffff);
  border: 1px solid var(--color-border-subtle, #e2e8f0);
  border-radius: 12px;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.05),
    0 2px 4px -1px rgba(0, 0, 0, 0.03);
  padding: 2.5rem 2rem;
}

.login-card__header {
  text-align: center;
  margin-bottom: 2rem;
}

.login-card__brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.brand__name {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-text-primary, #0f172a);
}

.login-card__title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text-primary, #0f172a);
  margin: 0 0 0.5rem;
}

.login-card__subtitle {
  font-size: 0.875rem;
  color: var(--color-text-secondary, #64748b);
  margin: 0;
}

.login-alert {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  margin-bottom: 1.5rem;
  line-height: 1.4;
}

.login-alert--info {
  background: var(--color-info-bg, #eff6ff);
  color: var(--color-info-text, #1e40af);
  border: 1px solid var(--color-info-border, #bfdbfe);
}

.login-alert--error {
  background: var(--color-danger-bg, #fef2f2);
  color: var(--color-danger-text, #991b1b);
  border: 1px solid var(--color-danger-border, #fecaca);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.form-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary, #0f172a);
}

.form-input {
  padding: 0.625rem 0.875rem;
  font-size: 0.9375rem;
  border: 1px solid var(--color-border-subtle, #cbd5e1);
  border-radius: 6px;
  background: var(--color-bg-input, #ffffff);
  color: var(--color-text-primary, #0f172a);
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.form-input:focus {
  border-color: var(--color-primary, #2563eb);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.form-input:disabled {
  background: var(--color-bg-disabled, #f1f5f9);
  cursor: not-allowed;
}

.button--block {
  width: 100%;
  padding: 0.75rem;
  font-size: 0.9375rem;
  font-weight: 600;
  margin-top: 0.5rem;
}
</style>
