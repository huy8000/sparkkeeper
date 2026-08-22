import { randomUUID } from 'node:crypto';

import type { Locator, Page } from 'playwright';

import {
  CONVERSATION_HEADER_TITLE_SELECTORS,
  MESSAGE_BUBBLE_TEXT_SELECTORS,
  MESSAGE_COMPOSER_SELECTORS,
  MESSAGE_LIST_SELECTORS,
  MESSAGE_SEND_ACTION_SELECTORS,
  OUTBOUND_MESSAGE_SELECTORS,
} from './selectors.js';
import type { MessageSendRequest, MessageSendResult, MessageSenderErrorCode } from './types.js';

const DEFAULT_VERIFICATION_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const MAX_MVP_MESSAGE_LENGTH = 1_000;
const BASELINE_ATTRIBUTE = 'data-sparkkeeper-send-baseline';

interface OutboundBaseline {
  readonly marker: string;
  readonly outboundCount: number;
  readonly matchingTextCount: number;
  readonly pageUrl: string;
}

interface OutboundState {
  readonly outboundCount: number;
  readonly matchingTextCount: number;
  readonly newMatchingCount: number;
}

export interface MessageSenderOptions {
  readonly verificationTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export class MessageSenderError extends Error {
  public constructor(
    public readonly code: MessageSenderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MessageSenderError';
  }
}

export class MessageSender {
  private readonly verificationTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private sendActionAttempted = false;

  public constructor(
    private readonly page: Page,
    options: MessageSenderOptions = {},
  ) {
    this.verificationTimeoutMs = validateDuration(
      options.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS,
      'Message verification timeout',
      true,
    );
    this.pollIntervalMs = validateDuration(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      'Message verification poll interval',
      false,
    );
  }

  public async send(request: MessageSendRequest): Promise<MessageSendResult> {
    this.validateRequest(request);
    if (this.sendActionAttempted) {
      throw new MessageSenderError(
        'SEND_ALREADY_ATTEMPTED',
        'A real send action was already attempted by this MessageSender instance.',
      );
    }

    let composer: Locator | undefined;
    let baseline: OutboundBaseline | undefined;
    let preSendStage = 'conversation verification';

    try {
      this.assertPageAvailable();
      if (!(await this.currentConversationMatches(request.target.displayName))) {
        return inputFailure(
          'The current conversation identity could not be re-verified immediately before input.',
        );
      }

      preSendStage = 'Composer discovery';
      composer = await findFirstVisible(this.page, MESSAGE_COMPOSER_SELECTORS);
      if (composer === undefined || !(await isComposerEditable(composer))) {
        return inputFailure('No visible and editable message Composer is available.');
      }

      preSendStage = 'outbound baseline capture';
      baseline = await this.captureOutboundBaseline(request.message);
      preSendStage = 'immediate conversation re-verification';
      if (!(await this.currentConversationMatches(request.target.displayName))) {
        return inputFailure(
          'The current conversation identity changed before Composer input; sending is blocked.',
        );
      }
      preSendStage = 'exact Composer input';
      const inputPrepared = await this.prepareExactInput(composer, request.message);
      if (!inputPrepared) {
        await this.clearComposerBestEffort(composer);
        return inputFailure('The Composer observable did not exactly match the requested message.');
      }

      preSendStage = 'send-control discovery';
      const sendControl = await findFirstVisible(this.page, MESSAGE_SEND_ACTION_SELECTORS);
      if (sendControl === undefined) {
        await this.clearComposerBestEffort(composer);
        return {
          status: 'SEND_ACTION_FAILED',
          input: 'VERIFIED',
          sendAction: 'NOT_TRIGGERED',
          delivery: 'NOT_ATTEMPTED',
          sendAttemptCount: 0,
          reason: 'No visible send control became available after exact input verification.',
        };
      }

      this.sendActionAttempted = true;
      try {
        await sendControl.click();
      } catch {
        return deliveryUnknown(
          'The send control was invoked, but the browser could not confirm whether the UI action completed.',
          'UNKNOWN',
        );
      }

      return await this.verifyDelivery(request.message, baseline);
    } catch (cause) {
      if (this.sendActionAttempted) {
        return deliveryUnknown(
          'The page became unobservable after the send action; delivery cannot be determined safely.',
          'TRIGGERED',
        );
      }

      if (composer !== undefined) {
        await this.clearComposerBestEffort(composer);
      }
      const safeContext =
        cause instanceof Error && cause.message.startsWith('Outbound baseline')
          ? ` ${cause.message}`
          : '';
      return inputFailure(
        `The pre-send operation failed during ${preSendStage}; no send action was triggered.${safeContext}`,
      );
    } finally {
      if (baseline !== undefined) {
        await this.removeBaselineMarkerBestEffort(baseline.marker);
      }
    }
  }

