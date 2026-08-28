import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID, RUN_ID } from '../test/fixtures';
import { installApiFetch } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { createAdminRouter } from './index';

describe('admin routing', () => {
  it.each([
    ['/', 'Today at a glance'],
    ['/accounts', 'Configured accounts'],
    [`/accounts/${ACCOUNT_ID}`, 'Account readiness'],
    [`/accounts/${ACCOUNT_ID}/overview`, 'Account readiness'],
    [`/accounts/${ACCOUNT_ID}/friends`, 'Configured friends'],
    [`/accounts/${ACCOUNT_ID}/schedule`, 'Automatic execution window'],
    [`/accounts/${ACCOUNT_ID}/manual-run`, 'Server-authorized execution'],
    [`/accounts/${ACCOUNT_ID}/history`, 'Demo Account run history'],
    ['/schedules', 'Account schedule windows'],
    ['/templates', 'Message templates'],
    ['/notifications', 'Configure webhook notifications'],
    ['/operations/notifications', 'Configure webhook notifications'],
    ['/operations/system', 'Runtime health and safety status'],
    ['/runs', 'Daily run history'],
    [`/runs/${RUN_ID}`, 'Run detail'],
  ])('renders %s', async (path, expected) => {
    installApiFetch();
    const wrapper = await mountAdmin(path);
    expect(wrapper.text()).toContain(expected);
    wrapper.unmount();
  });

  it('redirects legacy paths to their V3 destinations', async () => {
    const router = createAdminRouter();
    await router.push(`/accounts/${ACCOUNT_ID}`);
    expect(router.currentRoute.value.fullPath).toBe(`/accounts/${ACCOUNT_ID}/overview`);
    await router.push('/notifications');
    expect(router.currentRoute.value.fullPath).toBe('/operations/notifications');
  });

  it('uses semantic routed tabs and supports deep-link refresh', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    const tabs = wrapper.get('nav[aria-label="Account workspace"]');
    expect(tabs.findAll('a')).toHaveLength(5);
    expect(tabs.get(`a[href="/accounts/${ACCOUNT_ID}/friends"]`).classes()).toContain(
      'account-tabs__link--active',
    );
    expect(wrapper.get(`a[href="/accounts/${ACCOUNT_ID}/overview"]`).text()).toBe('Overview');
    expect(wrapper.get('a[href="/accounts"]').text()).toContain('Accounts');
    wrapper.unmount();
  });

  it('renders an accessible unknown-route page with an Overview link', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/unknown-route');
    expect(wrapper.text()).toContain('Not Found');
    expect(wrapper.find('.not-found a[href="/"]').text()).toContain('Return to Overview');
    wrapper.unmount();
  });
});
