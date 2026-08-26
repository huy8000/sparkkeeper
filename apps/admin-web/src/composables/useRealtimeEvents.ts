import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue';

import { RealtimeClient, type RealtimeEventSubscriber } from '../api/realtimeClient';
import type { RealtimeConnectionState } from '../types/api';

export interface RealtimeState {
  readonly connectionState: Readonly<Ref<RealtimeConnectionState>>;
  readonly subscribe: (subscriber: RealtimeEventSubscriber) => () => void;
}

export function useRealtimeEvents(client = new RealtimeClient()): RealtimeState {
  const connectionState = ref<RealtimeConnectionState>('DISCONNECTED');
  const unsubscribeState = client.subscribeState((state) => {
    connectionState.value = state;
  });

  onMounted(() => client.connect());
  onBeforeUnmount(() => {
    unsubscribeState();
    client.disconnect();
  });

  return {
    connectionState: readonly(connectionState),
    subscribe: (subscriber) => client.subscribe(subscriber),
  };
}
