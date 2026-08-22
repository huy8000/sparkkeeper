import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type { Page } from 'playwright';

import {
  AuthDetectionError,
  AuthDetector,
  BrowserSession,
  DOUYIN_CHAT_URL,
  type BrowserSessionConfig,
} from '../src/index.js';

const READY_FIXTURE = `<!doctype html>
<html lang="zh-CN">
  <body>
    <nav aria-label="消息">
      <h2>消息</h2>
      <section aria-label="会话列表"><article>受控测试会话</article></section>
    </nav>
    <main><div contenteditable="true" role="textbox" aria-label="发送消息"></div></main>
  </body>
</html>`;

const READY_WITHOUT_SELECTED_CONVERSATION_FIXTURE = `<!doctype html>
<html lang="zh-CN">
  <body>
    <div class="componentsLeftPanelwrapper">
      <div class="conversationConversationListwrapper">
        <div data-e2e="conversation-item">Controlled conversation</div>
      </div>
    </div>
    <div class="RightPanelEmptywrapper componentsRightPanelwrapper">
      Select a controlled conversation
    </div>
  </body>
</html>`;

const AUTH_EXPIRED_FIXTURE = `<!doctype html>
<html lang="zh-CN">
  <body>
    <section aria-label="登录">
      <span>扫码登录</span>
      <img aria-label="二维码" alt="" width="40" height="40"
        src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40'/%3E%3C/svg%3E">
      <input type="tel" placeholder="请输入手机号">
    </section>
  </body>
</html>`;

let profileDir: string;
let session: BrowserSession;
let page: Page;

before(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'sparkkeeper-auth-detector-'));
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

test('returns READY only with chat-shell and composer evidence', async () => {
  await loadFixture(READY_FIXTURE);

  const result = await new AuthDetector({ timeoutMs: 100 }).detect(page);

  assert.equal(result.status, 'READY');
  assert.match(result.reason, /two independent positive signals/i);
});

test('returns READY for an authenticated chat workspace before a conversation is selected', async () => {
  await loadFixture(READY_WITHOUT_SELECTED_CONVERSATION_FIXTURE);

  const result = await new AuthDetector({ timeoutMs: 100 }).detect(page);

  assert.equal(result.status, 'READY');
  assert.match(result.reason, /chat workspace/i);
  assert.match(result.reason, /two independent positive signals/i);
});

test('returns AUTH_EXPIRED for explicit login evidence', async () => {
  await loadFixture(AUTH_EXPIRED_FIXTURE);

  const result = await new AuthDetector({ timeoutMs: 100 }).detect(page);

  assert.equal(result.status, 'AUTH_EXPIRED');
  assert.match(result.reason, /扫码登录/);
  assert.match(result.reason, /QR-code aria-label/);
});

test('returns UNKNOWN when evidence is insufficient', async () => {
  await loadFixture('<main>Douyin Chat is loading</main>');

  const result = await new AuthDetector({ timeoutMs: 0 }).detect(page);

  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.reason, /without enough evidence/i);
});

test('returns UNKNOWN when READY and AUTH_EXPIRED evidence conflict', async () => {
  await loadFixture(`${READY_FIXTURE}${AUTH_EXPIRED_FIXTURE}`);

  const result = await new AuthDetector({ timeoutMs: 100 }).detect(page);

  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.reason, /conflicting authentication evidence/i);
});

test('returns UNKNOWN after a bounded timeout on an unrecognized page', async () => {
  await loadFixture('<main aria-busy="true">Loading</main>');
  const startedAt = Date.now();

  const result = await new AuthDetector({ timeoutMs: 80, pollIntervalMs: 20 }).detect(page);

  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.reason, /timed out after 80 ms/i);
  assert.ok(Date.now() - startedAt >= 60, 'detector should perform bounded polling');
});

test('returns UNKNOWN safely for a recognized network-error page', async () => {
  await loadFixture('<main id="main-frame-error"><h1>无法访问此网站</h1></main>');

  const result = await new AuthDetector({ timeoutMs: 100 }).detect(page);

  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.reason, /network-error state/i);
});

test('returns UNKNOWN when authenticated DOM evidence appears off the chat URL', async () => {
  await loadFixture(READY_FIXTURE, 'https://www.douyin.com/discover');

  const result = await new AuthDetector({ timeoutMs: 100 }).detect(page);

  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.reason, /DOM and URL evidence contradict/i);
});

test('returns UNKNOWN when login evidence appears on a non-Douyin URL', async () => {
  await loadFixture(AUTH_EXPIRED_FIXTURE, 'https://example.test/login');

  const result = await new AuthDetector({ timeoutMs: 100 }).detect(page);

  assert.equal(result.status, 'UNKNOWN');
  assert.match(result.reason, /non-Douyin URL/i);
});

test('throws an infrastructure error for a closed Page', async () => {
  const closedPage = await session.getContext().newPage();
  await closedPage.close();

  await assert.rejects(new AuthDetector({ timeoutMs: 0 }).detect(closedPage), AuthDetectionError);
});

async function loadFixture(html: string, url = DOUYIN_CHAT_URL): Promise<void> {
  await page.unrouteAll({ behavior: 'wait' });
  await page.route(url, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    }),
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}
