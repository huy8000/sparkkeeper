/**
 * V3 shared status presentation: the single enum → translation key and tone
 * mapping. Pages must never re-implement their own status label maps, and
 * locale switching must never fork this map into per-language copies.
 */

export type StatusTone = 'positive' | 'warning' | 'danger' | 'neutral';

const STATUS_LABEL_KEYS: Record<string, string> = {
  SUCCESS: 'status.success',
  RUNNING: 'status.running',
  READY: 'status.ready',
  FAILED: 'status.failed',
  AUTH_EXPIRED: 'status.authExpired',
  DELIVERY_UNKNOWN: 'status.deliveryUnknown',
  RETRY_WAIT: 'status.retryWait',
  UNKNOWN: 'status.unknown',
  DEGRADED: 'status.degraded',
  ENABLED: 'status.enabled',
  DISABLED: 'status.disabled',
  UNAVAILABLE: 'status.unavailable',
  NOT_READY: 'status.notReady',
  SENT: 'status.sent',
  BLOCKED: 'status.blocked',
  INFO: 'status.info',
  WARN: 'status.warning',
  ERROR: 'status.error',
  EMPTY: 'status.empty',
};

const STATUS_TONES: Record<string, StatusTone> = {
  SUCCESS: 'positive',
  READY: 'positive',
  ENABLED: 'positive',
  SENT: 'positive',
  RUNNING: 'warning',
  RETRY_WAIT: 'warning',
  DEGRADED: 'warning',
  DELIVERY_UNKNOWN: 'warning',
  BLOCKED: 'warning',
  FAILED: 'danger',
  AUTH_EXPIRED: 'danger',
  UNAVAILABLE: 'danger',
  NOT_READY: 'danger',
  ERROR: 'danger',
  WARN: 'warning',
  INFO: 'positive',
  UNKNOWN: 'neutral',
  DISABLED: 'neutral',
  EMPTY: 'neutral',
};

/** Translation key for a known backend status enum; unknown values return undefined. */
export function statusLabelKey(status: string): string | undefined {
  return STATUS_LABEL_KEYS[status];
}

/**
 * Presentation fallback for unknown future enums: the raw technical value is
 * prettified, never translated and never dropped. Empty input yields '' so the
 * caller can substitute the generic "unknown" label.
 */
export function statusFallbackLabel(status: string): string {
  const words = status.replaceAll('_', ' ').trim();
  if (words.length === 0) return '';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Presentation tone for a backend status enum; unknown values fall back to neutral. */
export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status] ?? 'neutral';
}
