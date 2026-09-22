import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID } from '../test/fixtures';
import { installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

const SESSION_ID = '00000000-0000-4000-8000-000000000010';
const CREATED_AT = '2030-01-01T00:00:00.000Z';
const EXPIRES_AT = '2099-01-01T00:15:00.000Z';

function session(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    purpose: 'ADD_ACCOUNT',
    accountId: null,
    status,
    expiresAt: EXPIRES_AT,
    startedAt: CREATED_AT,
    readyDetectedAt: null,
    completedAt: null,
    updatedAt: CREATED_AT,
    consoleAvailable: status === 'AWAITING_USER',
    cancellable: status === 'AWAITING_USER',
    failureCode: null,
    resultAccountId: null,
    ...overrides,
  };
}

describe('V4-3 Account login UI', () => {
  it('starts ADD only on click with one idempotency key and no manual Account form', async () => {
    const fetchMock = installApiFetch((url, init) => {
      if (url.pathname === '/api/account-login-sessions' && init?.method === 'POST') {
        return success(
          {
            session: session('STARTING', { consoleAvailable: false, cancellable: true }),
            consolePath: `/api/account-login-sessions/${SESSION_ID}/console`,
          },
          202,
        );
      }
      if (url.pathname === `/api/account-login-sessions/${SESSION_ID}`) {
        return success(session('STARTING', { consoleAvailable: false, cancellable: true }));
      }
      return undefined;
    });
    const wrapper = await mountAdmin('/accounts');
    expect(wrapper.text()).not.toContain('Create account');
    expect(wrapper.find('input[name="accountName"]').exists()).toBe(false);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => String(url).endsWith('/api/account-login-sessions') && true,
      ),
    ).toHaveLength(0);

    await wrapper.get('button.button--primary').trigger('click');
    await flushPromises();
    const calls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/api/account-login-sessions') && init?.method === 'POST',
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({ purpose: 'ADD_ACCOUNT' });
    expect((calls[0]![1]?.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
    expect(window.location.pathname).toBe(`/account-login-sessions/${SESSION_ID}`);
    wrapper.unmount();
  });

  it('restores an owned active flow after Accounts page reload', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/account-login-sessions/active'
        ? success({ session: session('AWAITING_USER') })
        : undefined,
    );
    const wrapper = await mountAdmin('/accounts');
    expect(wrapper.text()).toContain('A login flow is already active.');
    expect(wrapper.get(`a[href="/account-login-sessions/${SESSION_ID}"]`).text()).toContain(
      'View login session',
    );
    expect((wrapper.get('button.button--primary').element as HTMLButtonElement).disabled).toBe(
      true,
    );
    wrapper.unmount();
  });

  it('shows the protected console link and submits one CAS cancel', async () => {
    const fetchMock = installApiFetch((url, init) => {
      if (url.pathname === `/api/account-login-sessions/${SESSION_ID}` && init?.method === 'GET') {
        return success(session('AWAITING_USER'));
      }
      if (url.pathname === `/api/account-login-sessions/${SESSION_ID}/cancel`) {
        return success(session('CANCELLED', { cancellable: false, consoleAvailable: false }));
      }
      return undefined;
    });
    const wrapper = await mountAdmin(`/account-login-sessions/${SESSION_ID}`);
    expect(
      wrapper
        .get(`a[href="/api/account-login-sessions/${SESSION_ID}/console"]`)
        .attributes('target'),
    ).toBe('_blank');
    expect(wrapper.text()).toContain('Waiting for manual login');

    const cancel = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Cancel login'))!;
    await cancel.trigger('click');
    await flushPromises();

    const calls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/cancel') && init?.method === 'POST',
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({ expectedUpdatedAt: CREATED_AT });
    expect(wrapper.text()).toContain('Cancelled');
    expect(
      wrapper.find(`a[href="/api/account-login-sessions/${SESSION_ID}/console"]`).exists(),
    ).toBe(false);
    wrapper.unmount();
  });

  it('starts RELOGIN only for the explicit Account and never submits identity or a path', async () => {
    const fetchMock = installApiFetch((url, init) => {
      if (url.pathname === '/api/account-login-sessions' && init?.method === 'POST') {
        return success(
          {
            session: session('STARTING', { purpose: 'RELOGIN', accountId: ACCOUNT_ID }),
            consolePath: `/api/account-login-sessions/${SESSION_ID}/console`,
          },
          202,
        );
      }
      if (url.pathname === `/api/account-login-sessions/${SESSION_ID}`) {
        return success(session('STARTING', { purpose: 'RELOGIN', accountId: ACCOUNT_ID }));
      }
      return undefined;
    });
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/overview`);
    const relogin = wrapper.findAll('button').find((button) => button.text().includes('Relogin'))!;
    await relogin.trigger('click');
    await flushPromises();

    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/api/account-login-sessions') && init?.method === 'POST',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      purpose: 'RELOGIN',
      accountId: ACCOUNT_ID,
    });
    expect(String(call?.[1]?.body)).not.toMatch(/profile|identity|cookie|token/i);
    wrapper.unmount();
  });
});
