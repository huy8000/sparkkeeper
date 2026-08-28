import type { RealtimeConnectionState } from '../types/api';

/** One shared coalescing window for every SSE-driven REST invalidation. */
export const REALTIME_REFRESH_DELAY_MS = 500;

/** Single state → translation key map; per-language text lives only in locale resources. */
const REALTIME_CONNECTION_KEYS: Record<RealtimeConnectionState, string> = {
  CONNECTING: 'realtime.reconnecting',
  CONNECTED: 'realtime.live',
  RECONNECTING: 'realtime.reconnecting',
  DISCONNECTED: 'realtime.offline',
};

export function realtimeConnectionKey(state: RealtimeConnectionState): string {
  return REALTIME_CONNECTION_KEYS[state];
}
