import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { RealtimeClient } from '../api/realtimeClient';
import { FakeEventSource, readyEvent } from '../test/realtime';
import { useRealtimeEvents } from './useRealtimeEvents';

describe('useRealtimeEvents', () => {
  it('owns one client lifecycle and increments one generation per recovered connection', async () => {
    const source = new FakeEventSource('/api/events/stream');
    const factory = vi.fn(() => source);
    const client = new RealtimeClient('/api/events/stream', factory);
    let realtime!: ReturnType<typeof useRealtimeEvents>;
    const Subject = defineComponent({
      setup() {
        realtime = useRealtimeEvents(client);
        return () => h('span', realtime.connectionState.value);
      },
    });
    const wrapper = mount(Subject);

    expect(factory).toHaveBeenCalledTimes(1);
    source.emit('error');
    source.emit('open');
    await wrapper.vm.$nextTick();
    expect(realtime.reconnectGeneration.value).toBe(1);
    source.emit('ready', readyEvent());
    await wrapper.vm.$nextTick();
    expect(realtime.reconnectGeneration.value).toBe(1);

    source.emit('error');
    source.emit('open');
    await wrapper.vm.$nextTick();
    expect(realtime.reconnectGeneration.value).toBe(2);
    wrapper.unmount();
    expect(source.closed).toBe(true);
  });
});
