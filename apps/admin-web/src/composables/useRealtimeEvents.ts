import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue';

import { RealtimeClient, type RealtimeEventSubscriber } from '../api/realtimeClient';
import type { RealtimeConnectionState } from '../types/api';

export interface RealtimeState {
  readonly connectionState: Readonly<Ref<RealtimeConnectionState>>;
  readonly reconnectGeneration: Readonly<Ref<number>>;
  readonly subscribe: (subscriber: RealtimeEventSubscriber) => () => void;
}

export function useRealtimeEvents(client = new RealtimeClient()): RealtimeState {
  const connectionState = ref<RealtimeConnectionState>('DISCONNECTED');
  const reconnectGeneration = ref(0);
  let previousState: RealtimeConnectionState = 'DISCONNECTED';
  const unsubscribeState = client.subscribeState((state) => {
    if (state === 'CONNECTED' && previousState === 'RECONNECTING') {
      reconnectGeneration.value += 1;
    }
    previousState = state;
    connectionState.value = state;
  });

  onMounted(() => client.connect());
  onBeforeUnmount(() => {
    unsubscribeState();
    client.disconnect();
  });

  return {
    connectionState: readonly(connectionState),
    reconnectGeneration: readonly(reconnectGeneration),
    subscribe: (subscriber) => client.subscribe(subscriber),
  };
}
