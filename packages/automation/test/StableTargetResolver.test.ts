import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import test from 'node:test';
import { targetResolutionFailure } from '@sparkkeeper/shared';
import { PersonResolver } from '../src/douyin/resolver/PersonResolver.js';
import { GroupResolver } from '../src/douyin/resolver/GroupResolver.js';
import type { ResolutionWitness } from '../src/douyin/resolver/ResolutionWitness.js';
import { FixtureDirectory, request, row, window } from './resolverFixture.js';

test('late duplicate after first match is ambiguous, repeated same anchor is not', async () => {
  const f = new FixtureDirectory([
    window([row()], { end: false }),
    window([row('synthetic-chat-2')]),
  ]);
  assert.deepEqual(await f.resolver().resolve(request(), Date.now() + 1000), {
    status: 'AMBIGUOUS',
    reason: 'TARGET_AMBIGUOUS',
  });
  assert.equal(f.reads, 2);
  assert.equal(f.opens, 0);
  const repeated = new FixtureDirectory([window([row()], { end: false }), window([row()])]);
  const resolver = repeated.resolver(),
    found = await resolver.resolve(request(), Date.now() + 1000);
  assert.equal(found.status, 'FOUND');
  if (found.status === 'FOUND') resolver.discard(found.candidate);
});
test('NOT_FOUND requires complete preferred-field coverage, not bottom/stall or first viewport', async () => {
  const full = new FixtureDirectory([window([])]);
  assert.equal((await full.resolver().resolve(request(), Date.now() + 1000)).status, 'NOT_FOUND');
  for (const view of [
    window([], { end: false, empty: false }),
    window([row()], { coverage: 'UNPROVEN' }),
    window([row()], { contiguous: false }),
    window([row()], { loading: true }),
    window([{ ...row(), identities: { UNIQUE_ID: 'Fixture-001' } }]),
  ]) {
    const f = new FixtureDirectory([view]);
    const result = await f.resolver().resolve(request(), Date.now() + 1000);
    assert.ok(result.status === 'UNVERIFIABLE' || result.status === 'UNAVAILABLE');
    assert.equal(f.opens, 0);
  }
});
test('matching is exact preferred kind; names/index cannot substitute or case-fold', async () => {
  const f = new FixtureDirectory([window([row('chat-x', 'fixture-001')])]);
  assert.equal((await f.resolver().resolve(request(), Date.now() + 1000)).status, 'NOT_FOUND');
  const named = new FixtureDirectory();
  assert.equal(
    (
      await named
        .resolver()
        .resolve(
          request({ preferredIdentity: { ...request().preferredIdentity, kind: 'DISPLAY_NAME' } }),
          Date.now() + 1000,
        )
    ).status,
    'UNAVAILABLE',
  );
  assert.equal(named.reads, 0);
  const absentAnchor = new FixtureDirectory([window([{ ...row(), anchor: null }])]);
  assert.equal(
    (await absentAnchor.resolver().resolve(request(), Date.now() + 1000)).status,
    'UNVERIFIABLE',
  );
});
test('directory drift/unknown type and reused mutable projection fail closed', async () => {
  const f = new FixtureDirectory([
    window([row()], { end: false }),
    window([row()], { epoch: 'changed' }),
  ]);
  assert.equal((await f.resolver().resolve(request(), Date.now() + 1000)).status, 'UNVERIFIABLE');
  const unknown = new FixtureDirectory([window([{ ...row(), type: 'UNKNOWN' }])]);
  assert.equal(
    (await unknown.resolver().resolve(request(), Date.now() + 1000)).status,
    'UNVERIFIABLE',
  );
  const shared = { ...row(), identities: { ...row().identities } };
  const reused = new FixtureDirectory([window([shared], { end: false }), window([shared])]);
  reused.afterRead = () => {
    if (reused.reads === 2) shared.identities.SEC_UID = 'Changed-fixture';
  };
  assert.equal(
    (await reused.resolver().resolve(request(), Date.now() + 1000)).status,
    'IDENTITY_CHANGED',
  );
});
test('typed group resolver requires its own conversationId, never member identity', async () => {
  const groupRequest = request({
    contactType: 'GROUP',
    preferredIdentity: {
      ...request().preferredIdentity,
      kind: 'CONVERSATION_ID',
      normalizedValue: 'group-001',
    },
  });
  const f = new FixtureDirectory([window([row('group-001', 'ignored', 'GROUP')])]),
    resolver = f.resolver();
  const found = await new GroupResolver(resolver).resolve(groupRequest, Date.now() + 1000);
  assert.equal(found.status, 'FOUND');
  if (found.status === 'FOUND') {
    const result = await resolver.openAndVerify(found.candidate, groupRequest);
    assert.equal(result.status, 'VERIFIED');
  }
  assert.equal(
    (await new PersonResolver(f.resolver()).resolve(groupRequest, Date.now() + 1000)).status,
    'UNAVAILABLE',
  );
  const memberOnly = new FixtureDirectory([
    window([{ anchor: 'group-001', type: 'GROUP', identities: { SEC_UID: 'group-001' } }]),
  ]);
  assert.equal(
    (await memberOnly.resolver().resolve(groupRequest, Date.now() + 1000)).status,
    'UNAVAILABLE',
  );
});
test('a stable anchor with conflicting target/non-target type cannot certify a match', async () => {
  for (const rows of [
    [row(), row('synthetic-chat-1', 'ignored', 'GROUP')],
    [row('synthetic-chat-1', 'ignored', 'GROUP'), row()],
  ]) {
    const f = new FixtureDirectory([window(rows)]);
    assert.equal(
      (await f.resolver().resolve(request(), Date.now() + 1000)).status,
      'IDENTITY_CHANGED',
    );
    assert.equal(f.opens, 0);
  }
});
test('one-shot open reacquires anchor and rejects vanished/drifted controls', async () => {
  for (const replacement of [[], [row('synthetic-chat-1', 'changed')], [row(), row()]]) {
    const f = new FixtureDirectory(),
      resolver = f.resolver(),
      found = await resolver.resolve(request(), Date.now() + 1000);
    assert.equal(found.status, 'FOUND');
    if (found.status !== 'FOUND') throw new Error('fixture not found');
    f.views = [window(replacement)];
    assert.notEqual((await resolver.openAndVerify(found.candidate, request())).status, 'VERIFIED');
    assert.equal(f.opens, 0);
    assert.notEqual((await resolver.openAndVerify(found.candidate, request())).status, 'VERIFIED');
  }
});
test('witness is opaque, page-bound, expires and cannot survive chat switch or forging', async () => {
  const f = new FixtureDirectory(),
    resolver = f.resolver(),
    found = await resolver.resolve(request(), Date.now() + 1000);
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  const result = await resolver.openAndVerify(found.candidate, request());
  assert.equal(result.status, 'VERIFIED');
  assert.equal(f.opens, 1);
  if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
  assert.equal(await resolver.revalidate(result.witness), null);
  assert.equal(JSON.stringify(result), '{"status":"VERIFIED"}');
  assert.equal(inspect(result.witness), '[ResolutionWitness]');
  assert.equal(Object.keys(result.witness).length, 0);
  assert.notEqual(await resolver.revalidate({} as ResolutionWitness), null);
  f.state = { ...f.state, selectionRevision: f.state.selectionRevision + 1 };
  assert.equal((await resolver.revalidate(result.witness))?.status, 'IDENTITY_CHANGED');
  f.state = { ...f.state, selectionRevision: f.state.selectionRevision - 1 };
  assert.notEqual(await resolver.revalidate(result.witness), null);
});
test('page replacement, new resolution, ownership/auth loss invalidate witness', async () => {
  for (const change of ['page', 'new-resolution', 'owner', 'auth', 'directory'] as const) {
    const f = new FixtureDirectory(),
      resolver = f.resolver(),
      found = await resolver.resolve(request(), Date.now() + 1000);
    if (found.status !== 'FOUND') throw new Error('fixture not found');
    const result = await resolver.openAndVerify(found.candidate, request());
    if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
    if (change === 'page') f.state = { ...f.state, page: {} };
    if (change === 'owner') f.owned = false;
    if (change === 'auth') f.authFailure = targetResolutionFailure('AUTH_EXPIRED');
    if (change === 'directory') f.certified = false;
    if (change === 'new-resolution') {
      const next = await resolver.resolve(request(), Date.now() + 1000);
      if (next.status === 'FOUND') resolver.discard(next.candidate);
    }
    assert.notEqual(await resolver.revalidate(result.witness), null);
  }
});
test('one active page flow; discarded/failed invocation does not hold a resolver lock', async () => {
  const f = new FixtureDirectory(),
    first = f.resolver(),
    found = await first.resolve(request(), Date.now() + 1000);
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  assert.equal((await f.resolver().resolve(request(), Date.now() + 1000)).status, 'FAILED');
  first.discard(found.candidate);
  const next = f.resolver(),
    ready = await next.resolve(request(), Date.now() + 1000);
  assert.equal(ready.status, 'FOUND');
  if (ready.status === 'FOUND') next.discard(ready.candidate);
});
test('overall deadline bounds hung read and observation cap; no late navigation', async () => {
  const hung = new FixtureDirectory();
  hung.readWindow = () => new Promise(() => {});
  const result = await hung.resolver().resolve(request(), Date.now() + 30);
  assert.equal(result.status, 'UNVERIFIABLE');
  assert.equal(hung.opens, 0);
  const huge = new FixtureDirectory([
    window(Array.from({ length: 501 }, (_, i) => row(`chat-${i}`, `user-${i}`))),
  ]);
  assert.equal(
    (await huge.resolver().resolve(request(), Date.now() + 1000)).status,
    'UNVERIFIABLE',
  );
  assert.equal(huge.opens, 0);
});
test('verified witness expires under the original operation budget and never revives', async () => {
  const f = new FixtureDirectory(),
    resolver = f.resolver(),
    found = await resolver.resolve(request(), Date.now() + 250);
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  const result = await resolver.openAndVerify(found.candidate, request());
  if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
  assert.equal(await resolver.revalidate(result.witness), null);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(await resolver.revalidate(result.witness), {
    status: 'FAILED',
    reason: 'RESOLUTION_TIMEOUT',
  });
  assert.notEqual(await resolver.revalidate(result.witness), null);
  assert.equal(f.opens, 1);
});
test('directory changing during final auth or header observation cannot retain NOT_FOUND/VERIFIED', async () => {
  const missing = new FixtureDirectory([window([])]),
    auth = missing.auth.bind(missing);
  missing.auth = async (...args) => {
    if (missing.reads) missing.certified = false;
    return auth(...args);
  };
  assert.equal(
    (await missing.resolver().resolve(request(), Date.now() + 1000)).status,
    'UNVERIFIABLE',
  );
  assert.equal(missing.opens, 0);
  const f = new FixtureDirectory(),
    resolver = f.resolver(),
    found = await resolver.resolve(request(), Date.now() + 1000);
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  const current = f.currentConversation.bind(f);
  f.currentConversation = async (...args) => {
    const candidate = await current(...args);
    f.certified = false;
    return candidate;
  };
  assert.notEqual((await resolver.openAndVerify(found.candidate, request())).status, 'VERIFIED');
});
test('a readiness port cannot fabricate NOT_FOUND without scanning', async () => {
  const f = new FixtureDirectory();
  f.authFailure = targetResolutionFailure('TARGET_NOT_FOUND');
  assert.deepEqual(await f.resolver().resolve(request(), Date.now() + 1000), {
    status: 'FAILED',
    reason: 'BROWSER_FAILURE',
  });
  assert.equal(f.reads, 0);
  assert.equal(f.opens, 0);
});
test('chat mutation during the final asynchronous owner check invalidates the witness', async () => {
  const f = new FixtureDirectory(),
    resolver = f.resolver();
  const found = await resolver.resolve(request(), Date.now() + 1000);
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  const result = await resolver.openAndVerify(found.candidate, request());
  if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
  const assertOwned = f.owner.assertOwned.bind(f.owner);
  let checks = 0;
  f.owner.assertOwned = async () => {
    await assertOwned();
    if (++checks === 2) f.state = { ...f.state, selectionRevision: f.state.selectionRevision + 1 };
  };
  assert.deepEqual(await resolver.revalidate(result.witness), {
    status: 'IDENTITY_CHANGED',
    reason: 'IDENTITY_CHANGED',
  });
  assert.equal(f.opens, 1);
});
