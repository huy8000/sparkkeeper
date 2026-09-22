import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type { Page } from 'playwright';

import {
  AccountIdentityExtractionError,
  AccountOnboardingDetector,
  BrowserSession,
  DOUYIN_CHAT_URL,
  DouyinAccountIdentityExtractor,
  type BrowserSessionConfig,
} from '../src/index.js';

const READY_SHELL = `
  <nav aria-label="消息">
    <h2>消息</h2>
    <section aria-label="会话列表"><article>受控测试会话</article></section>
  </nav>
  <main><div contenteditable="true" role="textbox" aria-label="发送消息"></div></main>`;

let profileDir: string;
let session: BrowserSession;
let page: Page;

before(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'sparkkeeper-onboarding-detector-'));
  const config: BrowserSessionConfig = {
    userDataDir: profileDir,
    headless: true,
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  };
  session = new BrowserSession(config);
  ({ page } = await session.start());
});

after(async () => {
  await session.close();
  await rm(profileDir, { recursive: true, force: true });
});

test('returns READY with a validated identity from visible public DOM only', async () => {
  await loadFixture(`<!doctype html><html><body>${READY_SHELL}
    <section data-e2e="user-profile" data-unique-id="public-user-42" data-short-id="42">
      <span data-e2e="user-name">受控账号</span>
      <a href="/user/MS4wLjABAAAA-controlled">公开主页</a>
      <img data-e2e="user-avatar" width="32" height="32"
        src="https://p3.example.test/avatar.png">
    </section>
  </body></html>`);

  const result = await new AccountOnboardingDetector({ timeoutMs: 100 }).detect(page);

  assert.equal(result.status, 'READY');
  if (result.status === 'READY') {
    assert.deepEqual(result.identity, {
      displayName: '受控账号',
      douyinSecUid: 'MS4wLjABAAAA-controlled',
      douyinUniqueId: 'public-user-42',
      douyinShortId: '42',
      avatarRemoteUrl: 'https://p3.example.test/avatar.png',
    });
  }
});

test('extracts the stable unique id when a public secUid link is unavailable', async () => {
  await loadFixture(`<!doctype html><html><body>
    <section data-testid="account-profile">
      <span data-testid="account-display-name">Visible Name</span>
      <span data-testid="account-unique-id">unique-only</span>
    </section>
  </body></html>`);

  const identity = await new DouyinAccountIdentityExtractor().extract(page);

  assert.equal(identity.douyinSecUid, null);
  assert.equal(identity.douyinUniqueId, 'unique-only');
});

test('fails closed with a typed error when stable public identity is unavailable', async () => {
  await loadFixture(`<!doctype html><html><body>${READY_SHELL}
    <section data-e2e="user-profile"><span data-e2e="user-name">Visible Name</span></section>
  </body></html>`);

  await assert.rejects(
    new AccountOnboardingDetector({ timeoutMs: 100 }).detect(page),
    (error: unknown) =>
      error instanceof AccountIdentityExtractionError &&
      error.code === 'PROFILE_IDENTITY_UNAVAILABLE' &&
      !error.message.includes('Visible Name'),
  );
});

test('rejects an off-site profile link and never reads browser storage', async () => {
  await loadFixture(`<!doctype html><html><body>
    <section data-e2e="user-profile">
      <span data-e2e="user-name">Visible Name</span>
      <a href="https://example.test/user/not-douyin">Public profile</a>
    </section>
    <script>
      Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new Error('storage read'); } });
      Object.defineProperty(Document.prototype, 'cookie', { get() { throw new Error('cookie read'); } });
    </script>
  </body></html>`);

  await assert.rejects(
    new DouyinAccountIdentityExtractor().extract(page),
    AccountIdentityExtractionError,
  );
});

async function loadFixture(html: string): Promise<void> {
  await page.unrouteAll({ behavior: 'wait' });
  await page.route(DOUYIN_CHAT_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    }),
  );
  await page.goto(DOUYIN_CHAT_URL, { waitUntil: 'domcontentloaded' });
}