  private validateRequest(request: MessageSendRequest): void {
    if (request.allowRealSend !== true) {
      throw new MessageSenderError(
        'SEND_NOT_AUTHORIZED',
        'Real message sending requires explicit runtime authorization.',
      );
    }
    if (request.message.trim() === '' || request.message.length > MAX_MVP_MESSAGE_LENGTH) {
      throw new MessageSenderError(
        'MESSAGE_INVALID',
        'The runtime message must be non-empty plain text within the MVP length limit.',
      );
    }
  }

  private async currentConversationMatches(expectedDisplayName: string): Promise<boolean> {
    for (const selector of CONVERSATION_HEADER_TITLE_SELECTORS) {
      const headers = this.page.locator(selector);
      const count = await headers.count();
      for (let index = 0; index < count; index += 1) {
        const header = headers.nth(index);
        if (
          (await header.isVisible()) &&
          (await header.innerText()).trim() === expectedDisplayName.trim()
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private async captureOutboundBaseline(message: string): Promise<OutboundBaseline> {
    const messageList = await findFirstVisible(this.page, MESSAGE_LIST_SELECTORS);
    if (messageList === undefined) {
      throw new Error('The message list is unavailable before send.');
    }

    const marker = randomUUID();
    const outbound = messageList.locator(OUTBOUND_MESSAGE_SELECTORS.join(', '));
    let state: OutboundState;
    try {
      state = await collectOutboundState(outbound, message, marker);
    } catch {
      throw new Error('Outbound baseline state collection failed.');
    }
    try {
      await outbound.evaluateAll(
        (elements, baseline) => {
          for (const element of elements) {
            element.setAttribute(baseline.attribute, baseline.marker);
          }
        },
        { attribute: BASELINE_ATTRIBUTE, marker },
      );
    } catch {
      throw new Error('Outbound baseline marker creation failed.');
    }

    return {
      marker,
      outboundCount: state.outboundCount,
      matchingTextCount: state.matchingTextCount,
      pageUrl: this.page.url(),
    };
  }

  private async prepareExactInput(composer: Locator, message: string): Promise<boolean> {
    await composer.click();
    await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    await composer.press('Backspace');
    if ((await readComposerObservable(composer)) !== '') {
      return false;
    }

    await composer.focus();
    await this.page.keyboard.insertText(message);
    return (await readComposerObservable(composer)) === message;
  }

  private async verifyDelivery(
    message: string,
    baseline: OutboundBaseline,
  ): Promise<MessageSendResult> {
    const deadline = Date.now() + this.verificationTimeoutMs;
    let lastState: OutboundState | undefined;

    while (true) {
      try {
        this.assertPageAvailable();
        if (this.page.url() !== baseline.pageUrl || isBrowserErrorUrl(this.page.url())) {
          return deliveryUnknown(
            'The page navigated away or entered a browser error state after the send action.',
            'TRIGGERED',
          );
        }

        const messageList = await findFirstVisible(this.page, MESSAGE_LIST_SELECTORS);
        if (messageList === undefined) {
          return deliveryUnknown(
            'The message list became unavailable after the send action.',
            'TRIGGERED',
          );
        }
        const outbound = messageList.locator(OUTBOUND_MESSAGE_SELECTORS.join(', '));
        lastState = await collectOutboundState(outbound, message, baseline.marker);

        if (
          lastState.outboundCount > baseline.outboundCount &&
          lastState.matchingTextCount > baseline.matchingTextCount &&
          lastState.newMatchingCount > 0
        ) {
          return {
            status: 'SUCCESS',
            input: 'VERIFIED',
            sendAction: 'TRIGGERED',
            delivery: 'SUCCESS',
            sendAttemptCount: 1,
            reason: 'A new matching outbound message Bubble appeared after the baseline.',
          };
        }
      } catch {
        return deliveryUnknown(
          'The page became unobservable after the send action; delivery cannot be determined safely.',
          'TRIGGERED',
        );
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      try {
        await this.page.waitForTimeout(Math.min(this.pollIntervalMs, remainingMs));
      } catch {
        return deliveryUnknown(
          'The Page or BrowserContext closed during delivery verification.',
          'TRIGGERED',
        );
      }
    }

    if (
      lastState !== undefined &&
      lastState.outboundCount > baseline.outboundCount &&
      lastState.matchingTextCount <= baseline.matchingTextCount
    ) {
      return {
        status: 'VERIFY_FAILED',
        input: 'VERIFIED',
        sendAction: 'TRIGGERED',
        delivery: 'FAILED',
        sendAttemptCount: 1,
        reason: 'A new outbound Bubble appeared, but its observable text did not match.',
      };
    }

    return deliveryUnknown(
      `No qualifying new outbound Bubble appeared within ${this.verificationTimeoutMs} ms.`,
      'TRIGGERED',
    );
  }

  private assertPageAvailable(): void {
    if (this.page.isClosed()) {
      throw new Error('The Page is closed.');
    }
  }

  private async clearComposerBestEffort(composer: Locator): Promise<void> {
    if (this.page.isClosed()) {
      return;
    }
    try {
      await composer.click();
      await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await composer.press('Backspace');
    } catch {
      // A best-effort pre-send cleanup must never cause a send or hide the original result.
    }
  }

  private async removeBaselineMarkerBestEffort(marker: string): Promise<void> {
    if (this.page.isClosed()) {
      return;
    }
    try {
      await this.page
        .locator(`[${BASELINE_ATTRIBUTE}="${marker}"]`)
        .evaluateAll((elements, attribute) => {
          for (const element of elements) {
            element.removeAttribute(attribute);
          }
        }, BASELINE_ATTRIBUTE);
    } catch {
      // The marker is runtime-only and disappears with the page if cleanup is unavailable.
    }
  }
}

async function findFirstVisible(
  page: Page,
  selectors: readonly string[],
): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible()) {
        return candidate;
      }
    }
  }
  return undefined;
}

async function readComposerObservable(composer: Locator): Promise<string> {
  return composer.evaluate((element) => {
    const allStringNodes = Array.from(element.querySelectorAll('[data-string]'));
    if (allStringNodes.length > 0) {
      return allStringNodes
        .filter((node) => !node.hasAttribute('data-enter'))
        .map((node) => node.textContent ?? '')
        .join('');
    }
    return (element.textContent ?? '').replaceAll('\uFEFF', '');
  });
}

async function isComposerEditable(composer: Locator): Promise<boolean> {
  if (!(await composer.isEditable())) {
    return false;
  }
  return composer.evaluate(
    (element) =>
      element.getAttribute('contenteditable') === 'true' &&
      element.getAttribute('aria-readonly') !== 'true' &&
      element.getAttribute('aria-disabled') !== 'true' &&
      !element.hasAttribute('inert'),
  );
}

async function collectOutboundState(
  outbound: Locator,
  expectedMessage: string,
  marker: string,
): Promise<OutboundState> {
  return outbound.evaluateAll(
    (elements, input) => {
      let matchingTextCount = 0;
      let newMatchingCount = 0;
      for (const element of elements) {
        let observedText: string | undefined;
        for (const selector of input.textSelectors) {
          const textNode = element.matches(selector) ? element : element.querySelector(selector);
          if (textNode !== null) {
            observedText = (textNode.textContent ?? '').replaceAll('\r\n', '\n');
            break;
          }
        }
        const matches = observedText === input.message;
        if (matches) {
          matchingTextCount += 1;
          if (element.getAttribute(input.baselineAttribute) !== input.marker) {
            newMatchingCount += 1;
          }
        }
      }
      return {
        outboundCount: elements.length,
        matchingTextCount,
        newMatchingCount,
      };
    },
    {
      message: expectedMessage.replaceAll('\r\n', '\n'),
      marker,
      baselineAttribute: BASELINE_ATTRIBUTE,
      textSelectors: [...MESSAGE_BUBBLE_TEXT_SELECTORS],
    },
  );
}

function inputFailure(reason: string): MessageSendResult {
  return {
    status: 'INPUT_FAILED',
    input: 'FAILED',
    sendAction: 'NOT_TRIGGERED',
    delivery: 'NOT_ATTEMPTED',
    sendAttemptCount: 0,
    reason,
  };
}

function deliveryUnknown(reason: string, sendAction: 'TRIGGERED' | 'UNKNOWN'): MessageSendResult {
  return {
    status: 'DELIVERY_UNKNOWN',
    input: 'VERIFIED',
    sendAction,
    delivery: 'UNKNOWN',
    sendAttemptCount: 1,
    reason,
  };
}

function isBrowserErrorUrl(url: string): boolean {
  return url.startsWith('chrome-error://') || url.startsWith('edge-error://');
}

function validateDuration(value: number, label: string, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum} ms.`);
  }
  return value;
}
