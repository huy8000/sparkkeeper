import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import type { Page } from 'playwright';

import {
  BrowserSession,
  ContactResolver,
  DOUYIN_CHAT_URL,
  DouyinChatPage,
  DouyinChatPageError,
  MessageSender,
  MessageSenderError,
  resolveMessageSendRuntimeConfig,
  type AuthDetectionResult,
  type BrowserSessionConfig,
  type ContactConversationSource,
  type ContactResolveResult,
  type ConversationCandidate,
  type ConversationListScrollResult,
  type MessageSendResult,
} from '../src/index.js';

const TARGET = { displayName: 'Alice' } as const;
const MESSAGE = 'hello-test';

let profileDir: string;
let session: BrowserSession;
let page: Page;

before(async () => {
  profileDir = await mkdtemp(path.join(os.tmpdir(), 'sparkkeeper-message-sender-'));
  session = new BrowserSession(testBrowserConfig(profileDir));
  ({ page } = await session.start());
});

after(async () => {
  await session.close();
  await rm(profileDir, { recursive: true, force: true });
});

test('locates an editable Composer and verifies exact input', async () => {
  await loadFixture(sendFixture());

  const result = await sendMessage();

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(result.input, 'VERIFIED');
});

test('returns INPUT_FAILED when the Composer is absent', async () => {
  await loadFixture(sendFixture({ composer: 'missing' }));

  const result = await sendMessage();

  assert.equal(result.status, 'INPUT_FAILED');
  assert.equal(result.sendAttemptCount, 0);
  assert.equal(await sendCount(), 0);
});

test('returns INPUT_FAILED when the Composer is not editable', async () => {
  await loadFixture(sendFixture({ composer: 'readonly' }));

  const result = await sendMessage();

  assert.equal(result.status, 'INPUT_FAILED');
  assert.equal(await sendCount(), 0);
});

test('rejects an empty message before any page action', async () => {
  await loadFixture(sendFixture());
  const sender = createSender();

  await assertSenderError(
    sender.send({ target: TARGET, message: '   ', allowRealSend: true }),
    'MESSAGE_INVALID',
  );
  assert.equal(await sendCount(), 0);
});

test('prevents send when the observable input differs', async () => {
  await loadFixture(sendFixture({ alterInput: true }));

  const result = await sendMessage();

  assert.equal(result.status, 'INPUT_FAILED');
  assert.equal(result.sendAction, 'NOT_TRIGGERED');
  assert.equal(await sendCount(), 0);
});

test('requires the current conversation to match immediately before input', async () => {
  await loadFixture(sendFixture({ header: 'Bob' }));

  const result = await sendMessage();

  assert.equal(result.status, 'INPUT_FAILED');
  assert.match(result.reason, /re-verified/i);
  assert.equal(await sendCount(), 0);
});

test('captures a baseline and accepts a new matching outbound Bubble', async () => {
  await loadFixture(sendFixture());

  const result = await sendMessage();

  assertSuccess(result);
  assert.equal(await outboundCount(), 1);
});

test('does not mistake historical matching outbound text for success', async () => {
  await loadFixture(
    sendFixture({
      existingMessages: [{ direction: 'outbound', text: MESSAGE }],
      behavior: 'none',
    }),
  );

  const result = await sendMessage();

  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(await outboundCount(), 1);
});

test('accepts a new matching outbound Bubble when history has the same text', async () => {
  await loadFixture(sendFixture({ existingMessages: [{ direction: 'outbound', text: MESSAGE }] }));

  const result = await sendMessage();

  assertSuccess(result);
  assert.equal(await outboundCount(), 2);
});

test('does not mistake a new inbound matching Bubble for success', async () => {
  await loadFixture(sendFixture({ behavior: 'inbound-matching' }));

  const result = await sendMessage();

  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(await sendCount(), 1);
});

test('returns VERIFY_FAILED for a new outbound Bubble with different text', async () => {
  await loadFixture(sendFixture({ behavior: 'outbound-different' }));

  const result = await sendMessage();

  assert.equal(result.status, 'VERIFY_FAILED');
  assert.equal(result.delivery, 'FAILED');
  assert.equal(await sendCount(), 1);
});

test('requires the matching Bubble to be a post-baseline node', async () => {
  await loadFixture(
    sendFixture({
      existingMessages: [{ direction: 'outbound', text: MESSAGE }],
      behavior: 'replace-existing',
    }),
  );

  const result = await sendMessage();

  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(await outboundCount(), 1);
});

