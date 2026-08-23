import type { Locator, Page } from 'playwright';

import { AuthDetectionError, AuthDetector } from './AuthDetector.js';
import {
  CHAT_SHELL_SELECTORS,
  CONVERSATION_HEADER_TITLE_SELECTORS,
  CONVERSATION_ITEM_SELECTOR,
  CONVERSATION_LIST_SELECTORS,
  CONVERSATION_TITLE_SELECTORS,
  DOUYIN_CHAT_URL,
  MESSAGE_REGION_SELECTORS,
  type AuthCssSignal,
} from './selectors.js';
import type {
  AuthDetectionResult,
  ChatReadinessResult,
  ConversationCandidate,
  ConversationListScrollResult,
  ConversationOpenResult,
  ConversationSummary,
  DouyinChatErrorCode,
  ResolvedContact,
} from './types.js';

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_READINESS_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const MAX_VISIBLE_MATCHES_TO_INSPECT = 20;

interface AuthDetectorLike {
  detect(page: Page): Promise<AuthDetectionResult>;
}

export interface DouyinChatPageOptions {
  readonly authDetector?: AuthDetectorLike;
  readonly navigationTimeoutMs?: number;
  readonly readinessTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

interface ChatEvidenceSnapshot {
  readonly shell: readonly string[];
  readonly conversationList: readonly string[];
  readonly messageRegion: readonly string[];
}

export class DouyinChatPageError extends Error {
  public constructor(
    public readonly code: DouyinChatErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DouyinChatPageError';
  }
}

export class DouyinChatPage {
  private readonly authDetector: AuthDetectorLike;
  private readonly navigationTimeoutMs: number;
  private readonly readinessTimeoutMs: number;
  private readonly pollIntervalMs: number;

  public constructor(
    private readonly page: Page,
    options: DouyinChatPageOptions = {},
  ) {
    this.authDetector = options.authDetector ?? new AuthDetector();
    this.navigationTimeoutMs = validateDuration(
      options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
      'Douyin Chat navigation timeout',
      false,
    );
    this.readinessTimeoutMs = validateDuration(
      options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
      'Douyin Chat readiness timeout',
      true,
    );
    this.pollIntervalMs = validateDuration(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      'Douyin Chat poll interval',
      false,
    );
  }

  public async open(): Promise<AuthDetectionResult> {
    this.assertPageAvailable();
    let navigationFailure: string | undefined;

    try {
      await this.page.goto(DOUYIN_CHAT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: this.navigationTimeoutMs,
      });
    } catch (cause) {
      if (this.page.isClosed() || isClosedTargetError(cause)) {
        throw this.createPageClosedError('opening Douyin Chat', cause);
      }

      navigationFailure = describeError(cause);
    }

    let authResult: AuthDetectionResult;
    try {
      authResult = await this.authDetector.detect(this.page);
    } catch (cause) {
      if (this.page.isClosed() || isClosedTargetError(cause)) {
        throw this.createPageClosedError('detecting Douyin authentication', cause);
      }

      const context =
        cause instanceof AuthDetectionError
          ? cause.message
          : `Unexpected authentication detector failure: ${describeError(cause)}`;
      throw new DouyinChatPageError(
        'BROWSER_ERROR',
        `Cannot open Douyin Chat because authentication detection failed. ${context}`,
        { cause },
      );
    }

    if (authResult.status === 'AUTH_EXPIRED') {
      throw new DouyinChatPageError(
        'AUTH_EXPIRED',
        `Douyin Chat requires manual authentication. ${authResult.reason}`,
      );
    }

    if (authResult.status === 'UNKNOWN') {
      const navigationContext =
        navigationFailure === undefined
          ? ''
          : ` Navigation did not complete normally: ${navigationFailure}`;
      throw new DouyinChatPageError(
        'AUTH_UNKNOWN',
        `Douyin authentication is UNKNOWN; Chat parsing is blocked. ${authResult.reason}${navigationContext}`,
      );
    }

    return authResult;
  }

