import { afterEach, vi } from 'vitest';

import { resetThemeForTest } from '../composables/useTheme';
import { resetToastsForTest } from '../composables/useToasts';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetThemeForTest();
  resetToastsForTest();
  window.localStorage.clear();
});

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn(() => Promise.resolve()) },
});

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: vi.fn(),
});
