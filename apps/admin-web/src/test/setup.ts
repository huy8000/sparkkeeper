import { afterEach, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn(() => Promise.resolve()) },
});

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: vi.fn(),
});
