import { flushPromises } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import { ACCOUNT_ID, TEMPLATE_ID } from '../test/fixtures';
import { installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { parseTestPreview, parseTestDetail } from '../api/testSendApi';
import AccountTestSendPage from './AccountTestSendPage.vue';
const contactId = '00000000-0000-4000-8000-000000000071',
  intentId = '00000000-0000-4000-8000-000000000072',
  runId = '00000000-0000-4000-8000-000000000073';
const date = '2026-10-03T00:00:00.000Z';
const preview = {
  intentId,
  expiresAt: '2099-10-03T00:00:00.000Z',
  payloadDigest: 'a'.repeat(64),
  account: { id: ACCOUNT_ID, name: 'Synthetic account' },
  templateSummary: { id: TEMPLATE_ID, name: 'Synthetic template', providerType: 'STATIC' },
  orderedTargets: [
    { id: contactId, displayName: '<script>Synthetic target</script>', type: 'PERSON' },
  ],
  warnings: ['NO_AUTOMATIC_RETRY'],
};
const detail = {
  runId,
  kind: 'TEST_SEND',
  status: 'DELIVERY_UNKNOWN',
  accountId: ACCOUNT_ID,
  confirmedAt: date,
  finishedAt: date,
  record: {
    id: intentId,
    contactId,
    machineStatus: 'DELIVERY_UNKNOWN',
    failureCode: 'DELIVERY_VERIFICATION_TIMEOUT',
    attemptCount: 1,
    sendActionStartedAt: date,
    sentAt: null,
  },
};
function install(uncertain = false) {
  let confirms = 0;
  const fetch = installApiFetch((url, init) => {
    if (url.pathname === `/api/accounts/${ACCOUNT_ID}/contacts`)
      return success({
        items: [
          {
            id: contactId,
            accountId: ACCOUNT_ID,
            type: 'PERSON',
            displayName: 'Synthetic target',
            remarkName: null,
            avatarAssetId: null,
            streakDays: null,
            streakUpdatedAt: null,
            availabilityStatus: 'AVAILABLE',
            identityStatus: 'READY',
            createdAt: date,
            updatedAt: date,
            discoveredAt: date,
            lastSeenAt: date,
          },
        ],
        nextCursor: null,
        latestSync: null,
      });
    if (url.pathname.endsWith('/test-send-intents')) return success(preview, 201);
    if (url.pathname.endsWith('/test-sends') && init?.method === 'POST') {
      confirms++;
      if (uncertain && confirms === 1) throw new TypeError('synthetic network interruption');
      return success({ runId, status: 'DELIVERY_UNKNOWN' }, 202);
    }
    if (url.pathname === `/api/test-sends/${runId}`) return success(detail);
    return undefined;
  });
  return fetch;
}
describe('V4-7 single-target UI', () => {
  it('requires preview and explicit confirmation; one POST despite double click; detail is read-only', async () => {
    const fetch = install();
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/test-send`);
    expect(fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
    await wrapper.findComponent(AccountTestSendPage).findAll('select')[0]!.setValue(contactId);
    await wrapper.findComponent(AccountTestSendPage).findAll('select')[1]!.setValue(TEMPLATE_ID);
    await wrapper.get('[data-testid="preview"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="confirm"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('<script>Synthetic target</script>');
    expect(wrapper.find('script').exists()).toBe(false);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await flushPromises();
    const starts = fetch.mock.calls.filter(
      ([u, i]) => String(u).endsWith('/test-sends') && i?.method === 'POST',
    );
    expect(starts).toHaveLength(1);
    expect(JSON.parse(String(starts[0]![1]!.body))).toEqual({
      intentId,
      payloadDigest: preview.payloadDigest,
      confirm: true,
    });
    expect(wrapper.text()).toContain('DELIVERY_UNKNOWN');
    await wrapper.vm.$router.push(`/test-sends/${runId}`);
    await flushPromises();
    expect(wrapper.text()).toContain('DELIVERY_UNKNOWN');
    expect(fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(2);
  });
  it('network uncertainty never auto-retries; explicit canonical check retains original key and intent', async () => {
    const fetch = install(true);
    const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/test-send`);
    await wrapper.findComponent(AccountTestSendPage).findAll('select')[0]!.setValue(contactId);
    await wrapper.findComponent(AccountTestSendPage).findAll('select')[1]!.setValue(TEMPLATE_ID);
    await wrapper.get('[data-testid="preview"]').trigger('click');
    await flushPromises();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('[data-testid="confirm"]').trigger('click');
    await flushPromises();
    const count = () =>
      fetch.mock.calls.filter(
        ([u, i]) => String(u).endsWith('/test-sends') && i?.method === 'POST',
      );
    expect(count()).toHaveLength(1);
    await flushPromises();
    expect(count()).toHaveLength(1);
    expect(wrapper.get('[data-testid="confirm"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="reconcile"]').trigger('click');
    await flushPromises();
    expect(count()).toHaveLength(2);
    expect(new Headers(count()[0]![1]!.headers).get('Idempotency-Key')).toBe(
      new Headers(count()[1]![1]!.headers).get('Idempotency-Key'),
    );
    expect(count()[0]![1]!.body).toBe(count()[1]![1]!.body);
  });
  it('malformed/multi-target preview and retry attempts fail DTO parsing', () => {
    expect(parseTestPreview(preview)).toBeDefined();
    expect(
      parseTestPreview({
        ...preview,
        orderedTargets: [...preview.orderedTargets, ...preview.orderedTargets],
      }),
    ).toBeUndefined();
    expect(parseTestDetail(detail)).toBeDefined();
    expect(
      parseTestDetail({ ...detail, record: { ...detail.record, attemptCount: 2 } }),
    ).toBeUndefined();
  });
});
