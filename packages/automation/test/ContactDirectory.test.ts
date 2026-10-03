import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectContactDirectory,
  parseDirectoryRow,
  type DirectorySource,
  type DirectoryWindow,
} from '../src/douyin/DouyinContactDirectory.js';
const candidate = (uid: string) => ({
  type: 'PERSON',
  displayName: 'same',
  remarkName: null,
  identities: { SEC_UID: uid },
  avatarRemoteUrl: null,
  streakDays: null,
  observedAt: 1,
  adapterVersion: 'offline-v1',
});
test('allowlisted row projection preserves opaque IDs; names never substitute for identity', () => {
  const row = { title: 'Same name', type: 'PERSON', shortId: '00123', profileLinks: [] };
  assert.equal(parseDirectoryRow(row, 1).identities.SHORT_ID, '00123');
  assert.equal(
    parseDirectoryRow({ ...row, secUid: 'CaseSensitive', profileLinks: ['/user/CaseSensitive'] }, 1)
      .identities.SEC_UID,
    'CaseSensitive',
  );
  assert.throws(() => parseDirectoryRow({ ...row, shortId: null }, 1));
  assert.throws(() => parseDirectoryRow({ ...row, secUid: 'a', profileLinks: ['/user/b'] }, 1));
  assert.throws(() =>
    parseDirectoryRow({ ...row, profileLinks: ['https://evil.invalid/user/a'] }, 1),
  );
  assert.throws(() => parseDirectoryRow({ ...row, title: 'x'.repeat(201) }, 1));
  assert.throws(() => parseDirectoryRow({ ...row, shortId: 'x'.repeat(513) }, 1));
  assert.throws(() => parseDirectoryRow({ ...row, type: 'invented' }, 1));
  const group = parseDirectoryRow(
    {
      ...row,
      type: 'GROUP',
      conversationId: 'group-01',
      secUid: 'member',
      profileLinks: ['/user/member'],
    },
    1,
  );
  assert.deepEqual(group.identities, { CONVERSATION_ID: 'group-01' });
  assert.equal(
    parseDirectoryRow(
      { title: 'Unknown', type: null, conversationId: 'opaque', profileLinks: [] },
      1,
    ).type,
    'UNKNOWN',
  );
});
function source(
  windows: Partial<DirectoryWindow>[],
  auth: 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN' = 'READY',
  verified = true,
): DirectorySource {
  let index = 0;
  return {
    reset: async () => {
      index = 0;
    },
    window: async () => ({
      rows: [],
      issues: 0,
      signature: 'fixture',
      loading: false,
      end: false,
      empty: false,
      contiguous: true,
      ...windows[index],
    }),
    advance: async () => ++index < windows.length,
    verifyBoundary: async () => verified,
    auth: async () => auth,
  };
}
test('directory explicit end across windows and empty contract', async () => {
  assert.equal(
    (
      await collectContactDirectory(
        source([{ rows: [candidate('a')] }, { rows: [candidate('b')], end: true }]),
        100,
        () => 1,
      )
    ).status,
    'COMPLETE',
  );
  assert.equal(
    (await collectContactDirectory(source([{ empty: true }]), 100, () => 1)).status,
    'COMPLETE',
  );
});
test('scroll bottom/no progress never complete; loading/reorder/parser failures fail closed', async () => {
  assert.equal(
    (await collectContactDirectory(source([{ rows: [candidate('a')] }]), 100, () => 1)).status,
    'PARTIAL',
  );
  assert.equal(
    (await collectContactDirectory(source([{ loading: true }]), 100, () => 1)).status,
    'FAILED',
  );
  assert.equal(
    (
      await collectContactDirectory(
        source([{ rows: [candidate('a')], end: true }], 'READY', false),
        100,
        () => 1,
      )
    ).status,
    'PARTIAL',
  );
  const result = await collectContactDirectory(
    source([{ rows: [candidate('a'), { ...candidate('x'), identities: {} }], end: true }]),
    100,
    () => 1,
  );
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.issueCount, 1);
});
test('500 observation/deadline bounds and auth failure discard partial observations', async () => {
  assert.equal(
    (
      await collectContactDirectory(
        source([{ rows: Array.from({ length: 501 }, () => candidate('a')), end: true }]),
        100,
        () => 1,
      )
    ).failureCode,
    'CANDIDATE_LIMIT_REACHED',
  );
  assert.equal(
    (await collectContactDirectory(source([{}]), 1, () => 2)).failureCode,
    'DISCOVERY_TIMEOUT',
  );
  const expired = await collectContactDirectory(
    source([{ rows: [candidate('a')] }], 'AUTH_EXPIRED'),
    100,
    () => 1,
  );
  assert.equal(expired.status, 'AUTH_EXPIRED');
  assert.deepEqual(expired.observations, []);
});
