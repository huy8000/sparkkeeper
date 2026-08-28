import { onBeforeUnmount } from 'vue';

import { REALTIME_REFRESH_DELAY_MS } from '../api/realtimePolicy';
import type { RealtimeEvent } from '../types/api';
import { useDebouncedAction } from './useDebouncedAction';
import type { RealtimeState } from './useRealtimeEvents';

export function useRealtimeRefresh(
  realtime: RealtimeState,
  shouldRefresh: (event: RealtimeEvent) => boolean,
  refresh: () => void,
  delayMs = REALTIME_REFRESH_DELAY_MS,
): void {
  const debounced = useDebouncedAction(refresh, delayMs);
  const unsubscribe = realtime.subscribe((event) => {
    if (shouldRefresh(event)) debounced.trigger();
  });
  onBeforeUnmount(() => {
    unsubscribe();
  });
}
