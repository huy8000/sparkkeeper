import {
  BrowserSession,
  ContactResolver,
  DouyinChatPage,
  DouyinChatPageError,
  resolveBrowserSessionConfig,
  resolveTargetContactIdentity,
} from '../src/index.js';

async function main(): Promise<void> {
  const target = resolveTargetContactIdentity();
  const session = new BrowserSession(resolveBrowserSessionConfig());

  try {
    const { page } = await session.start();
    const chatPage = new DouyinChatPage(page);
    const auth = await chatPage.open();
    const chat = await chatPage.waitUntilReady();
    const resolver = new ContactResolver(chatPage);
    const contact = await resolver.resolve(target);

    console.info(`Auth status: ${auth.status}`);
    console.info(`Chat status: ${chat.status}`);
    console.info(`Contact result: ${contact.type}`);
    console.info(`Scroll attempts: ${contact.scrollAttempts}`);

    if (contact.type !== 'FOUND') {
      throw new Error('The runtime-configured contact was not resolved uniquely.');
    }

    const opened = await chatPage.openConversation(contact.contact);
    console.info(`Conversation opened: ${opened.status}`);
  } finally {
    await session.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof DouyinChatPageError) {
    console.error(`Contact smoke failed [${error.code}]: ${error.message}`);
  } else {
    const message = error instanceof Error ? error.message : 'Unknown contact smoke failure';
    console.error(`Contact smoke failed: ${message}`);
  }
  process.exitCode = 1;
});
