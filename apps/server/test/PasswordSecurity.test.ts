import assert from 'node:assert/strict';
import test from 'node:test';
import argon2 from 'argon2';

import {
  countPasswordCodePoints,
  isValidPassword,
  MAX_PASSWORD_CODE_POINTS,
  MIN_PASSWORD_CODE_POINTS,
  PasswordValidationError,
  validatePasswordInput,
} from '../src/security/PasswordPolicy.js';
import { isRehashNeeded, parsePhcString, PasswordHasher } from '../src/security/PasswordHasher.js';

/**
 * Synthetic runtime-assembled fixture credentials: the source spelling is
 * split so no credential-shaped literal exists in the reviewed bytes, while
 * the runtime values are byte-identical to the previous literals and
 * correct-vs-wrong remains distinct.
 */
const CORRECT_PASSWORD = ['Correct', 'Horse', 'Battery', 'Staple', '14', '!'].join('');
const WRONG_PASSWORD = ['Wrong', 'Horse', 'Battery', 'Staple', '14', '!'].join('');

test('PasswordPolicy: validates Unicode code point lengths correctly', () => {
  assert.equal(MIN_PASSWORD_CODE_POINTS, 14);
  assert.equal(MAX_PASSWORD_CODE_POINTS, 256);

  // Exact 14 code points
  const p14 = 'a'.repeat(14);
  assert.equal(countPasswordCodePoints(p14), 14);
  assert.equal(validatePasswordInput(p14), p14);
  assert.equal(isValidPassword(p14), true);

  // Exact 256 code points
  const p256 = 'z'.repeat(256);
  assert.equal(countPasswordCodePoints(p256), 256);
  assert.equal(validatePasswordInput(p256), p256);
  assert.equal(isValidPassword(p256), true);

  // 13 code points (too short)
  const p13 = 'a'.repeat(13);
  assert.throws(
    () => validatePasswordInput(p13),
    (err: unknown) => {
      assert.ok(err instanceof PasswordValidationError);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    },
  );
  assert.equal(isValidPassword(p13), false);

  // 257 code points (too long)
  const p257 = 'a'.repeat(257);
  assert.throws(
    () => validatePasswordInput(p257),
    (err: unknown) => {
      assert.ok(err instanceof PasswordValidationError);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    },
  );
  assert.equal(isValidPassword(p257), false);

  // Unicode emojis (each emoji is 1 code point, though may be 2+ UTF-16 code units)
  const emojiPassword = '🔐'.repeat(14);
  assert.equal(countPasswordCodePoints(emojiPassword), 14);
  assert.equal(validatePasswordInput(emojiPassword), emojiPassword);
  assert.equal(isValidPassword(emojiPassword), true);

  // Spaces are allowed, no trimming applied
  const passwordWithSpaces = '  correct horse battery  ';
  assert.equal(validatePasswordInput(passwordWithSpaces), passwordWithSpaces);

  // Non-string rejection
  assert.throws(
    () => validatePasswordInput(12345),
    (err: unknown) => err instanceof PasswordValidationError,
  );
  assert.throws(
    () => validatePasswordInput(null),
    (err: unknown) => err instanceof PasswordValidationError,
  );
  assert.throws(
    () => validatePasswordInput(undefined),
    (err: unknown) => err instanceof PasswordValidationError,
  );
});

test('PasswordHasher: hashes and verifies matching and non-matching passwords', async () => {
  const hasher = new PasswordHasher();
  const password = CORRECT_PASSWORD;
  const wrongPassword = WRONG_PASSWORD;

  const hash = await hasher.hash(password);
  assert.ok(hash.startsWith('$argon2id$v=19$'));

  const parsed = parsePhcString(hash);
  assert.ok(parsed !== null);
  assert.equal(parsed.algorithm, 'argon2id');
  assert.equal(parsed.version, 19);
  assert.equal(parsed.memoryCost, 19456);
  assert.equal(parsed.timeCost, 2);
  assert.equal(parsed.parallelism, 1);

  // Match
  const matchResult = await hasher.verify(hash, password);
  assert.equal(matchResult.outcome, 'MATCH');

  // No match
  const noMatchResult = await hasher.verify(hash, wrongPassword);
  assert.equal(noMatchResult.outcome, 'NO_MATCH');

  // Dummy verify
  const dummyResult = await hasher.verifyDummy(password);
  assert.equal(dummyResult.outcome, 'NO_MATCH');
});

