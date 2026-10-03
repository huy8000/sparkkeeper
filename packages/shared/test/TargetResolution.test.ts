import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freezeResolverRequest,
  normalizeResolverIdentifier,
  sameResolverRequest,
  supportedResolverKind,
  targetResolutionFailure,
  type ResolverRequest,
} from '../src/index.js';
test('resolver identifiers preserve case/leading zeros and reject unsafe or oversized evidence', () => {
  assert.equal(normalizeResolverIdentifier('  AbC001  '), 'AbC001');
  for (const value of ['', 'x\n', 'a\u200bb', 'x'.repeat(257), null])
    assert.equal(normalizeResolverIdentifier(value), null);
  assert.equal(supportedResolverKind('PERSON', 'DISPLAY_NAME'), false);
  assert.equal(supportedResolverKind('GROUP', 'SEC_UID'), false);
  assert.equal(supportedResolverKind('GROUP', 'CONVERSATION_ID'), true);
});
test('safe failure classification follows facts, not exception text', () => {
  assert.deepEqual(targetResolutionFailure('TARGET_NOT_FOUND'), {
    status: 'NOT_FOUND',
    reason: 'TARGET_NOT_FOUND',
  });
  assert.deepEqual(targetResolutionFailure('BROWSER_FAILURE'), {
    status: 'FAILED',
    reason: 'BROWSER_FAILURE',
  });
  assert.deepEqual(targetResolutionFailure('DIRECTORY_INCOMPLETE'), {
    status: 'UNVERIFIABLE',
    reason: 'DIRECTORY_INCOMPLETE',
  });
});
test('request freezes its one identity and equality covers contents, not just timestamp', () => {
  const input: ResolverRequest = {
    accountId: 'fixture-account',
    contactId: 'fixture-contact',
    contactType: 'PERSON',
    preferredIdentity: {
      id: 'fixture-identity',
      kind: 'SEC_UID',
      normalizedValue: 'Fixture-001',
      observedAt: 1000,
    },
    expectedMetadataVersion: 'private-version',
  };
  const frozen = freezeResolverRequest(input);
  assert.ok(Object.isFrozen(frozen.preferredIdentity));
  assert.equal(sameResolverRequest(input, frozen), true);
  assert.equal(
    sameResolverRequest(frozen, {
      ...input,
      preferredIdentity: { ...input.preferredIdentity, id: 'new-fixture-identity' },
    }),
    false,
  );
});
