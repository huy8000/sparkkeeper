import { flushPromises } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_ID, accountFixture } from '../test/fixtures';
import { installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import AccountContactsPage from './AccountContactsPage.vue';
const runId = '00000000-0000-4000-8000-000000000044',
  contactId = '00000000-0000-4000-8000-000000000045';
const date = '2026-10-01T00:00:00.000Z';
const contact = {
  id: contactId,
  accountId: ACCOUNT_ID,
  type: 'PERSON',
  displayName: 'Same name',
  remarkName: null,
  avatarAssetId: null,
  streakDays: null,
  streakUpdatedAt: null,
  availabilityStatus: 'STALE',
  identityStatus: 'CHANGED',
  createdAt: date,
  updatedAt: date,
  lastSeenAt: date,
  discoveredAt: date,
};
const sync = {
  id: runId,
  accountId: ACCOUNT_ID,
  status: 'PARTIAL',
  isComplete: false,
  candidateCount: 1,
  createdCount: 0,
  updatedCount: 1,
  staleCount: 0,
  unavailableCount: 0,
  issueCount: 0,
  failureCode: 'DISCOVERY_STALLED',
  createdAt: date,
  startedAt: date,
  finishedAt: date,
};
describe('V4-4 minimal Contact UI', () => {
  it('read-only list/detail/filter, partial warning, placeholder; starts only on click', async () => {
    const fetch = installApiFetch((url, init) => {
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}`)
        return success({
          ...accountFixture,
          profileState: 'READY',
          lifecycleStatus: 'ACTIVE',
          loginStatus: 'READY',
        });
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}/contacts`)
        return success({ items: [contact], nextCursor: null, latestSync: sync });
      if (url.pathname === `/api/contacts/${contactId}`)
        return success({
          ...contact,
          identities: [],
          identityReady: false,
          discoveryEligibilityReason: 'IDENTITY_REVIEW_REQUIRED',
        });
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}/contact-syncs` && init?.method === 'POST')
        return success({ syncRunId: runId, status: 'PARTIAL' }, 202);
      if (url.pathname === `/api/contact-syncs/${runId}`) return success(sync);
      return undefined;
    });
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/contacts`);
    expect(wrapper.text()).toContain('Same name');
    expect(wrapper.text()).toContain('CHANGED');
    expect(wrapper.text()).toMatch(/Partial|部分/);
    expect(wrapper.find('img').exists()).toBe(false);
    expect(fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
    const name = wrapper.findAll('button').find((b) => b.text() === 'Same name')!;
    await name.trigger('click');
    await flushPromises();
    expect(document.body.textContent).toMatch(/permission|授权/);
    await wrapper.findComponent(AccountContactsPage).get('select').setValue('GROUP');
    await flushPromises();
    expect(fetch.mock.calls.some(([u]) => String(u).includes('type=GROUP'))).toBe(true);
    const button = wrapper.get('[data-testid="sync"]');
    await button.trigger('click');
    await button.trigger('click');
    await flushPromises();
    const starts = fetch.mock.calls.filter(
      ([u, i]) => String(u).endsWith('/contact-syncs') && i?.method === 'POST',
    );
    expect(starts).toHaveLength(1);
    expect(JSON.parse(String(starts[0]![1]?.body))).toEqual({});
    expect((starts[0]![1]?.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^[0-9a-f-]{36}$/iu,
    );
    expect(wrapper.find('input[name="identity"]').exists()).toBe(false);
    wrapper.unmount();
  });
  it('uncertain start has no automatic POST retry and explicit retry retains key', async () => {
    let tries = 0;
    const fetch = installApiFetch((url, init) => {
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}`)
        return success({
          ...accountFixture,
          profileState: 'READY',
          lifecycleStatus: 'ACTIVE',
          loginStatus: 'READY',
        });
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}/contacts`)
        return success({ items: [], nextCursor: null, latestSync: null });
      if (url.pathname === `/api/accounts/${ACCOUNT_ID}/contact-syncs` && init?.method === 'POST') {
        if (++tries === 1) throw new TypeError('fixture network failure');
        return success({ syncRunId: runId, status: 'PARTIAL' }, 202);
      }
      if (url.pathname === `/api/contact-syncs/${runId}`) return success(sync);
      return undefined;
    });
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/contacts`);
    await wrapper.get('[data-testid="sync"]').trigger('click');
    await flushPromises();
    expect(tries).toBe(1);
    expect(wrapper.text()).toMatch(/uncertain|不确定/);
    await wrapper.get('[data-testid="sync"]').trigger('click');
    await flushPromises();
    expect(tries).toBe(2);
    const starts = fetch.mock.calls.filter(
      ([u, i]) => String(u).endsWith('/contact-syncs') && i?.method === 'POST',
    );
    expect((starts[0]![1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      (starts[1]![1]?.headers as Record<string, string>)['Idempotency-Key'],
    );
    wrapper.unmount();
  });
});
