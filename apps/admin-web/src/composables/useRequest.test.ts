import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, type PropType } from 'vue';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/client';
import { useRequest, type RequestState } from './useRequest';

type TestLoader = (signal: AbortSignal) => Promise<string>;

const RequestHarness = defineComponent({
  props: {
    loader: {
      type: Function as PropType<TestLoader>,
      required: true,
    },
  },
  setup(props, { expose }) {
    const request = useRequest((signal) => props.loader(signal));
    expose({ request });
    return () => h('div', request.data.value ?? 'No snapshot');
  },
});

function exposedRequest(wrapper: ReturnType<typeof mount>): RequestState<string> {
  return (wrapper.vm as unknown as { request: RequestState<string> }).request;
}

describe('useRequest resource state', () => {
  it('distinguishes initial loading from background refresh and retains a stale snapshot', async () => {
    const pending: Array<{
      resolve: (value: string) => void;
      reject: (error: unknown) => void;
    }> = [];
    const wrapper = mount(RequestHarness, {
      props: {
        loader: () =>
          new Promise<string>((resolve, reject) => {
            pending.push({ resolve, reject });
          }),
      },
    });
    const request = exposedRequest(wrapper);

    expect(request.initialLoading.value).toBe(true);
    expect(request.refreshing.value).toBe(false);
    pending[0]!.resolve('Snapshot A');
    await flushPromises();
    expect(request.hasSnapshot.value).toBe(true);

    const refresh = request.load();
    expect(request.initialLoading.value).toBe(false);
    expect(request.refreshing.value).toBe(true);
    expect(wrapper.text()).toBe('Snapshot A');
    pending[1]!.reject(new ApiError('REFRESH_FAILED', 'Refresh failed.', 500, 'API'));
    await refresh;

    expect(request.data.value).toBe('Snapshot A');
    expect(request.initialError.value).toBeNull();
    expect(request.refreshError.value?.message).toBe('Refresh failed.');
    wrapper.unmount();
  });

  it('reset invalidates a late context response before loading the next context', async () => {
    const resolvers: Array<(value: string) => void> = [];
    const wrapper = mount(RequestHarness, {
      props: {
        loader: () =>
          new Promise<string>((resolve) => {
            resolvers.push(resolve);
          }),
      },
    });
    const request = exposedRequest(wrapper);

    request.reset();
    const latest = request.load();
    resolvers[1]!('Context B');
    await latest;
    resolvers[0]!('Context A');
    await flushPromises();

    expect(request.data.value).toBe('Context B');
    wrapper.unmount();
  });
});
