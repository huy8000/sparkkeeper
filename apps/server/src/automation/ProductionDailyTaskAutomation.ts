import {
  BrowserSession,
  ContactResolver,
  DouyinChatPage,
  DouyinChatPageError,
  MessageSender,
  resolveBrowserSessionConfig,
} from '@sparkkeeper/automation';
import type { Friend, SendRecord } from '@sparkkeeper/database';

import type {
  AutomationAuthResult,
  AutomationSendResult,
  ContactOpenResult,
  DailyTaskAutomation,
} from '../application/DailyTaskAutomation.js';

export class ProductionDailyTaskAutomation implements DailyTaskAutomation {
  private readonly browser = new BrowserSession(resolveBrowserSessionConfig());
  private chat: DouyinChatPage | undefined;

  async start(): Promise<void> {
    const { page } = await this.browser.start();
    this.chat = new DouyinChatPage(page);
  }

  async checkAuth(): Promise<AutomationAuthResult> {
    try {
      await this.requireChat().open();
      await this.requireChat().waitUntilReady();
      return 'READY';
    } catch (error) {
      if (error instanceof DouyinChatPageError && error.code === 'AUTH_EXPIRED')
        return 'AUTH_EXPIRED';
      if (error instanceof DouyinChatPageError && error.code === 'AUTH_UNKNOWN') return 'UNKNOWN';
      throw error;
    }
  }

  async resolveAndOpen(friend: Friend): Promise<ContactOpenResult> {
    const chat = this.requireChat();
    const result = await new ContactResolver(chat).resolve({ displayName: friend.displayName });
    if (result.type !== 'FOUND') return result.type;
    try {
      await chat.openConversation(result.contact);
      return 'VERIFIED';
    } catch {
      return 'VERIFICATION_FAILED';
    }
  }

  async sendAndVerify(friend: Friend, record: SendRecord): Promise<AutomationSendResult> {
    const result = await new MessageSender(this.browser.getPage()).send({
      target: { displayName: friend.displayName },
      message: record.messageText,
      allowRealSend: true,
    });
    return {
      status:
        result.status === 'SUCCESS'
          ? 'SUCCESS'
          : result.sendAttemptCount === 1
            ? 'DELIVERY_UNKNOWN'
            : 'FAILED',
      sendAttemptCount: result.sendAttemptCount,
    };
  }

  async close(): Promise<void> {
    this.chat = undefined;
    await this.browser.close();
  }

  private requireChat(): DouyinChatPage {
    if (this.chat === undefined) throw new Error('Daily task browser is not started.');
    return this.chat;
  }
}