  public async waitUntilReady(): Promise<ChatReadinessResult> {
    this.assertPageAvailable();

    const deadline = Date.now() + this.readinessTimeoutMs;
    let lastSnapshot: ChatEvidenceSnapshot | undefined;
    let lastInspectionFailure: string | undefined;

    while (true) {
      try {
        this.assertPageAvailable();
        if (isBrowserErrorUrl(this.page.url())) {
          throw new DouyinChatPageError(
            'BROWSER_ERROR',
            'Douyin Chat is showing a browser network-error page.',
          );
        }

        const snapshot = await this.collectReadinessEvidence();
        lastSnapshot = snapshot;
        lastInspectionFailure = undefined;

        if (
          snapshot.shell.length > 0 &&
          snapshot.conversationList.length > 0 &&
          snapshot.messageRegion.length > 0
        ) {
          return {
            status: 'READY',
            reason: `Visible Chat shell (${snapshot.shell.join(', ')}), conversation list (${snapshot.conversationList.join(', ')}), and message region (${snapshot.messageRegion.join(', ')}) are ready.`,
          };
        }
      } catch (cause) {
        if (cause instanceof DouyinChatPageError) {
          throw cause;
        }
        if (this.page.isClosed() || isClosedTargetError(cause)) {
          throw this.createPageClosedError('waiting for Douyin Chat readiness', cause);
        }
        lastInspectionFailure = describeError(cause);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }

      try {
        await this.page.waitForTimeout(Math.min(this.pollIntervalMs, remainingMs));
      } catch (cause) {
        throw this.createPageClosedError('waiting for Douyin Chat readiness', cause);
      }
    }

    if (lastInspectionFailure !== undefined) {
      throw new DouyinChatPageError(
        'BROWSER_ERROR',
        `Douyin Chat could not be inspected reliably within ${this.readinessTimeoutMs} ms: ${lastInspectionFailure}`,
      );
    }

    if (
      lastSnapshot !== undefined &&
      lastSnapshot.shell.length > 0 &&
      lastSnapshot.messageRegion.length > 0 &&
      lastSnapshot.conversationList.length === 0
    ) {
      throw new DouyinChatPageError(
        'CONVERSATION_LIST_NOT_FOUND',
        `Douyin Chat shell and message region were visible, but no recognized conversation-list container appeared within ${this.readinessTimeoutMs} ms.`,
      );
    }

    throw new DouyinChatPageError(
      'CHAT_NOT_READY',
      buildNotReadyMessage(this.readinessTimeoutMs, lastSnapshot),
    );
  }

  public async getConversationItems(): Promise<ConversationSummary[]> {
    await this.waitUntilReady();
    const conversationList = await findFirstVisible(this.page, CONVERSATION_LIST_SELECTORS);

    if (conversationList === undefined) {
      throw new DouyinChatPageError(
        'CONVERSATION_LIST_NOT_FOUND',
        'Douyin Chat readiness passed, but the conversation-list container is no longer available.',
      );
    }

    const items = conversationList.locator(CONVERSATION_ITEM_SELECTOR);
    const itemCount = await items.count();

    if (itemCount === 0) {
      if (await isStructurallyEmpty(conversationList)) {
        return [];
      }

      throw new DouyinChatPageError(
        'CONVERSATION_LIST_NOT_FOUND',
        'The conversation-list container has content but no recognized conversation items; the item selector may have changed.',
      );
    }

    const conversations: ConversationSummary[] = [];
    for (let index = 0; index < itemCount; index += 1) {
      conversations.push(await parseConversationItem(items.nth(index), index));
    }

    return conversations;
  }

  public async getConversationCandidates(): Promise<ConversationCandidate[]> {
    const { items } = await this.getConversationElements();
    const itemCount = await items.count();
    const candidates: ConversationCandidate[] = [];

    for (let index = 0; index < itemCount; index += 1) {
      const item = items.nth(index);
      const summary = await parseConversationItem(item, index);
      candidates.push({
        ...summary,
        listIndex: await parseConversationListIndex(item, index),
      });
    }

    return candidates;
  }

  public async resetConversationList(): Promise<void> {
    const { conversationList } = await this.getConversationElements();
    try {
      await conversationList.evaluate((element) => {
        element.scrollTop = 0;
      });
      await this.page.waitForTimeout(this.pollIntervalMs);
    } catch (cause) {
      if (this.page.isClosed() || isClosedTargetError(cause)) {
        throw this.createPageClosedError('resetting the conversation list', cause);
      }
      throw new DouyinChatPageError(
        'BROWSER_ERROR',
        'The conversation list could not be reset for bounded contact resolution.',
        { cause },
      );
    }
  }

