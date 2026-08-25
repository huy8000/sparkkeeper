import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

import App from '../App.vue';
import { createAdminRouter } from '../router';

export async function mountAdmin(path: string): Promise<VueWrapper> {
  const router = createAdminRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}
