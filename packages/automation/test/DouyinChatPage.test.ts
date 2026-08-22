import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type { Page } from 'playwright';

import {
  AuthDetector,
  BrowserSession,
  DOUYIN_CHAT_URL,
  DouyinChatPage,
  DouyinChatPageError,
  type BrowserSessionConfig,
} from '../src/index.js';

const READY_CHAT_FIXTURE = `<!doctype html>
<html lang="zh-CN">
  <body>
    <div data-testid="chat-shell" class="imContainer">
      <div class="componentsLeftPanelwrapper">
        <div data-testid="conversation-list" class="conversationConversationListwrapper">
          <div data-e2e="conversation-item">
            <div data-testid="conversation-title">Alice</div>
          </div>
          <div data-e2e="conversation-item">
            <div class="conversationConversationItemtitle">Bob</div>
          </div>
        </div>
      </div>
      <div data-testid="message-region" class="componentsRightPanelwrapper">
        Select a test conversation
      </div>
    </div>
  </body>
</html>`;

const AUTH_EXPIRED_FIXTURE = `<!doctype html>
<html lang="zh-CN">
  <body>
    <span>扫码登录</span>
    <img aria-label="二维码" alt="" width="40" height="40"
      src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40'/%3E%3C/svg%3E">
  </body>
</html>`;

let profileDir: string;
let session: BrowserSession;
let page: Page;

before(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'sparkkeeper-chat-adapter-'));
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

test('opens an authenticated Chat page through AuthDetector', async () => {
  await routeFixture(READY_CHAT_FIXTURE);
  const adapter = createAdapter();

  const result = await adapter.open();

  assert.equal(result.status, 'READY');
});

test('recognizes the Chat shell, conversation list, and message region', async () => {
  await loadFixture(READY_CHAT_FIXTURE);

  const result = await createAdapter().waitUntilReady();

  assert.equal(result.status, 'READY');
  assert.match(result.reason, /conversation list/i);
  assert.match(result.reason, /message region/i);
});

test('parses the loaded conversation items into display-name summaries', async () => {
  await loadFixture(READY_CHAT_FIXTURE);

  const conversations = await createAdapter().getConversationItems();

  assert.deepEqual(conversations, [{ displayName: 'Alice' }, { displayName: 'Bob' }]);
});

test('reports CONVERSATION_LIST_NOT_FOUND when the list container is absent', async () => {
  await loadFixture(`
    <div data-testid="chat-shell" class="imContainer">
      <div data-testid="message-region" class="componentsRightPanelwrapper">Empty panel</div>
    </div>
  `);

  await assertChatError(
    createAdapter().waitUntilReady(),
    'CONVERSATION_LIST_NOT_FOUND',
    /no recognized conversation-list container/i,
  );
});

test('reports CHAT_NOT_READY when required page regions are incomplete', async () => {
  await loadFixture(`
    <div data-testid="chat-shell" class="imContainer" style="width: 800px; height: 600px">
      <div data-testid="conversation-list" class="conversationConversationListwrapper"
        style="width: 300px; height: 500px"></div>
    </div>
  `);

  await assertChatError(
    createAdapter().waitUntilReady(),
    'CHAT_NOT_READY',
    /missing positive evidence: message region/i,
  );
});

test('blocks Chat parsing when authentication is expired', async () => {
  await routeFixture(AUTH_EXPIRED_FIXTURE);

  await assertChatError(createAdapter().open(), 'AUTH_EXPIRED', /manual authentication/i);
});

test('blocks Chat parsing when authentication is UNKNOWN', async () => {
  await routeFixture('<main aria-busy="true">Loading controlled page</main>');

  await assertChatError(createAdapter().open(), 'AUTH_UNKNOWN', /parsing is blocked/i);
});

test('reports PAGE_CLOSED for a closed Playwright Page', async () => {
  const closedPage = await session.getContext().newPage();
  const adapter = new DouyinChatPage(closedPage, { readinessTimeoutMs: 0 });
  await closedPage.close();

  await assertChatError(
    adapter.waitUntilReady(),
    'PAGE_CLOSED',
    /Page or BrowserContext is closed/i,
  );
});

test('fails safely when conversation item selectors no longer match list content', async () => {
  await loadFixture(`
    <div data-testid="chat-shell" class="imContainer">
      <div data-testid="conversation-list" class="conversationConversationListwrapper">
        <div class="renamed-conversation-item"><span>Test User</span></div>
      </div>
      <div data-testid="message-region" class="componentsRightPanelwrapper">Empty panel</div>
    </div>
  `);

  await assertChatError(
    createAdapter().getConversationItems(),
    'CONVERSATION_LIST_NOT_FOUND',
    /item selector may have changed/i,
  );
});

test('returns an empty array only for a recognized, structurally empty list', async () => {
  await loadFixture(`
    <div data-testid="chat-shell" class="imContainer" style="width: 800px; height: 600px">
      <div data-testid="conversation-list" class="conversationConversationListwrapper"
        style="width: 300px; height: 500px"></div>
      <div data-testid="message-region" class="componentsRightPanelwrapper"
        style="width: 500px; height: 500px">Empty panel</div>
    </div>
  `);

  const conversations = await createAdapter().getConversationItems();

  assert.deepEqual(conversations, []);
});

function createAdapter(): DouyinChatPage {
  return new DouyinChatPage(page, {
    authDetector: new AuthDetector({ timeoutMs: 0 }),
    navigationTimeoutMs: 1_000,
    readinessTimeoutMs: 0,
    pollIntervalMs: 10,
  });
}

async function routeFixture(html: string): Promise<void> {
  await page.unrouteAll({ behavior: 'wait' });
  await page.route(DOUYIN_CHAT_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: html,
    }),
  );
}

async function loadFixture(html: string): Promise<void> {
  await routeFixture(html);
  await page.goto(DOUYIN_CHAT_URL, { waitUntil: 'domcontentloaded' });
}

async function assertChatError(
  promise: Promise<unknown>,
  expectedCode: DouyinChatPageError['code'],
  messagePattern: RegExp,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DouyinChatPageError);
    assert.equal(error.code, expectedCode);
    assert.match(error.message, messagePattern);
    return true;
  });
}
