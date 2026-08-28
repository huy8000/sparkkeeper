import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY, applyTheme, resolveInitialTheme, useTheme } from './useTheme';

describe('resolveInitialTheme', () => {
  it('prefers the stored choice over the OS preference', () => {
    expect(resolveInitialTheme({ storedValue: 'light', prefersDark: true })).toBe('light');
    expect(resolveInitialTheme({ storedValue: 'dark', prefersDark: false })).toBe('dark');
  });

  it('falls back to the OS preference without a stored choice', () => {
    expect(resolveInitialTheme({ storedValue: null, prefersDark: true })).toBe('dark');
    expect(resolveInitialTheme({ storedValue: null, prefersDark: false })).toBe('light');
  });

  it('ignores invalid stored values and defaults to light', () => {
    expect(resolveInitialTheme({ storedValue: 'neon' })).toBe('light');
    expect(resolveInitialTheme({})).toBe('light');
  });
});

describe('applyTheme', () => {
  it('sets the data-theme attribute on the document element', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('useTheme singleton', () => {
  function stubMatchMedia(prefersDark: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: prefersDark && query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  beforeEach(() => {
    stubMatchMedia(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes from the stored preference and applies it to the document', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const { theme } = useTheme();
    expect(theme.value).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('initializes from the OS preference when nothing is stored', () => {
    stubMatchMedia(true);
    const { theme } = useTheme();
    expect(theme.value).toBe('dark');
  });

  it('toggles without reloading and persists the choice', () => {
    const { theme, toggleTheme } = useTheme();
    expect(theme.value).toBe('light');
    toggleTheme();
    expect(theme.value).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    toggleTheme();
    expect(theme.value).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('shares one state across consumers so route changes keep the choice', () => {
    const first = useTheme();
    first.setTheme('dark');
    const second = useTheme();
    expect(second.theme.value).toBe('dark');
  });
});
