import { describe, expect, it } from 'vitest';

import type { DailyRunStatus, SendRecordStatus } from '../types/api';
import { deriveRunDetailState } from './deriveRunDetailState';

function run(status: DailyRunStatus) {
  return { status };
}

function records(...statuses: SendRecordStatus[]) {
  return statuses.map((status) => ({ status }));
}

describe('deriveRunDetailState', () => {
  it('maps terminal run statuses directly when no delivery is uncertain', () => {
    expect(deriveRunDetailState(run('SUCCESS'), records('SUCCESS'))).toBe('SUCCESS');
    expect(deriveRunDetailState(run('SUCCESS'), [])).toBe('SUCCESS');
    expect(deriveRunDetailState(run('FAILED'), records('FAILED'))).toBe('FAILED');
    expect(deriveRunDetailState(run('FAILED'), [])).toBe('FAILED');
    expect(deriveRunDetailState(run('AUTH_EXPIRED'), [])).toBe('AUTH_EXPIRED');
  });

  it('keeps live run statuses while the run is still in progress', () => {
    expect(deriveRunDetailState(run('RUNNING'), [])).toBe('RUNNING');
    expect(deriveRunDetailState(run('RUNNING'), records('SUCCESS'))).toBe('RUNNING');
    expect(deriveRunDetailState(run('RUNNING'), records('DELIVERY_UNKNOWN'))).toBe('RUNNING');
    expect(deriveRunDetailState(run('READY'), [])).toBe('READY');
    expect(deriveRunDetailState(run('READY'), records('DELIVERY_UNKNOWN'))).toBe('READY');
  });

  it('lets an uncertain delivery outrank the generic FAILED presentation', () => {
    expect(deriveRunDetailState(run('FAILED'), records('DELIVERY_UNKNOWN'))).toBe(
      'DELIVERY_UNKNOWN',
    );
    expect(deriveRunDetailState(run('FAILED'), records('SUCCESS', 'DELIVERY_UNKNOWN'))).toBe(
      'DELIVERY_UNKNOWN',
    );
    expect(deriveRunDetailState(run('FAILED'), records('FAILED', 'RETRY_WAIT'))).toBe('FAILED');
  });

  it('lets an uncertain delivery dominate other terminal statuses too', () => {
    expect(deriveRunDetailState(run('AUTH_EXPIRED'), records('DELIVERY_UNKNOWN'))).toBe(
      'DELIVERY_UNKNOWN',
    );
    expect(deriveRunDetailState(run('SUCCESS'), records('DELIVERY_UNKNOWN'))).toBe(
      'DELIVERY_UNKNOWN',
    );
  });

  it('ignores record statuses that are not uncertain', () => {
    expect(deriveRunDetailState(run('SUCCESS'), records('SUCCESS', 'RETRY_WAIT', 'READY'))).toBe(
      'SUCCESS',
    );
  });
});
