import type { Locator, Page } from 'playwright';

import {
  ABNORMAL_PAGE_SELECTORS,
  ABNORMAL_PAGE_TEXTS,
  AUTH_MODE_TEXTS,
  AUTH_SUPPORT_SELECTORS,
  READY_CHAT_SHELL_SELECTORS,
  READY_CHAT_SHELL_TEXTS,
  READY_CHAT_WORKSPACE_SELECTORS,
  REAUTHENTICATION_TEXTS,
  type AuthCssSignal,
} from './selectors.js';
import type { AuthDetectionResult, AuthDetectorOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
const MAX_SIGNAL_MATCHES_TO_INSPECT = 10;

interface AuthEvidenceSnapshot {
  readonly url: string;
  readonly readyShell: readonly string[];
  readonly readyWorkspace: readonly string[];
  readonly authMode: readonly string[];
  readonly authSupport: readonly string[];
  readonly reauthentication: readonly string[];
  readonly loginButtonVisible: boolean;
  readonly abnormal: readonly string[];
}

export class AuthDetectionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AuthDetectionError';
  }
}

export class AuthDetector {
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;

  public constructor(options: AuthDetectorOptions = {}) {
    this.timeoutMs = validateDuration(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      'Auth detection timeout',
      true,
    );
    this.pollIntervalMs = validateDuration(
      options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      'Auth detection poll interval',
      false,
    );
  }

  public async detect(page: Page): Promise<AuthDetectionResult> {
    this.assertPageAvailable(page);

    const startedAt = Date.now();
    const deadline = startedAt + this.timeoutMs;
    let lastSnapshot: AuthEvidenceSnapshot | undefined;
    let lastInspectionFailure: string | undefined;

    while (true) {
      try {
        const snapshot = await this.collectEvidence(page);
        lastSnapshot = snapshot;
        const result = classifyEvidence(snapshot);

        if (result !== undefined) {
          return result;
        }

        lastInspectionFailure = undefined;
      } catch (cause) {
        if (page.isClosed() || isClosedTargetError(cause)) {
          throw new AuthDetectionError(
            'Cannot detect Douyin authentication because the Page or BrowserContext closed.',
            { cause },
          );
        }

        lastInspectionFailure = describeError(cause);
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }

      try {
        await page.waitForTimeout(Math.min(this.pollIntervalMs, remainingMs));
      } catch (cause) {
        throw new AuthDetectionError(
          'Cannot continue Douyin authentication detection because the Page became unavailable.',
          { cause },
        );
      }
    }

    if (lastInspectionFailure !== undefined) {
      return {
        status: 'UNKNOWN',
        reason: `Timed out after ${this.timeoutMs} ms because the page could not be inspected reliably: ${lastInspectionFailure}`,
      };
    }

    return {
      status: 'UNKNOWN',
      reason: buildInsufficientEvidenceReason(this.timeoutMs, lastSnapshot),
    };
  }

  private assertPageAvailable(page: Page): void {
    if (page.isClosed()) {
      throw new AuthDetectionError(
        'Cannot detect Douyin authentication on a closed Page; provide a running BrowserSession Page.',
      );
    }
  }

  private async collectEvidence(page: Page): Promise<AuthEvidenceSnapshot> {
    const [
      readyShellSelectors,
      readyShellTexts,
      readyWorkspace,
      authMode,
      authSupport,
      reauthentication,
      loginButtonVisible,
      abnormalSelectors,
      abnormalTexts,
    ] = await Promise.all([
      collectVisibleCssSignals(page, READY_CHAT_SHELL_SELECTORS),
      collectVisibleExactTexts(page, READY_CHAT_SHELL_TEXTS),
      collectVisibleCssSignals(page, READY_CHAT_WORKSPACE_SELECTORS),
      collectVisibleExactTexts(page, AUTH_MODE_TEXTS),
      collectVisibleCssSignals(page, AUTH_SUPPORT_SELECTORS),
      collectVisibleExactTexts(page, REAUTHENTICATION_TEXTS),
      hasVisible(page.getByRole('button', { name: '登录', exact: true })),
      collectVisibleCssSignals(page, ABNORMAL_PAGE_SELECTORS),
      collectVisibleExactTexts(page, ABNORMAL_PAGE_TEXTS),
    ]);

    return {
      url: page.url(),
      readyShell: [...readyShellSelectors, ...readyShellTexts],
      readyWorkspace,
      authMode,
      authSupport,
      reauthentication,
      loginButtonVisible,
      abnormal: [...abnormalSelectors, ...abnormalTexts],
    };
  }
}

