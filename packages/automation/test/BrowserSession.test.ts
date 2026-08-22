import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import type { BrowserContext, Page } from 'playwright';

import { BrowserSession, BrowserSessionError, type BrowserSessionConfig } from '../src/index.js';

const TEST_CONFIG: BrowserSessionConfig = {
  userDataDir: '/tmp/sparkkeeper-browser-session-test',
  headless: true,
  timezoneId: 'Asia/Shanghai',
  locale: 'zh-CN',
  viewport: { width: 1440, height: 900 },
};

class FakePage extends EventEmitter {
  private closed = false;

  public isClosed(): boolean {
    return this.closed;
  }

  public closeUnexpectedly(): void {
    this.closed = true;
    this.emit('close');
  }

  public asPage(): Page {
    return this as unknown as Page;
  }
}

class FakeContext extends EventEmitter {
  public closeCalls = 0;
  public newPageCalls = 0;
  private readonly fakePages: FakePage[];

  public constructor(initialPages: FakePage[]) {
    super();
    this.fakePages = initialPages;
  }

  public pages(): Page[] {
    return this.fakePages.map((page) => page.asPage());
  }

  public async newPage(): Promise<Page> {
    this.newPageCalls += 1;
    const page = new FakePage();
    this.fakePages.push(page);
    return page.asPage();
  }

  public async close(): Promise<void> {
    this.closeCalls += 1;
    this.emit('close');
  }

  public closeUnexpectedly(): void {
    this.emit('close');
  }

  public asBrowserContext(): BrowserContext {
    return this as unknown as BrowserContext;
  }
}

class FakeBrowserSession extends BrowserSession {
  public launchCalls = 0;

  public constructor(
    config: BrowserSessionConfig,
    private readonly fakeContext: FakeContext,
  ) {
    super(config);
  }

  protected override async launchContext(): Promise<BrowserContext> {
    this.launchCalls += 1;
    return this.fakeContext.asBrowserContext();
  }
}

test('start reuses a running persistent context and close is safely repeatable', async () => {
  const initialPage = new FakePage();
  const context = new FakeContext([initialPage]);
  const session = new FakeBrowserSession(TEST_CONFIG, context);

  const first = await session.start();
  const second = await session.start();

  assert.equal(session.isRunning(), true);
  assert.equal(session.launchCalls, 1);
  assert.equal(first.context, second.context);
  assert.equal(first.page, second.page);
  assert.equal(session.getContext(), first.context);
  assert.equal(session.getPage(), first.page);

  await session.close();
  await session.close();

  assert.equal(context.closeCalls, 1);
  assert.equal(session.isRunning(), false);
});

test('start creates a replacement page when the current page was closed', async () => {
  const initialPage = new FakePage();
  const context = new FakeContext([initialPage]);
  const session = new FakeBrowserSession(TEST_CONFIG, context);

  await session.start();
  initialPage.closeUnexpectedly();
  const restarted = await session.start();

  assert.equal(session.launchCalls, 1);
  assert.equal(context.newPageCalls, 1);
  assert.notEqual(restarted.page, initialPage.asPage());

  await session.close();
});

test('an unexpected context close clears all running state', async () => {
  const context = new FakeContext([new FakePage()]);
  const session = new FakeBrowserSession(TEST_CONFIG, context);

  await session.start();
  context.closeUnexpectedly();

  assert.equal(session.isRunning(), false);
  assert.throws(() => session.getContext(), BrowserSessionError);
  assert.throws(() => session.getPage(), BrowserSessionError);
  await session.close();
  assert.equal(context.closeCalls, 0);
});

test('startup errors include the persistent profile path', async () => {
  class FailingBrowserSession extends BrowserSession {
    protected override async launchContext(): Promise<BrowserContext> {
      throw new Error('Chromium executable unavailable');
    }
  }

  const session = new FailingBrowserSession(TEST_CONFIG);

  await assert.rejects(
    session.start(),
    (error: unknown) =>
      error instanceof BrowserSessionError &&
      error.message.includes(TEST_CONFIG.userDataDir) &&
      error.cause instanceof Error,
  );
  assert.equal(session.isRunning(), false);
});