test('returns SEND_ACTION_FAILED when no send control is available', async () => {
  await loadFixture(sendFixture({ sendControl: false }));

  const result = await sendMessage();

  assert.equal(result.status, 'SEND_ACTION_FAILED');
  assert.equal(result.sendAttemptCount, 0);
  assert.equal(await sendCount(), 0);
});

test('triggers the send action exactly once on success', async () => {
  await loadFixture(sendFixture());

  const result = await sendMessage();

  assertSuccess(result);
  assert.equal(result.sendAttemptCount, 1);
  assert.equal(await sendCount(), 1);
});

test('verification timeout cannot trigger a second send', async () => {
  await loadFixture(sendFixture({ behavior: 'none' }));
  const sender = createSender();
  const request = { target: TARGET, message: MESSAGE, allowRealSend: true } as const;

  const first = await sender.send(request);
  assert.equal(first.status, 'DELIVERY_UNKNOWN');
  await assertSenderError(sender.send(request), 'SEND_ALREADY_ATTEMPTED');
  assert.equal(await sendCount(), 1);
});

test('a missing message list before send is INPUT_FAILED, not DELIVERY_UNKNOWN', async () => {
  await loadFixture(sendFixture({ messageList: false }));

  const result = await sendMessage();

  assert.equal(result.status, 'INPUT_FAILED');
  assert.equal(result.sendAttemptCount, 0);
  assert.equal(await sendCount(), 0);
});

test('message-list disappearance after send is DELIVERY_UNKNOWN', async () => {
  await loadFixture(sendFixture({ behavior: 'remove-message-list' }));

  const result = await sendMessage();

  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(result.sendAttemptCount, 1);
  assert.equal(await sendCount(), 1);
});

test('Page close after send is DELIVERY_UNKNOWN', async () => {
  const controlledPage = await session.getContext().newPage();
  let attempted = 0;
  await controlledPage.exposeFunction('closeControlledPageAfterSend', async () => {
    attempted += 1;
    await controlledPage.close();
  });
  await controlledPage.setContent(
    sendFixture({ customSendAction: 'setTimeout(() => window.closeControlledPageAfterSend(), 0)' }),
  );

  const result = await new MessageSender(controlledPage, testSenderOptions()).send({
    target: TARGET,
    message: MESSAGE,
    allowRealSend: true,
  });

  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(result.sendAttemptCount, 1);
  assert.equal(attempted, 1);
});

test('Context close after send is DELIVERY_UNKNOWN', async () => {
  const isolatedProfile = await mkdtemp(path.join(os.tmpdir(), 'sparkkeeper-context-close-'));
  const isolatedSession = new BrowserSession(testBrowserConfig(isolatedProfile));
  const { page: isolatedPage } = await isolatedSession.start();
  let attempted = 0;
  await isolatedPage.exposeFunction('closeControlledContextAfterSend', async () => {
    attempted += 1;
    await isolatedSession.close();
  });
  await isolatedPage.setContent(
    sendFixture({
      customSendAction: 'setTimeout(() => window.closeControlledContextAfterSend(), 0)',
    }),
  );

  try {
    const result = await new MessageSender(isolatedPage, testSenderOptions()).send({
      target: TARGET,
      message: MESSAGE,
      allowRealSend: true,
    });
    assert.equal(result.status, 'DELIVERY_UNKNOWN');
    assert.equal(result.sendAttemptCount, 1);
    assert.equal(attempted, 1);
  } finally {
    await isolatedSession.close();
    await rm(isolatedProfile, { recursive: true, force: true });
  }
});

test('Page close before send is a pre-action INPUT_FAILED result', async () => {
  const controlledPage = await session.getContext().newPage();
  await controlledPage.setContent(sendFixture());
  const sender = new MessageSender(controlledPage, testSenderOptions());
  await controlledPage.close();

  const result = await sender.send({ target: TARGET, message: MESSAGE, allowRealSend: true });

  assert.equal(result.status, 'INPUT_FAILED');
  assert.equal(result.sendAttemptCount, 0);
});

test('AUTH_EXPIRED prevents MessageSender from being reached', async () => {
  await routeChatFixture(sendFixture());
  const adapter = authAdapter({ status: 'AUTH_EXPIRED', reason: 'Controlled auth state.' });

  await assert.rejects(adapter.open(), (error: unknown) => {
    assert.ok(error instanceof DouyinChatPageError);
    assert.equal(error.code, 'AUTH_EXPIRED');
    return true;
  });
  assert.equal(await sendCount(), 0);
});

