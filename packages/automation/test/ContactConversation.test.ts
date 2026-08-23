import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type { Page } from 'playwright';

import {
  BrowserSession,
  ContactResolver,
  DouyinChatPage,
  DouyinChatPageError,
  type BrowserSessionConfig,
  type ContactResolveResult,
  type ResolvedContact,
  type TargetContactIdentity,
} from '../src/index.js';

let profileDir: string;
let session: BrowserSession;
let page: Page;

before(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'sparkkeeper-contact-adapter-'));
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

test('parses displayName plus an ephemeral virtual-list index', async () => {
  await loadFixture(
    conversationFixture([
      ['Alice', 0],
      ['Bob', 1],
    ]),
  );

  const candidates = await createAdapter().getConversationCandidates();

  assert.deepEqual(candidates, [
    { displayName: 'Alice', listIndex: 0 },
    { displayName: 'Bob', listIndex: 1 },
  ]);
});

test('opens only the resolved item and verifies the Header identity', async () => {
  await loadFixture(
    conversationFixture([
      ['Alice', 0],
      ['Bob', 1],
    ]),
  );
  const adapter = createAdapter();

  const result = await adapter.openConversation(resolved('Alice', 0));

  assert.equal(result.status, 'VERIFIED');
  assert.equal(await clickCount(), 1);
});

test('fails verification when the opened Header identity does not match', async () => {
  await loadFixture(conversationFixture([['Alice', 0]], 'Different User'));

  await assertChatError(
    createAdapter().openConversation(resolved('Alice', 0)),
    'CONVERSATION_VERIFICATION_FAILED',
  );
  assert.equal(await clickCount(), 1);
});

test('does not click when a resolved runtime handle is no longer available', async () => {
  await loadFixture(conversationFixture([['Alice', 0]]));

  await assertChatError(
    createAdapter().openConversation(resolved('Alice', 9)),
    'CONVERSATION_OPEN_FAILED',
  );
  assert.equal(await clickCount(), 0);
});

test('AMBIGUOUS resolution never opens a conversation', async () => {
  await loadFixture(
    conversationFixture([
      ['Alice', 0],
      ['Alice', 1],
    ]),
  );
  const adapter = createAdapter();
  const result = await resolveAndOpen(adapter, { displayName: 'Alice' });

  assert.equal(result.type, 'AMBIGUOUS');
  assert.equal(await clickCount(), 0);
});

test('NOT_FOUND resolution never opens a conversation', async () => {
  await loadFixture(conversationFixture([['Alice', 0]]));
  const adapter = createAdapter();
  const result = await resolveAndOpen(adapter, { displayName: 'Missing User' });

  assert.equal(result.type, 'NOT_FOUND');
  assert.equal(await clickCount(), 0);
});

test('distinguishes a recognized empty list from selector failure', async () => {
  await loadFixture(conversationFixture([]));
  assert.deepEqual(await createAdapter().getConversationCandidates(), []);

  await loadFixture(`
    <div data-testid="chat-shell" class="imContainer" style="width: 800px; height: 600px">
      <div data-testid="conversation-list" class="conversationConversationListwrapper"
        style="width: 300px; height: 500px"><div class="renamed-item">Test User</div></div>
      <div data-testid="message-region" class="componentsRightPanelwrapper"
        style="width: 500px; height: 500px">Controlled panel</div>
    </div>
  `);
  await assertChatError(createAdapter().getConversationCandidates(), 'CONVERSATION_LIST_NOT_FOUND');
});

test('scrolls and resets the conversation list through bounded adapter operations', async () => {
  await loadFixture(
    conversationFixture(
      [
        ['Alice', 0],
        ['Bob', 1],
        ['Test User', 2],
      ],
      undefined,
      true,
    ),
  );
  const adapter = createAdapter();

  const scroll = await adapter.scrollConversationList();
  assert.equal(scroll.moved, true);
  await adapter.resetConversationList();
  assert.equal(
    await page
      .locator('[data-testid="conversation-list"]')
      .evaluate((element) => element.scrollTop),
    0,
  );
});

test('reports PAGE_CLOSED during contact candidate access', async () => {
  const closedPage = await session.getContext().newPage();
  const adapter = new DouyinChatPage(closedPage, { readinessTimeoutMs: 0 });
  await closedPage.close();

  await assertChatError(adapter.getConversationCandidates(), 'PAGE_CLOSED');
});

function createAdapter(): DouyinChatPage {
  return new DouyinChatPage(page, {
    readinessTimeoutMs: 0,
    pollIntervalMs: 10,
  });
}

async function resolveAndOpen(
  adapter: DouyinChatPage,
  target: TargetContactIdentity,
): Promise<ContactResolveResult> {
  const result = await new ContactResolver(adapter, {
    maxScrollAttempts: 1,
    noProgressLimit: 1,
  }).resolve(target);
  if (result.type === 'FOUND') {
    await adapter.openConversation(result.contact);
  }
  return result;
}

function resolved(displayName: string, listIndex: number): ResolvedContact {
  return { identity: { displayName }, listIndex };
}

function conversationFixture(
  conversations: readonly (readonly [displayName: string, listIndex: number])[],
  forcedHeader?: string,
  scrollable = false,
): string {
  const items = conversations
    .map(
      ([displayName, listIndex]) => `
        <div data-index="${listIndex}" style="height: ${scrollable ? 100 : 40}px">
          <button data-e2e="conversation-item" onclick="openControlledConversation(this)">
            <span data-testid="conversation-title">${displayName}</span>
          </button>
        </div>`,
    )
    .join('');
  const listHeight = scrollable ? 100 : 500;
  const forcedHeaderLiteral = JSON.stringify(forcedHeader ?? null);

  return `<!doctype html>
    <html lang="zh-CN"><body>
      <div data-testid="chat-shell" class="imContainer" style="width: 800px; height: 600px">
        <div data-testid="conversation-list" class="conversationConversationListwrapper"
          style="width: 300px; height: ${listHeight}px; overflow-y: auto">${items}</div>
        <div data-testid="message-region" class="componentsRightPanelwrapper"
          style="width: 500px; height: 500px">
          <h2 data-testid="conversation-header-title"></h2>
        </div>
      </div>
      <script>
        window.__clickCount = 0;
        function openControlledConversation(item) {
          window.__clickCount += 1;
          const forcedHeader = ${forcedHeaderLiteral};
          document.querySelector('[data-testid="conversation-header-title"]').textContent =
            forcedHeader ?? item.querySelector('[data-testid="conversation-title"]').textContent;
        }
      </script>
    </body></html>`;
}

async function loadFixture(html: string): Promise<void> {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

async function clickCount(): Promise<number> {
  return page.evaluate(() => {
    const controlledWindow = window as Window & { __clickCount?: number };
    return controlledWindow.__clickCount ?? 0;
  });
}

async function assertChatError(
  promise: Promise<unknown>,
  expectedCode: DouyinChatPageError['code'],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof DouyinChatPageError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}
