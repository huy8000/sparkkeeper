/**
 * Internal test-only instrumentation for observing SQLite lock contention.
 * This file is NOT exported in packages/database/src/index.ts (not part of public API).
 */

let activeContentionProbe: Int32Array | null = null;

export function installAccountLoginSessionContentionProbeForTest(probe: Int32Array): void {
  activeContentionProbe = probe;
}

export function clearAccountLoginSessionContentionProbeForTest(): void {
  activeContentionProbe = null;
}

export function signalAccountLoginSessionContentionObserved(): void {
  try {
    if (activeContentionProbe) {
      Atomics.add(activeContentionProbe, 0, 1);
      Atomics.notify(activeContentionProbe, 0, 1);
    }
  } catch {
    // Defensive isolation: never allow test probe failures to escape into Repository operations
  }
}
