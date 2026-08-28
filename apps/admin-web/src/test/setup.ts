import { afterEach, vi } from 'vitest';

import { resetThemeForTest } from '../composables/useTheme';
import { resetToastsForTest } from '../composables/useToasts';
import { resetLocaleForTest } from '../i18n';

// Foundation specs assert the en-US resource text; locale-specific specs
// opt into zh-CN or switching explicitly.
resetLocaleForTest('en-US');

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetThemeForTest();
  resetToastsForTest();
  resetLocaleForTest('en-US');
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
