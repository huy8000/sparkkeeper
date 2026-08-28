import { describe, expect, it } from 'vitest';

import { healthFixture, runtimeFixture } from '../test/fixtures';
import { classifyRuntimeReadiness, classifySystemSummary } from './runtimeReadiness';

describe('runtime readiness', () => {
  it('is ready only when every reported runtime dependency is ready', () => {
    expect(classifyRuntimeReadiness(runtimeFixture)).toBe('READY');
    for (const degraded of [
      { databaseReady: false },
      { migrationReady: false },
      { observabilityReady: false },
      { browserProfileConfigured: false },
      { serverStatus: 'DEGRADED' as const },
    ]) {
      expect(classifyRuntimeReadiness({ ...runtimeFixture, ...degraded })).toBe('DEGRADED');
    }
  });

  it('classifies independent loading, partial failure, full failure, and degraded data', () => {
    expect(
      classifySystemSummary({
        health: null,
        runtime: runtimeFixture,
        healthError: false,
        runtimeError: false,
      }),
    ).toBe('LOADING');
    expect(
      classifySystemSummary({
        health: healthFixture,
        runtime: runtimeFixture,
        healthError: true,
        runtimeError: false,
      }),
    ).toBe('DEGRADED');
    expect(
      classifySystemSummary({
        health: null,
        runtime: null,
        healthError: true,
        runtimeError: true,
      }),
    ).toBe('UNAVAILABLE');
    expect(
      classifySystemSummary({
        health: healthFixture,
        runtime: { ...runtimeFixture, observabilityReady: false },
        healthError: false,
        runtimeError: false,
      }),
    ).toBe('DEGRADED');
  });
});
