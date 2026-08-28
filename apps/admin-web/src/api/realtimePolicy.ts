import type { RealtimeConnectionState } from '../types/api';

/** One shared coalescing window for every SSE-driven REST invalidation. */
export const REALTIME_REFRESH_DELAY_MS = 500;

const REALTIME_CONNECTION_LABELS: Record<RealtimeConnectionState, string> = {
  CONNECTING: 'Reconnecting',
  CONNECTED: 'Live',
  RECONNECTING: 'Reconnecting',
  DISCONNECTED: 'Offline',
};

export function realtimeConnectionLabel(state: RealtimeConnectionState): string {
  return REALTIME_CONNECTION_LABELS[state];
}
