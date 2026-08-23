import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_BROWSER_LOCALE,
  DEFAULT_BROWSER_VIEWPORT,
  DEFAULT_TIMEZONE,
  resolveBrowserSessionConfig,
} from '../src/index.js';

test('uses safe browser-session defaults', () => {
  const config = resolveBrowserSessionConfig({}, '/workspace/sparkkeeper');

  assert.deepEqual(config, {
    userDataDir: path.join('/workspace/sparkkeeper', 'data', 'browser-profile'),
    headless: true,
    timezoneId: DEFAULT_TIMEZONE,
    locale: DEFAULT_BROWSER_LOCALE,
    viewport: DEFAULT_BROWSER_VIEWPORT,
  });
});

test('derives the default profile directory from DATA_DIR', () => {
  const config = resolveBrowserSessionConfig(
    { DATA_DIR: './runtime-data' },
    '/workspace/sparkkeeper',
  );

  assert.equal(
    config.userDataDir,
    path.join('/workspace/sparkkeeper', 'runtime-data', 'browser-profile'),
  );
});

test('uses an explicit profile path and headed mode', () => {
  const config = resolveBrowserSessionConfig(
    {
      DATA_DIR: './ignored-for-explicit-profile',
      BROWSER_PROFILE_DIR: './profiles/main',
      BROWSER_HEADLESS: 'false',
      APP_TIMEZONE: 'UTC',
    },
    '/workspace/sparkkeeper',
  );

  assert.equal(config.userDataDir, path.join('/workspace/sparkkeeper', 'profiles', 'main'));
  assert.equal(config.headless, false);
  assert.equal(config.timezoneId, 'UTC');
});

test('rejects an invalid BROWSER_HEADLESS value', () => {
  assert.throws(
    () => resolveBrowserSessionConfig({ BROWSER_HEADLESS: 'sometimes' }, '/workspace/sparkkeeper'),
    /Invalid BROWSER_HEADLESS value/,
  );
});
