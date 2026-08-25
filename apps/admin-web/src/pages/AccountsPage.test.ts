import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID, accountFixture, friendFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Accounts', () => {
  it('renders the account list and links to detail', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/accounts');

    expect(wrapper.text()).toContain('Demo Account');
    expect(wrapper.text()).toContain('READY');
    expect(wrapper.find(`a[href="/accounts/${ACCOUNT_ID}"]`).exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders an empty account state', async () => {
    installApiFetch((url) => (url.pathname === '/api/accounts' ? success([]) : undefined));
    const wrapper = await mountAdmin('/accounts');

    expect(wrapper.text()).toContain('No accounts');
    wrapper.unmount();
  });

  it('renders a safe account-list error', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/accounts'
        ? failure('DATABASE_UNAVAILABLE', 'Accounts are temporarily unavailable.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin('/accounts');

    expect(wrapper.find('[role="alert"]').text()).toContain(
      'Accounts are temporarily unavailable.',
    );
    wrapper.unmount();
  });

  it('renders account detail, a disabled friend, identity fallback, and schedules', async () => {
    installApiFetch();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);

    expect(wrapper.text()).toContain(accountFixture.name);
    expect(wrapper.text()).toContain(friendFixture.displayName);
    expect(wrapper.text()).toContain('shortId');
    expect(wrapper.text()).toContain('DISABLED');
    expect(wrapper.text()).toContain('09:00–10:30');
    expect(wrapper.text()).toContain('30 sec');
    expect(
      wrapper.findAll('button').some((button) => /edit|delete|send|resolve/i.test(button.text())),
    ).toBe(false);
    wrapper.unmount();
  });

  it('renders a clear entity not-found state', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/accounts/${ACCOUNT_ID}`
        ? failure('ACCOUNT_NOT_FOUND', 'Internal account lookup failed.', 404)
        : undefined,
    );
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}`);

    expect(wrapper.text()).toContain('Account not found');
    expect(wrapper.text()).toContain('This account is not available.');
    expect(wrapper.text()).not.toContain('Internal account lookup failed.');
    wrapper.unmount();
  });
});