test('UNKNOWN auth prevents MessageSender from being reached', async () => {
  await routeChatFixture(sendFixture());
  const adapter = authAdapter({ status: 'UNKNOWN', reason: 'Controlled unknown state.' });

  await assert.rejects(adapter.open(), (error: unknown) => {
    assert.ok(error instanceof DouyinChatPageError);
    assert.equal(error.code, 'AUTH_UNKNOWN');
    return true;
  });
  assert.equal(await sendCount(), 0);
});

test('AMBIGUOUS contact resolution prevents sending', async () => {
  await loadFixture(sendFixture());
  const resolver = new ContactResolver(
    new ControlledContactSource([
      { displayName: 'Alice', listIndex: 0 },
      { displayName: 'Alice', listIndex: 1 },
    ]),
  );

  const result = await resolveThenMaybeSend(resolver);

  assert.equal(result.type, 'AMBIGUOUS');
  assert.equal(await sendCount(), 0);
});

test('NOT_FOUND contact resolution prevents sending', async () => {
  await loadFixture(sendFixture());
  const resolver = new ContactResolver(
    new ControlledContactSource([{ displayName: 'Bob', listIndex: 0 }]),
    { maxScrollAttempts: 1 },
  );

  const result = await resolveThenMaybeSend(resolver);

  assert.equal(result.type, 'NOT_FOUND');
  assert.equal(await sendCount(), 0);
});

test('MessageSender rejects missing runtime send authorization', async () => {
  await loadFixture(sendFixture());

  await assertSenderError(
    createSender().send({ target: TARGET, message: MESSAGE, allowRealSend: false }),
    'SEND_NOT_AUTHORIZED',
  );
  assert.equal(await sendCount(), 0);
});

test('runtime configuration rejects missing authorization', () => {
  assert.throws(
    () =>
      resolveMessageSendRuntimeConfig({
        MVP_TARGET_DISPLAY_NAME: 'Test User',
        MVP_TEST_MESSAGE: MESSAGE,
      }),
    /MVP_ALLOW_REAL_SEND/,
  );
});

test('runtime configuration rejects explicit false authorization', () => {
  assert.throws(
    () =>
      resolveMessageSendRuntimeConfig({
        MVP_TARGET_DISPLAY_NAME: 'Test User',
        MVP_TEST_MESSAGE: MESSAGE,
        MVP_ALLOW_REAL_SEND: 'false',
      }),
    /MVP_ALLOW_REAL_SEND/,
  );
});

test('runtime configuration preserves an authorized message exactly', () => {
  const runtime = resolveMessageSendRuntimeConfig({
    MVP_TARGET_DISPLAY_NAME: 'Test User',
    MVP_TEST_MESSAGE: ` ${MESSAGE} `,
    MVP_ALLOW_REAL_SEND: 'true',
  });

  assert.equal(runtime.message, ` ${MESSAGE} `);
  assert.equal(runtime.allowRealSend, true);
});

function createSender(): MessageSender {
  return new MessageSender(page, testSenderOptions());
}

async function sendMessage(): Promise<MessageSendResult> {
  return createSender().send({ target: TARGET, message: MESSAGE, allowRealSend: true });
}

function testSenderOptions(): { verificationTimeoutMs: number; pollIntervalMs: number } {
  return { verificationTimeoutMs: 50, pollIntervalMs: 10 };
}

function testBrowserConfig(userDataDir: string): BrowserSessionConfig {
  return {
    userDataDir,
    headless: true,
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  };
}

async function loadFixture(html: string): Promise<void> {
  await page.unrouteAll({ behavior: 'wait' });
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

async function routeChatFixture(html: string): Promise<void> {
  await page.unrouteAll({ behavior: 'wait' });
  await page.route(DOUYIN_CHAT_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }),
  );
}

function authAdapter(result: AuthDetectionResult): DouyinChatPage {
  return new DouyinChatPage(page, {
    authDetector: { detect: async () => result },
    navigationTimeoutMs: 1_000,
    readinessTimeoutMs: 0,
    pollIntervalMs: 10,
  });
}

async function resolveThenMaybeSend(resolver: ContactResolver): Promise<ContactResolveResult> {
  const result = await resolver.resolve(TARGET);
  if (result.type === 'FOUND') {
    await sendMessage();
  }
  return result;
}

async function sendCount(): Promise<number> {
  return page.evaluate(() => {
    const controlled = window as Window & { __sendCount?: number };
    return controlled.__sendCount ?? 0;
  });
}

async function outboundCount(): Promise<number> {
  return page.locator('[data-testid="outbound-message"]').count();
}

