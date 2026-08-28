import { createI18n } from 'vue-i18n';

import { enUS } from './locales/en-US';
import { zhCN } from './locales/zh-CN';

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'sparkkeeper.locale';
export const DEFAULT_LOCALE: AppLocale = 'zh-CN';

export function isSupportedLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistLocale(value: AppLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, value);
  } catch {
    // Private-mode storage failures must never break the language switch.
  }
}

function applyDocumentLang(value: AppLocale): void {
  document.documentElement.lang = value;
}

/**
 * Resolve the initial locale. A valid stored choice wins; anything else
 * (missing, empty, invalid, or browser language sniffing) falls back to the
 * product default zh-CN. navigator.language is intentionally never consulted:
 * first-time visitors must see Chinese.
 */
export function resolveInitialLocale(storedValue?: string | null): AppLocale {
  return isSupportedLocale(storedValue) ? storedValue : DEFAULT_LOCALE;
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveInitialLocale(readStoredLocale()),
  fallbackLocale: DEFAULT_LOCALE,
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
});

let initialized = false;

function initialize(): void {
  if (initialized) return;
  applyDocumentLang(i18n.global.locale.value as AppLocale);
  initialized = true;
}

export function setLocale(next: AppLocale): void {
  if (!isSupportedLocale(next)) return;
  i18n.global.locale.value = next;
  persistLocale(next);
  applyDocumentLang(next);
}

export function currentLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale;
}

/**
 * App-wide locale state. The singleton keeps the choice stable across route
 * changes and SSE reconnects; switching never reloads the page, mutates data,
 * or recreates the realtime connection.
 */
export function useLocale() {
  initialize();
  return {
    locale: i18n.global.locale,
    setLocale,
  };
}

/**
 * Reactive translation handle backed by the app-wide i18n singleton. Safe to
 * call inside or outside component setup; rendered text re-evaluates when the
 * locale changes without a page reload.
 */
export function useTranslation() {
  initialize();
  return {
    locale: i18n.global.locale,
    t: i18n.global.t,
  };
}

/** Test hook: reset the singleton so each spec starts from a clean slate. */
export function resetLocaleForTest(locale: AppLocale = 'en-US'): void {
  initialized = false;
  i18n.global.locale.value = locale;
  document.documentElement.removeAttribute('lang');
}
