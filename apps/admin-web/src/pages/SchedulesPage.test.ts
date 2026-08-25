import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID } from '../test/fixtures';
import { installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Schedules', () => {
  it('aggregates account-scoped schedules and distinguishes runtime control', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/schedules');

    expect(wrapper.text()).toContain('Runtime scheduler');
    expect(wrapper.text()).toContain('Schedule enabled');
    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.find(`a[href="/accounts/${ACCOUNT_ID}"]`).exists()).toBe(true);
    expect(
      wrapper.findAll('button').some((button) => /toggle|enable|disable/i.test(button.text())),
    ).toBe(false);
    wrapper.unmount();
  });

  it('renders an empty schedule state', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}/schedules` ? success([]) : undefined,
    );
    const wrapper = await mountAdmin('/schedules');

    expect(wrapper.text()).toContain('No schedules');
    wrapper.unmount();
  });
});
