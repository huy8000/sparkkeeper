import { describe, expect, it } from 'vitest';

import { i18n } from './i18n';
import { statusFallbackLabel, statusLabelKey, statusTone } from './statusLabels';

describe('status label key map', () => {
  it('maps every documented run and auth enum to a translation key', () => {
    expect(statusLabelKey('SUCCESS')).toBe('status.success');
    expect(statusLabelKey('RUNNING')).toBe('status.running');
    expect(statusLabelKey('READY')).toBe('status.ready');
    expect(statusLabelKey('FAILED')).toBe('status.failed');
    expect(statusLabelKey('AUTH_EXPIRED')).toBe('status.authExpired');
    expect(statusLabelKey('DELIVERY_UNKNOWN')).toBe('status.deliveryUnknown');
    expect(statusLabelKey('RETRY_WAIT')).toBe('status.retryWait');
    expect(statusLabelKey('UNKNOWN')).toBe('status.unknown');
    expect(statusLabelKey('EMPTY')).toBe('status.empty');
  });

  it('resolves safety-critical labels in both locales from the single map', () => {
    const t = i18n.global.t;
    expect(t(statusLabelKey('AUTH_EXPIRED')!)).toBe('Login expired');
    expect(t(statusLabelKey('DELIVERY_UNKNOWN')!)).toBe('Delivery uncertain');
    expect(t(statusLabelKey('RETRY_WAIT')!)).toBe('Waiting to retry');
    i18n.global.locale.value = 'zh-CN';
    expect(t(statusLabelKey('AUTH_EXPIRED')!)).toBe('登录已失效');
    expect(t(statusLabelKey('DELIVERY_UNKNOWN')!)).toBe('发送结果不确定');
    expect(t(statusLabelKey('RETRY_WAIT')!)).toBe('等待重试');
  });

  it('prettifies unknown statuses instead of dropping them', () => {
    expect(statusLabelKey('SOME_FUTURE_STATE')).toBeUndefined();
    expect(statusFallbackLabel('SOME_FUTURE_STATE')).toBe('Some future state');
    expect(statusFallbackLabel('')).toBe('');
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
