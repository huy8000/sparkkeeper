import { describe, expect, it } from 'vitest';

import { statusLabel, statusTone } from './statusLabels';

describe('status labels', () => {
  it('maps every documented run and auth enum to human text', () => {
    expect(statusLabel('SUCCESS')).toBe('Success');
    expect(statusLabel('RUNNING')).toBe('Running');
    expect(statusLabel('READY')).toBe('Ready');
    expect(statusLabel('FAILED')).toBe('Failed');
    expect(statusLabel('AUTH_EXPIRED')).toBe('Login expired');
    expect(statusLabel('DELIVERY_UNKNOWN')).toBe('Delivery uncertain');
    expect(statusLabel('RETRY_WAIT')).toBe('Waiting to retry');
    expect(statusLabel('UNKNOWN')).toBe('Unknown');
    expect(statusLabel('EMPTY')).toBe('No runs yet');
  });

  it('prettifies unknown statuses instead of dropping them', () => {
    expect(statusLabel('SOME_FUTURE_STATE')).toBe('Some future state');
    expect(statusLabel('')).toBe('Unknown');
  });

  it('maps every documented enum to a presentation tone', () => {
    expect(statusTone('SUCCESS')).toBe('positive');
    expect(statusTone('READY')).toBe('positive');
    expect(statusTone('SENT')).toBe('positive');
    expect(statusTone('RUNNING')).toBe('warning');
    expect(statusTone('RETRY_WAIT')).toBe('warning');
    expect(statusTone('DEGRADED')).toBe('warning');
    expect(statusTone('DELIVERY_UNKNOWN')).toBe('warning');
    expect(statusTone('FAILED')).toBe('danger');
    expect(statusTone('AUTH_EXPIRED')).toBe('danger');
    expect(statusTone('UNAVAILABLE')).toBe('danger');
    expect(statusTone('NOT_READY')).toBe('danger');
    expect(statusTone('UNKNOWN')).toBe('neutral');
    expect(statusTone('EMPTY')).toBe('neutral');
  });

  it('falls back to a neutral tone for unknown statuses', () => {
    expect(statusTone('SOME_FUTURE_STATE')).toBe('neutral');
  });
});
