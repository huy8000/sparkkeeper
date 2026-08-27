/**
 * V3 shared status presentation: the single enum → human text and tone mapping.
 * Pages must never re-implement their own status label maps.
 */

export type StatusTone = 'positive' | 'warning' | 'danger' | 'neutral';

const STATUS_LABELS: Record<string, string> = {
  SUCCESS: 'Success',
  RUNNING: 'Running',
  READY: 'Ready',
  FAILED: 'Failed',
  AUTH_EXPIRED: 'Login expired',
  DELIVERY_UNKNOWN: 'Delivery uncertain',
  RETRY_WAIT: 'Waiting to retry',
  UNKNOWN: 'Unknown',
  DEGRADED: 'Degraded',
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
  UNAVAILABLE: 'Unavailable',
  NOT_READY: 'Not ready',
  SENT: 'Sent',
  BLOCKED: 'Blocked',
  INFO: 'Info',
  WARN: 'Warning',
  ERROR: 'Error',
  EMPTY: 'No runs yet',
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

/** Human-readable label for a backend status enum; unknown values are prettified, never dropped. */
export function statusLabel(status: string): string {
  const known = STATUS_LABELS[status];
  if (known !== undefined) return known;
  const words = status.replaceAll('_', ' ').trim();
  if (words.length === 0) return 'Unknown';
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Presentation tone for a backend status enum; unknown values fall back to neutral. */
export function statusTone(status: string): StatusTone {
  return STATUS_TONES[status] ?? 'neutral';
}
