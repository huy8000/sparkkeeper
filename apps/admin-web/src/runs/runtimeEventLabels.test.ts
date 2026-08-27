import { RUNTIME_EVENT_TYPES } from '@sparkkeeper/shared';
import { describe, expect, it } from 'vitest';

import { isKnownRuntimeEvent, runtimeEventLabel } from './runtimeEventLabels';

describe('runtimeEventLabel', () => {
  it('covers every persisted runtime event type with a human label', () => {
    for (const eventType of RUNTIME_EVENT_TYPES) {
      const label = runtimeEventLabel(eventType);
      expect(label).not.toBe('');
      expect(label).not.toBe(eventType);
      expect(label).not.toBe('Unknown runtime event');
      // Human labels never present the raw enum as their only text.
      expect(label).not.toMatch(/^[A-Z][A-Z_]+$/);
    }
  });

  it('renders the required safety-critical labels', () => {
    expect(runtimeEventLabel('DELIVERY_UNKNOWN')).toBe('Delivery uncertain');
    expect(runtimeEventLabel('AUTH_EXPIRED')).toBe('Login expired');
    expect(runtimeEventLabel('RETRY_WAIT')).toBe('Waiting to retry');
    expect(runtimeEventLabel('RUN_STARTED')).toBe('Run started');
    expect(runtimeEventLabel('RUN_FINISHED')).toBe('Run finished');
    expect(runtimeEventLabel('FRIEND_RESOLVING')).toBe('Resolving contact');
  });

  it('falls back safely for unknown future events without crashing', () => {
    expect(runtimeEventLabel('SOME_FUTURE_EVENT')).toBe('Unknown runtime event');
    expect(runtimeEventLabel('')).toBe('Unknown runtime event');
    expect(isKnownRuntimeEvent('SOME_FUTURE_EVENT')).toBe(false);
    expect(isKnownRuntimeEvent('RUN_STARTED')).toBe(true);
  });
});
