import { onBeforeUnmount, onMounted, readonly, ref, type Ref } from 'vue';

import { RealtimeClient, type RealtimeEventSubscriber } from '../api/realtimeClient';
import type { RealtimeConnectionState } from '../types/api';

export interface RealtimeState {
  readonly connectionState: Readonly<Ref<RealtimeConnectionState>>;
  readonly reconnectGeneration: Readonly<Ref<number>>;
  readonly subscribe: (subscriber: RealtimeEventSubscriber) => () => void;
  readonly connect?: () => void;
  readonly disconnect?: () => void;
}

export function useRealtimeEvents(
  client = new RealtimeClient(),
  autoConnect = true,
): RealtimeState & { connect: () => void; disconnect: () => void } {
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

  onMounted(() => {
    if (autoConnect) client.connect();
  });

  onBeforeUnmount(() => {
    unsubscribeState();
    client.disconnect();
  });

  return {
    connectionState: readonly(connectionState),
    reconnectGeneration: readonly(reconnectGeneration),
    subscribe: (subscriber) => client.subscribe(subscriber),
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
  };
}