  public async scrollConversationList(): Promise<ConversationListScrollResult> {
    const { conversationList } = await this.getConversationElements();
    try {
      const before = await readScrollState(conversationList);
      if (before.atEnd) {
        return { moved: false, atEnd: true };
      }

      await conversationList.evaluate((element) => {
        const step = Math.max(1, Math.floor(element.clientHeight * 0.8));
        element.scrollTop = Math.min(element.scrollTop + step, element.scrollHeight);
      });
      await this.page.waitForTimeout(this.pollIntervalMs);
      const after = await readScrollState(conversationList);
      return {
        moved: after.scrollTop > before.scrollTop,
        atEnd: after.atEnd,
      };
    } catch (cause) {
      if (this.page.isClosed() || isClosedTargetError(cause)) {
        throw this.createPageClosedError('scrolling the conversation list', cause);
      }
      throw new DouyinChatPageError(
        'BROWSER_ERROR',
        'The conversation list could not be scrolled during bounded contact resolution.',
        { cause },
      );
    }
  }

  public async openConversation(contact: ResolvedContact): Promise<ConversationOpenResult> {
    const { items } = await this.getConversationElements();
    const matches: Locator[] = [];
    const itemCount = await items.count();

    for (let index = 0; index < itemCount; index += 1) {
      const item = items.nth(index);
      const [summary, listIndex] = await Promise.all([
        parseConversationItem(item, index),
        parseConversationListIndex(item, index),
      ]);
      if (
        listIndex === contact.listIndex &&
        summary.displayName.trim() === contact.identity.displayName.trim()
      ) {
        matches.push(item);
      }
    }

    if (matches.length !== 1) {
      throw new DouyinChatPageError(
        'CONVERSATION_OPEN_FAILED',
        'The resolved conversation is no longer uniquely available in the current list view.',
      );
    }

    try {
      await matches[0]?.click();
    } catch (cause) {
      if (this.page.isClosed() || isClosedTargetError(cause)) {
        throw this.createPageClosedError('opening the resolved conversation', cause);
      }
      throw new DouyinChatPageError(
        'CONVERSATION_OPEN_FAILED',
        'The uniquely resolved conversation could not be opened.',
        { cause },
      );
    }

    const deadline = Date.now() + this.readinessTimeoutMs;
    while (true) {
      this.assertPageAvailable();
      const headerTitles = await collectVisibleTexts(
        this.page,
        CONVERSATION_HEADER_TITLE_SELECTORS,
      );
      if (headerTitles.some((title) => title.trim() === contact.identity.displayName.trim())) {
        return { status: 'VERIFIED' };
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      try {
        await this.page.waitForTimeout(Math.min(this.pollIntervalMs, remainingMs));
      } catch (cause) {
        throw this.createPageClosedError('verifying the opened conversation', cause);
      }
    }

    throw new DouyinChatPageError(
      'CONVERSATION_VERIFICATION_FAILED',
      'The opened conversation header did not match the resolved in-memory identity.',
    );
  }

  private async getConversationElements(): Promise<{
    conversationList: Locator;
    items: Locator;
  }> {
    await this.waitUntilReady();
    const conversationList = await findFirstVisible(this.page, CONVERSATION_LIST_SELECTORS);
    if (conversationList === undefined) {
      throw new DouyinChatPageError(
        'CONVERSATION_LIST_NOT_FOUND',
        'Douyin Chat readiness passed, but the conversation-list container is no longer available.',
      );
    }

    const items = conversationList.locator(CONVERSATION_ITEM_SELECTOR);
    const itemCount = await items.count();
    if (itemCount === 0 && !(await isStructurallyEmpty(conversationList))) {
      throw new DouyinChatPageError(
        'CONVERSATION_LIST_NOT_FOUND',
        'The conversation-list container has content but no recognized conversation items; the item selector may have changed.',
      );
    }

    return { conversationList, items };
  }

  private async collectReadinessEvidence(): Promise<ChatEvidenceSnapshot> {
    const [shell, conversationList, messageRegion] = await Promise.all([
      collectVisibleSignals(this.page, CHAT_SHELL_SELECTORS),
      collectVisibleSignals(this.page, CONVERSATION_LIST_SELECTORS),
      collectVisibleSignals(this.page, MESSAGE_REGION_SELECTORS),
    ]);

    return { shell, conversationList, messageRegion };
  }

  private assertPageAvailable(): void {
    if (this.page.isClosed()) {
      throw this.createPageClosedError('using Douyin Chat');
    }
  }

  private createPageClosedError(action: string, cause?: unknown): DouyinChatPageError {
    return new DouyinChatPageError(
      'PAGE_CLOSED',
      `Cannot continue ${action} because the Page or BrowserContext is closed.`,
      cause === undefined ? undefined : { cause },
    );
  }
}

async function collectVisibleSignals(
  page: Page,
  signals: readonly AuthCssSignal[],
): Promise<string[]> {
  const matches = await Promise.all(
    signals.map(async (signal) =>
      (await findFirstVisible(page, [signal])) === undefined ? undefined : signal.label,
    ),
  );
  return matches.filter((match): match is string => match !== undefined);
}

async function findFirstVisible(
  page: Page,
  signals: readonly AuthCssSignal[],
): Promise<Locator | undefined> {
  for (const signal of signals) {
    const locator = page.locator(signal.selector);
    const count = Math.min(await locator.count(), MAX_VISIBLE_MATCHES_TO_INSPECT);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) {
        return candidate;
      }
    }
  }

  return undefined;
}

