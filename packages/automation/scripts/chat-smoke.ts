import {
  BrowserSession,
  DouyinChatPage,
  DouyinChatPageError,
  resolveBrowserSessionConfig,
} from '../src/index.js';

async function main(): Promise<void> {
  const session = new BrowserSession(resolveBrowserSessionConfig());

  try {
    const { page } = await session.start();
    const chatPage = new DouyinChatPage(page);
    const auth = await chatPage.open();
    const chat = await chatPage.waitUntilReady();
    const conversations = await chatPage.getConversationItems();

    console.info(`Auth status: ${auth.status}`);
    console.info(`Chat status: ${chat.status}`);
    console.info('Conversation list detected');
    console.info(`Conversation count: ${conversations.length}`);
  } finally {
    await session.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof DouyinChatPageError) {
    console.error(`Chat smoke failed [${error.code}]: ${error.message}`);
  } else {
    const message = error instanceof Error ? error.message : 'Unknown Chat smoke test failure';
    console.error(`Chat smoke failed [BROWSER_ERROR]: ${message}`);
  }
  process.exitCode = 1;
});
