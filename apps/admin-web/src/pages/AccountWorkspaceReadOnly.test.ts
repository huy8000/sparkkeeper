import { describe, expect, it } from 'vitest';

import { ACCOUNT_ID } from '../test/fixtures';
import { installApiFetch } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Account Workspace read-only navigation', () => {
  it('performs no mutation during ordinary loading across all five tabs', async () => {
    const fetchMock = installApiFetch();
    for (const tab of ['overview', 'friends', 'schedule', 'manual-run', 'history']) {
      const wrapper = await mountAdmin(`/accounts/${ACCOUNT_ID}/${tab}`);
      wrapper.unmount();
    }
    const mutations = fetchMock.mock.calls.filter(([, init]) =>
      ['POST', 'PATCH', 'PUT'].includes(init?.method ?? 'GET'),
    );
    expect(mutations).toHaveLength(0);
  });
});