async function collectVisibleTexts(page: Page, selectors: readonly string[]): Promise<string[]> {
  const texts: string[] = [];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count(), MAX_VISIBLE_MATCHES_TO_INSPECT);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) {
        texts.push(await candidate.innerText());
      }
    }
  }
  return texts;
}

async function isStructurallyEmpty(container: Locator): Promise<boolean> {
  return container.evaluate(
    (element) => element.children.length === 0 && (element.textContent ?? '').trim() === '',
  );
}

async function parseConversationItem(item: Locator, index: number): Promise<ConversationSummary> {
  for (const selector of CONVERSATION_TITLE_SELECTORS) {
    const titles = item.locator(selector);
    const titleCount = await titles.count();
    if (titleCount === 0) {
      continue;
    }
    if (titleCount !== 1) {
      throw new DouyinChatPageError(
        'CONVERSATION_ITEM_PARSE_FAILED',
        `Conversation item ${index + 1} has ${titleCount} title candidates; parsing stopped to avoid an ambiguous identity.`,
      );
    }

    const displayName = (await titles.first().innerText()).trim();
    if (displayName === '') {
      throw new DouyinChatPageError(
        'CONVERSATION_ITEM_PARSE_FAILED',
        `Conversation item ${index + 1} has an empty display name.`,
      );
    }

    return { displayName };
  }

  throw new DouyinChatPageError(
    'CONVERSATION_ITEM_PARSE_FAILED',
    `Conversation item ${index + 1} has no recognized display-name element; the title selector may have changed.`,
  );
}

async function parseConversationListIndex(item: Locator, index: number): Promise<number> {
  const rawListIndex = await item.evaluate(
    (element) => element.closest('[data-index]')?.getAttribute('data-index') ?? null,
  );
  const listIndex = rawListIndex === null ? Number.NaN : Number(rawListIndex);
  if (!Number.isInteger(listIndex) || listIndex < 0) {
    throw new DouyinChatPageError(
      'CONVERSATION_ITEM_PARSE_FAILED',
      `Conversation item ${index + 1} has no valid virtual-list index.`,
    );
  }
  return listIndex;
}

async function readScrollState(container: Locator): Promise<{
  scrollTop: number;
  atEnd: boolean;
}> {
  return container.evaluate((element) => ({
    scrollTop: element.scrollTop,
    atEnd: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
  }));
}

function buildNotReadyMessage(
  timeoutMs: number,
  snapshot: ChatEvidenceSnapshot | undefined,
): string {
  if (snapshot === undefined) {
    return `Douyin Chat did not expose a readable page state within ${timeoutMs} ms.`;
  }

  const missing = [
    ...(snapshot.shell.length === 0 ? ['Chat shell'] : []),
    ...(snapshot.conversationList.length === 0 ? ['conversation list'] : []),
    ...(snapshot.messageRegion.length === 0 ? ['message region'] : []),
  ];
  return `Douyin Chat was not ready within ${timeoutMs} ms; missing positive evidence: ${missing.join(', ')}.`;
}

function validateDuration(value: number, label: string, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum} ms.`);
  }

  return value;
}

function isBrowserErrorUrl(url: string): boolean {
  return url.startsWith('chrome-error://') || url.startsWith('edge-error://');
}

function isClosedTargetError(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    /target page, context or browser has been closed|page has been closed/i.test(cause.message)
  );
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown browser failure';
}
