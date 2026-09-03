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

/**
 * Generic internal probe registry shared by internal test harnesses that must
 * observe a real SQLITE_BUSY/LOCKED attempt without any public API surface.
 * The probe is observe-only: it can never alter timeout, retry, classification,
 * or results, and failures are isolated from production code. Install with a
 * unique key per subsystem under test.
 */
const activeGenericProbes = new Map<string, Int32Array>();

export function installContentionProbeForTest(key: string, probe: Int32Array): void {
  activeGenericProbes.set(key, probe);
}

export function clearContentionProbeForTest(key: string): void {
  activeGenericProbes.delete(key);
}

export function signalContentionObserved(key: string): void {
  try {
    const probe = activeGenericProbes.get(key);
    if (probe) {
      Atomics.add(probe, 0, 1);
      Atomics.notify(probe, 0, 1);
    }
  } catch {
    // Defensive isolation: never allow test probe failures to escape into Repository operations
  }
}