function assertSuccess(result: MessageSendResult): void {
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.input, 'VERIFIED');
  assert.equal(result.sendAction, 'TRIGGERED');
  assert.equal(result.delivery, 'SUCCESS');
  assert.equal(result.sendAttemptCount, 1);
}

async function assertSenderError(
  promise: Promise<unknown>,
  code: MessageSenderError['code'],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof MessageSenderError);
    assert.equal(error.code, code);
    return true;
  });
}

type SendBehavior =
  | 'matching'
  | 'none'
  | 'inbound-matching'
  | 'outbound-different'
  | 'replace-existing'
  | 'remove-message-list';

interface SendFixtureOptions {
  readonly header?: string;
  readonly composer?: 'editable' | 'readonly' | 'missing';
  readonly sendControl?: boolean;
  readonly messageList?: boolean;
  readonly alterInput?: boolean;
  readonly behavior?: SendBehavior;
  readonly existingMessages?: readonly {
    readonly direction: 'outbound' | 'inbound';
    readonly text: string;
  }[];
  readonly customSendAction?: string;
}

function sendFixture(options: SendFixtureOptions = {}): string {
  const header = options.header ?? 'Alice';
  const composer = options.composer ?? 'editable';
  const sendControl = options.sendControl ?? true;
  const messageList = options.messageList ?? true;
  const behavior = options.behavior ?? 'matching';
  const existingMessages = (options.existingMessages ?? [])
    .map((message) => messageMarkup(message.direction, message.text))
    .join('');
  const composerMarkup =
    composer === 'missing'
      ? ''
      : `<div data-testid="message-composer" contenteditable="true"
          ${composer === 'readonly' ? 'aria-readonly="true"' : ''}
          style="width: 400px; height: 40px"></div>`;
  const sendMarkup = sendControl
    ? '<button data-testid="send-message" type="button">Send</button>'
    : '';
  const listMarkup = messageList
    ? `<div data-testid="message-list" style="width: 600px; height: 400px">${existingMessages}</div>`
    : '';
  const customAction = options.customSendAction;
  const action =
    customAction ??
    (behavior === 'matching'
      ? 'appendMessage("outbound", editor.textContent ?? "")'
      : behavior === 'inbound-matching'
        ? 'appendMessage("inbound", editor.textContent ?? "")'
        : behavior === 'outbound-different'
          ? 'appendMessage("outbound", "different-test")'
          : behavior === 'replace-existing'
            ? 'replaceExistingMessage()'
            : behavior === 'remove-message-list'
              ? 'document.querySelector("[data-testid=message-list]")?.remove()'
              : 'void 0');

  return `<!doctype html><html lang="en"><body>
    <main data-testid="chat-shell" style="width: 900px; height: 700px">
      <h2 data-testid="conversation-header-title">${header}</h2>
      ${listMarkup}
      ${composerMarkup}
      ${sendMarkup}
    </main>
    <script>
      (() => {
      window.__sendCount = 0;
      const editor = document.querySelector('[data-testid="message-composer"]');
      ${options.alterInput ? "editor?.addEventListener('input', () => { editor.textContent = 'different-test'; });" : ''}
      function appendMessage(direction, text) {
        const list = document.querySelector('[data-testid="message-list"]');
        if (!list) return;
        const box = document.createElement('div');
        box.dataset.testid = direction === 'outbound' ? 'outbound-message' : 'inbound-message';
        const content = document.createElement('span');
        content.dataset.testid = 'message-text';
        content.textContent = text;
        box.append(content);
        list.append(box);
      }
      function replaceExistingMessage() {
        const existing = document.querySelector('[data-testid="outbound-message"]');
        if (existing) existing.replaceWith(existing.cloneNode(true));
      }
      document.querySelector('[data-testid="send-message"]')?.addEventListener('click', () => {
        window.__sendCount += 1;
        ${action};
        if (editor) editor.textContent = '';
      });
      })();
    </script>
  </body></html>`;
}

function messageMarkup(direction: 'outbound' | 'inbound', text: string): string {
  const testId = direction === 'outbound' ? 'outbound-message' : 'inbound-message';
  return `<div data-testid="${testId}"><span data-testid="message-text">${text}</span></div>`;
}

class ControlledContactSource implements ContactConversationSource {
  public constructor(private readonly candidates: ConversationCandidate[]) {}

  public async resetConversationList(): Promise<void> {}

  public async getConversationCandidates(): Promise<ConversationCandidate[]> {
    return this.candidates;
  }

  public async scrollConversationList(): Promise<ConversationListScrollResult> {
    return { moved: false, atEnd: true };
  }
}
