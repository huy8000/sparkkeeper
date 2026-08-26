import { readonly, ref, type Ref } from 'vue';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sparkkeeper.theme';

export interface ThemeInitializationInput {
  readonly storedValue?: string | null;
  readonly prefersDark?: boolean;
}

/** Explicit stored choice wins; otherwise fall back to the OS preference, defaulting to light. */
export function resolveInitialTheme(input: ThemeInitializationInput = {}): ThemeMode {
  if (input.storedValue === 'light' || input.storedValue === 'dark') return input.storedValue;
  return input.prefersDark === true ? 'dark' : 'light';
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export interface ThemeState {
  readonly theme: Readonly<Ref<ThemeMode>>;
  readonly setTheme: (theme: ThemeMode) => void;
  readonly toggleTheme: () => void;
}

const theme = ref<ThemeMode>('light');
let initialized = false;
let storedPreference = false;

function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistTheme(value: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Private-mode storage failures must never break the theme switch.
  }
}

function prefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function initialize(): void {
  if (initialized) return;
  const stored = readStoredTheme();
  storedPreference = stored === 'light' || stored === 'dark';
  theme.value = resolveInitialTheme({ storedValue: stored, prefersDark: prefersDark() });
  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (!storedPreference) {
        theme.value = event.matches ? 'dark' : 'light';
        applyTheme(theme.value);
      }
    };
    media.addEventListener?.('change', handleChange);
  }
  applyTheme(theme.value);
  initialized = true;
}

function setTheme(next: ThemeMode): void {
  theme.value = next;
  storedPreference = true;
  persistTheme(next);
  applyTheme(next);
}

/**
 * App-wide theme state. The singleton keeps the choice stable across route
 * changes and SSE reconnects; switching never reloads the page.
 */
export function useTheme(): ThemeState {
  initialize();
  return {
    theme: readonly(theme),
    setTheme,
    toggleTheme: () => setTheme(theme.value === 'dark' ? 'light' : 'dark'),
  };
}

/** Test hook: reset the singleton so each spec starts from a clean slate. */
export function resetThemeForTest(): void {
  initialized = false;
  storedPreference = false;
  theme.value = 'light';
  document.documentElement.removeAttribute('data-theme');
}
