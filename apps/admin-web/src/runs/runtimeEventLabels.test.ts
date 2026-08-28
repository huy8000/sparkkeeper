import { RUNTIME_EVENT_TYPES } from '@sparkkeeper/shared';
import { describe, expect, it } from 'vitest';

import { i18n } from '../i18n';
import { isKnownRuntimeEvent, runtimeEventKey } from './runtimeEventLabels';

describe('runtimeEventKey', () => {
  it('covers every persisted runtime event type with a resolvable label', () => {
    const t = i18n.global.t;
    for (const eventType of RUNTIME_EVENT_TYPES) {
      const key = runtimeEventKey(eventType);
      expect(key).not.toBe('runtimeEvent.unknown');
      const label = t(key);
      expect(label).not.toBe('');
      expect(label).not.toBe(eventType);
      // Human labels never present the raw enum as their only text.
      expect(label).not.toMatch(/^[A-Z][A-Z_]+$/);
    }
  });

  it('renders the required safety-critical labels in both locales', () => {
    const t = i18n.global.t;
    expect(t(runtimeEventKey('DELIVERY_UNKNOWN'))).toBe('Delivery uncertain');
    expect(t(runtimeEventKey('AUTH_EXPIRED'))).toBe('Login expired');
    expect(t(runtimeEventKey('RETRY_WAIT'))).toBe('Waiting to retry');
    expect(t(runtimeEventKey('RUN_STARTED'))).toBe('Run started');
    expect(t(runtimeEventKey('RUN_FINISHED'))).toBe('Run finished');
    expect(t(runtimeEventKey('FRIEND_RESOLVING'))).toBe('Resolving contact');
    i18n.global.locale.value = 'zh-CN';
    expect(t(runtimeEventKey('DELIVERY_UNKNOWN'))).toBe('发送结果不确定');
    expect(t(runtimeEventKey('AUTH_EXPIRED'))).toBe('登录已失效');
    expect(t(runtimeEventKey('RETRY_WAIT'))).toBe('等待重试');
  });

  it('falls back safely for unknown future events without crashing', () => {
    expect(runtimeEventKey('SOME_FUTURE_EVENT')).toBe('runtimeEvent.unknown');
    expect(runtimeEventKey('')).toBe('runtimeEvent.unknown');
    expect(i18n.global.t(runtimeEventKey('SOME_FUTURE_EVENT'))).toBe('Unknown runtime event');
    expect(isKnownRuntimeEvent('SOME_FUTURE_EVENT')).toBe(false);
    expect(isKnownRuntimeEvent('RUN_STARTED')).toBe(true);
  });
});