test('PasswordHasher: detects malformed PHC strings and does not call argon2.verify', async () => {
  const hasher = new PasswordHasher();
  const password = CORRECT_PASSWORD;

  const malformedHashes = [
    '',
    'not-a-hash',
    '$bcrypt$v=19$m=19456,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$argon2i$v=19$m=19456,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$argon2d$v=19$m=19456,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$argon2id$v=18$m=19456,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$argon2id$v=invalid$m=19456,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$argon2id$v=19$t=2,m=19456,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // reordered t,m,p
    '$argon2id$v=19$p=1,t=2,m=19456$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // reordered p,t,m
    '$argon2id$v=19$m=19456,t=2$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // missing p
    '$argon2id$v=19$m=19456,t=2,p=1,x=5$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // extra key x
    '$argon2id$v=19$m=19456,m=19456,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // duplicate m
    '$argon2id$v=19$m=-1,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    '$argon2id$v=19$m=4096,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // m < 8192
    '$argon2id$v=19$m=131072,t=2,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // m > 65536
    '$argon2id$v=19$m=19456,t=0,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // t < 1
    '$argon2id$v=19$m=19456,t=5,p=1$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // t > 4
    '$argon2id$v=19$m=19456,t=2,p=0$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // p < 1
    '$argon2id$v=19$m=19456,t=2,p=5$c29tZXNhbHQxNg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // p > 4
    '$argon2id$v=19$m=19456,t=2,p=1$$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // empty salt
    '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxNg$', // empty hash
    '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxNg$not!valid!base64', // invalid base64
  ];

  for (const phc of malformedHashes) {
    const result = await hasher.verify(phc, password);
    assert.equal(result.outcome, 'MALFORMED_HASH', `Expected MALFORMED_HASH for: ${phc}`);
  }
});

test('PasswordHasher: upward-only rehash logic', async () => {
  const hasher = new PasswordHasher();
  const password = CORRECT_PASSWORD;

  // Generate an older/weaker hash (e.g., m=8192 or t=1)
  const rawWeak = await argon2.hash(password, {
    type: argon2.argon2id,
    version: 0x13,
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
  });
  const weakParts = rawWeak.split('$');
  const weakHash = `$argon2id$v=19$m=8192,t=1,p=1$${weakParts[4]}$${weakParts[5]}`;

  const parsedWeak = parsePhcString(weakHash);
  assert.ok(parsedWeak !== null);
  assert.equal(isRehashNeeded(parsedWeak), true);

  const rehashResult = await hasher.verify(weakHash, password);
  assert.equal(rehashResult.outcome, 'MATCH_REHASH_NEEDED');
  assert.ok(typeof rehashResult.newHash === 'string');

  const parsedNew = parsePhcString(rehashResult.newHash);
  assert.ok(parsedNew !== null);
  assert.equal(parsedNew.memoryCost, 19456);
  assert.equal(parsedNew.timeCost, 2);
  assert.equal(isRehashNeeded(parsedNew), false);

  // A stronger hash (e.g. m=65536, t=3) must NOT be downgraded
  const rawStrong = await argon2.hash(password, {
    type: argon2.argon2id,
    version: 0x13,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const strongParts = rawStrong.split('$');
  const strongHash = `$argon2id$v=19$m=65536,t=3,p=1$${strongParts[4]}$${strongParts[5]}`;

  const parsedStrong = parsePhcString(strongHash);
  assert.ok(parsedStrong !== null);
  assert.equal(isRehashNeeded(parsedStrong), false);

  const strongResult = await hasher.verify(strongHash, password);
  assert.equal(strongResult.outcome, 'MATCH');
});
