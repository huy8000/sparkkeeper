import {
  BrowserSession,
  ContactResolver,
  DouyinChatPage,
  DouyinChatPageError,
  MessageSender,
  resolveBrowserSessionConfig,
} from '@sparkkeeper/automation';
import type { Friend, SendRecord } from '@sparkkeeper/database';

import { DailyTaskAutomationError } from '../application/DailyTaskAutomation.js';
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
    try {
      const { page } = await this.browser.start();
      this.chat = new DouyinChatPage(page);
    } catch (error) {
      throw new DailyTaskAutomationError(
        'BROWSER_TRANSIENT',
        'NOT_STARTED',
        'Browser session could not be started for this Attempt.',
        error,
      );
    }
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
      throw new DailyTaskAutomationError(
        error instanceof DouyinChatPageError && error.code === 'CHAT_NOT_READY'
          ? 'PAGE_LOAD_TIMEOUT'
          : 'BROWSER_TRANSIENT',
        'NOT_STARTED',
        'Chat authentication readiness could not be established.',
        error,
      );
    }
  }

  async resolveAndOpen(friend: Friend): Promise<ContactOpenResult> {
    const chat = this.requireChat();
    try {
      const result = await new ContactResolver(chat).resolve({ displayName: friend.displayName });
      if (result.type === 'NOT_FOUND') {
        return { status: 'FAILED', failureCode: 'CONTACT_NOT_FOUND' };
      }
      if (result.type === 'AMBIGUOUS') {
        return { status: 'FAILED', failureCode: 'AMBIGUOUS_CONTACT' };
      }
      await chat.openConversation(result.contact);
      return { status: 'VERIFIED' };
    } catch (error) {
      if (error instanceof DouyinChatPageError) {
        if (error.code === 'CONVERSATION_LIST_NOT_FOUND' || error.code === 'CHAT_NOT_READY') {
          return { status: 'FAILED', failureCode: 'CONTACT_LIST_NOT_READY' };
        }
        if (error.code === 'CONVERSATION_VERIFICATION_FAILED') {
          return { status: 'FAILED', failureCode: 'CONVERSATION_VERIFICATION_FAILED' };
        }
        if (error.code === 'PAGE_CLOSED' || error.code === 'BROWSER_ERROR') {
          return { status: 'FAILED', failureCode: 'BROWSER_TRANSIENT' };
        }
      }
      return { status: 'FAILED', failureCode: 'SELECTOR_FAILURE' };
    }
  }

  async sendAndVerify(friend: Friend, record: SendRecord): Promise<AutomationSendResult> {
    const result = await new MessageSender(this.browser.getPage()).send({
      target: { displayName: friend.displayName },
      message: record.messageText,
      allowRealSend: true,
    });
    if (result.status === 'SUCCESS') {
      return { status: 'SUCCESS', sendAction: 'TRIGGERED' };
    }
    if (result.sendAction !== 'NOT_TRIGGERED' || result.sendAttemptCount === 1) {
      return {
        status: 'DELIVERY_UNKNOWN',
        failureCode: result.status === 'VERIFY_FAILED' ? 'VERIFY_FAILED' : 'DELIVERY_UNKNOWN',
        sendAction: result.sendAction === 'UNKNOWN' ? 'UNKNOWN' : 'TRIGGERED',
      };
    }
    return {
      status: 'FAILED',
      failureCode: result.status === 'INPUT_FAILED' ? 'MESSAGE_INPUT_FAILED' : 'SEND_ACTION_FAILED',
      sendAction: 'NOT_TRIGGERED',
    };
  }

  async close(): Promise<void> {
    this.chat = undefined;
    await this.browser.close();
  }

  async captureScreenshot(absolutePath: string): Promise<void> {
    await this.browser.getPage().screenshot({ path: absolutePath, fullPage: true });
  }

  async startTrace(): Promise<void> {
    await this.browser.getContext().tracing.start({ screenshots: true, snapshots: true });
  }

  async stopTrace(absolutePath?: string): Promise<void> {
    if (absolutePath === undefined) await this.browser.getContext().tracing.stop();
    else await this.browser.getContext().tracing.stop({ path: absolutePath });
  }

  private requireChat(): DouyinChatPage {
    if (this.chat === undefined) throw new Error('Daily task browser is not started.');
    return this.chat;
  }
}
