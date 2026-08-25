import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID, RUN_ID } from '../test/fixtures';
import { installApiFetch } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('admin routing', () => {
  it.each([
    ['/', 'Runtime at a glance'],
    ['/accounts', 'Configured accounts'],
    [`/accounts/${ACCOUNT_ID}`, 'Account detail'],
    ['/schedules', 'Account schedule windows'],
    ['/templates', 'Message templates'],
    ['/notifications', 'Webhook notifications'],
    ['/runs', 'Daily run history'],
    [`/runs/${RUN_ID}`, 'Run summary'],
  ])('renders %s', async (path, expected) => {
    installApiFetch();
    const wrapper = await mountAdmin(path);
    expect(wrapper.text()).toContain(expected);
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
