import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID, RUN_ID } from '../test/fixtures';
import { installApiFetch } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { createAdminRouter } from './index';

describe('admin routing', () => {
  it.each([
    ['/', 'Runtime at a glance'],
    ['/accounts', 'Configured accounts'],
    [`/accounts/${ACCOUNT_ID}`, 'Account detail'],
    [`/accounts/${ACCOUNT_ID}/overview`, 'Account detail'],
    [`/accounts/${ACCOUNT_ID}/friends`, 'Friends'],
    [`/accounts/${ACCOUNT_ID}/schedule`, 'Schedule'],
    [`/accounts/${ACCOUNT_ID}/manual-run`, 'Manual run'],
    [`/accounts/${ACCOUNT_ID}/history`, 'History'],
    ['/schedules', 'Account schedule windows'],
    ['/templates', 'Message templates'],
    ['/notifications', 'Webhook notifications'],
    ['/operations/notifications', 'Webhook notifications'],
    ['/operations/system', 'System status'],
    ['/runs', 'Daily run history'],
    [`/runs/${RUN_ID}`, 'Run summary'],
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

  it('links account sections back to the account overview', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/friends`);
    const backLink = wrapper.find('a[href="/accounts/' + ACCOUNT_ID + '/overview"]');
    expect(backLink.exists()).toBe(true);
    expect(backLink.text()).toContain('Back to account overview');
    wrapper.unmount();
  });

  it('renders an accessible unknown-route page with a Dashboard link', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/unknown-route');

    expect(wrapper.text()).toContain('Not Found');
    expect(wrapper.find('.not-found a[href="/"]').text()).toContain('Return to Dashboard');
    wrapper.unmount();
  });
});