function classifyEvidence(snapshot: AuthEvidenceSnapshot): AuthDetectionResult | undefined {
  const hasReadyEvidence = snapshot.readyShell.length > 0 && snapshot.readyWorkspace.length > 0;
  const hasCombinedLoginEvidence = snapshot.authMode.length > 0 && snapshot.authSupport.length > 0;
  const hasExpiredEvidence =
    hasCombinedLoginEvidence ||
    snapshot.reauthentication.length > 0 ||
    snapshot.loginButtonVisible ||
    (isDouyinLoginUrl(snapshot.url) &&
      (snapshot.authMode.length > 0 || snapshot.authSupport.length > 0));

  if (hasReadyEvidence && hasExpiredEvidence) {
    return {
      status: 'UNKNOWN',
      reason:
        'Conflicting authentication evidence is visible: authenticated chat controls and login or reauthentication controls appeared together.',
    };
  }

  if (snapshot.abnormal.length > 0 || isBrowserErrorUrl(snapshot.url)) {
    const evidence =
      snapshot.abnormal.length > 0 ? snapshot.abnormal.join(', ') : 'browser error URL';
    return {
      status: 'UNKNOWN',
      reason: `The page is in an abnormal or network-error state (${evidence}); authentication cannot be determined safely.`,
    };
  }

  if (hasReadyEvidence) {
    if (!isExpectedChatUrl(snapshot.url)) {
      return {
        status: 'UNKNOWN',
        reason:
          'Authenticated chat controls are visible on an unexpected URL; DOM and URL evidence contradict each other.',
      };
    }

    return {
      status: 'READY',
      reason: `Visible authenticated chat shell (${snapshot.readyShell.join(', ')}) and chat workspace (${snapshot.readyWorkspace.join(', ')}) provide two independent positive signals on the Douyin Chat URL.`,
    };
  }

  if (hasExpiredEvidence) {
    if (!isDouyinUrl(snapshot.url)) {
      return {
        status: 'UNKNOWN',
        reason:
          'Login or reauthentication controls are visible on a non-Douyin URL; DOM and URL evidence contradict each other.',
      };
    }

    const evidence = [
      ...snapshot.authMode,
      ...snapshot.authSupport,
      ...snapshot.reauthentication,
      ...(snapshot.loginButtonVisible ? ['explicit login button'] : []),
    ];
    return {
      status: 'AUTH_EXPIRED',
      reason: `Explicit login or reauthentication evidence is visible (${evidence.join(', ')}).`,
    };
  }

  return undefined;
}

async function collectVisibleCssSignals(
  page: Page,
  signals: readonly AuthCssSignal[],
): Promise<string[]> {
  const matches = await Promise.all(
    signals.map(async (signal) =>
      (await hasVisible(page.locator(signal.selector))) ? signal.label : undefined,
    ),
  );
  return matches.filter((match): match is string => match !== undefined);
}

async function collectVisibleExactTexts(page: Page, texts: readonly string[]): Promise<string[]> {
  const matches = await Promise.all(
    texts.map(async (text) =>
      (await hasVisible(page.getByText(text, { exact: true }))) ? `text "${text}"` : undefined,
    ),
  );
  return matches.filter((match): match is string => match !== undefined);
}

async function hasVisible(locator: Locator): Promise<boolean> {
  const count = Math.min(await locator.count(), MAX_SIGNAL_MATCHES_TO_INSPECT);

  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) {
      return true;
    }
  }

  return false;
}

function isExpectedChatUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isDouyinHostname(parsed.hostname) && parsed.pathname.startsWith('/chat');
  } catch {
    return false;
  }
}

function isDouyinLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      isDouyinHostname(parsed.hostname) &&
      (parsed.pathname.includes('/login') || parsed.pathname.includes('/passport'))
    );
  } catch {
    return false;
  }
}

function isDouyinUrl(url: string): boolean {
  try {
    return isDouyinHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isDouyinHostname(hostname: string): boolean {
  return hostname === 'douyin.com' || hostname.endsWith('.douyin.com');
}

function isBrowserErrorUrl(url: string): boolean {
  return url.startsWith('chrome-error://') || url.startsWith('edge-error://');
}

function buildInsufficientEvidenceReason(
  timeoutMs: number,
  snapshot: AuthEvidenceSnapshot | undefined,
): string {
  if (snapshot === undefined) {
    return `Timed out after ${timeoutMs} ms without a readable authentication state.`;
  }

  const partialSignals = [
    ...snapshot.readyShell,
    ...snapshot.readyWorkspace,
    ...snapshot.authMode,
    ...snapshot.authSupport,
  ];
  const suffix =
    partialSignals.length === 0
      ? 'No recognized positive evidence was visible.'
      : `Only partial evidence was visible (${partialSignals.join(', ')}).`;

  return `Timed out after ${timeoutMs} ms without enough evidence for READY or AUTH_EXPIRED. ${suffix}`;
}

function validateDuration(value: number, label: string, allowZero: boolean): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum} ms.`);
  }

  return value;
}

function isClosedTargetError(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    /target page, context or browser has been closed|page has been closed/i.test(cause.message)
  );
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown page inspection failure';
}
