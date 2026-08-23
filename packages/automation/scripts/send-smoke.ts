import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Page } from 'playwright';

import {
  BrowserSession,
  ContactResolver,
  DouyinChatPage,
  MessageSender,
  resolveBrowserSessionConfig,
  resolveMessageSendRuntimeConfig,
  type MessageSendResult,
} from '../src/index.js';

async function main(): Promise<void> {
  const runtime = resolveMessageSendRuntimeConfig();
  const session = new BrowserSession(resolveBrowserSessionConfig());
  let page: Page | undefined;

  try {
    ({ page } = await session.start());
    const chatPage = new DouyinChatPage(page);
    const auth = await chatPage.open();
    const chat = await chatPage.waitUntilReady();
    const contact = await new ContactResolver(chatPage).resolve(runtime.target);

    console.info(`Auth status: ${auth.status}`);
    console.info(`Chat status: ${chat.status}`);
    console.info(`Contact result: ${contact.type}`);

    if (contact.type !== 'FOUND') {
      throw new Error('The runtime-configured contact was not resolved uniquely.');
    }

    const opened = await chatPage.openConversation(contact.contact);
    console.info(`Conversation opened: ${opened.status}`);

    const result = await new MessageSender(page).send({
      target: contact.contact.identity,
      message: runtime.message,
      allowRealSend: runtime.allowRealSend,
    });
    reportResult(result);

    if (result.status !== 'SUCCESS') {
      await saveDiagnosticScreenshotBestEffort(page, result.status.toLowerCase());
      throw new Error('M5 send smoke did not complete successfully.');
    }
  } finally {
    await session.close();
  }
}

function reportResult(result: MessageSendResult): void {
  console.info(`Message input: ${result.input}`);
  console.info(`Send action: ${result.sendAction}`);
  console.info(`Delivery verification: ${result.delivery}`);
}

async function saveDiagnosticScreenshotBestEffort(page: Page, status: string): Promise<void> {
  if (page.isClosed()) {
    return;
  }
  try {
    const dataDir = path.resolve(process.cwd(), readEnvironmentPath('DATA_DIR') ?? 'data');
    const screenshotDir = path.join(dataDir, 'screenshots');
    await mkdir(screenshotDir, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    const screenshotPath = path.join(screenshotDir, `send-${status}-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.info(`Diagnostic screenshot saved: ${screenshotPath}`);
  } catch {
    console.error('Diagnostic screenshot could not be saved.');
  }
}

function readEnvironmentPath(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === '' ? undefined : value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown send smoke failure';
  console.error(`Send smoke failed: ${message}`);
  process.exitCode = 1;
});
