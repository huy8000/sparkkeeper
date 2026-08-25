import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FriendIdentityError,
  normalizeFriendIdentity,
  selectFriendMatch,
  type FriendMatchField,
} from '../src/index.js';

test('normalization trims identity values and converts optional blanks to null', () => {
  assert.deepEqual(
    normalizeFriendIdentity({
      displayName: '  Test User  ',
      remarkName: '  Test Remark ',
      shortId: '   ',
      uniqueId: null,
    }),
    {
      displayName: 'Test User',
      remarkName: 'Test Remark',
      shortId: null,
      uniqueId: null,
      secUid: null,
    },
  );
});

test('normalization rejects an empty displayName', () => {
  assert.throws(
    () => normalizeFriendIdentity({ displayName: '   ' }),
    (error: unknown) => {
      assert.ok(error instanceof FriendIdentityError);
      assert.match(error.message, /displayName must not be empty/);
      return true;
    },
  );
});

test('displayName is selected when it is the only identity', () => {
  const identity = normalizeFriendIdentity({ displayName: 'Test User' });
  assert.deepEqual(selectFriendMatch(identity), { field: 'displayName', key: 'Test User' });
});

test('remarkName is preferred over displayName', () => {
  const identity = normalizeFriendIdentity({
    displayName: 'Test User',
    remarkName: 'Test Remark',
  });
  assert.deepEqual(selectFriendMatch(identity), { field: 'remarkName', key: 'Test Remark' });
});

test('shortId is preferred over remarkName', () => {
  const identity = normalizeFriendIdentity({
    displayName: 'Test User',
    remarkName: 'Test Remark',
    shortId: 'short-test-id',
  });
  assert.deepEqual(selectFriendMatch(identity), { field: 'shortId', key: 'short-test-id' });
});

test('uniqueId is preferred over shortId', () => {
  const identity = normalizeFriendIdentity({
    displayName: 'Test User',
    shortId: 'short-test-id',
    uniqueId: 'unique-test-id',
  });
  assert.deepEqual(selectFriendMatch(identity), { field: 'uniqueId', key: 'unique-test-id' });
});

test('secUid is preferred over uniqueId', () => {
  const identity = normalizeFriendIdentity({
    displayName: 'Test User',
    uniqueId: 'unique-test-id',
    secUid: 'secure-test-id',
  });
  assert.deepEqual(selectFriendMatch(identity), { field: 'secUid', key: 'secure-test-id' });
});

test('an explicit available match field derives its normalized key', () => {
  const identity = normalizeFriendIdentity({
    displayName: ' Test User ',
    uniqueId: ' unique-test-id ',
  });
  assert.deepEqual(selectFriendMatch(identity, 'displayName'), {
    field: 'displayName',
    key: 'Test User',
  });
});

test('an unavailable or unsupported explicit match field is rejected', () => {
  const identity = normalizeFriendIdentity({ displayName: 'Test User' });
  assert.throws(() => selectFriendMatch(identity, 'secUid'), FriendIdentityError);
  assert.throws(
    () => selectFriendMatch(identity, 'unsupported' as FriendMatchField),
    FriendIdentityError,
  );
});
