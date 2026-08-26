import { onBeforeUnmount, watch } from 'vue';

import type { RealtimeEvent } from '../types/api';
import { useDebouncedAction } from './useDebouncedAction';
import type { RealtimeState } from './useRealtimeEvents';

export function useRealtimeRefresh(
  realtime: RealtimeState,
  shouldRefresh: (event: RealtimeEvent) => boolean,
  refresh: () => void,
  delayMs = 500,
): void {
  const debounced = useDebouncedAction(refresh, delayMs);
  let reconnectSnapshotRequired = realtime.connectionState.value === 'RECONNECTING';
  const stopWatchingState = watch(
    realtime.connectionState,
    (state) => {
      if (state === 'RECONNECTING') reconnectSnapshotRequired = true;
    },
    { flush: 'sync' },
  );
  const unsubscribe = realtime.subscribe((event) => {
    if (event.type === 'READY' && reconnectSnapshotRequired) {
      reconnectSnapshotRequired = false;
      debounced.trigger();
      return;
    }
    if (shouldRefresh(event)) debounced.trigger();
  });
  onBeforeUnmount(() => {
    stopWatchingState();
    unsubscribe();
  });
}
