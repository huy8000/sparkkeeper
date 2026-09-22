import {
  AccountValidationError,
  validateDouyinAccountIdentity,
  type DouyinAccountIdentity,
} from '@sparkkeeper/shared';
import type { Locator, Page } from 'playwright';

import { AuthDetector } from './AuthDetector.js';
import type { AuthDetectorOptions } from './types.js';

const PROFILE_ROOT_SELECTORS = [
  '[data-e2e="user-profile"]',
  '[data-testid="account-profile"]',
  '[data-sk-account-profile]',
] as const;
const DISPLAY_NAME_SELECTORS = [
  '[data-e2e="user-name"]',
  '[data-testid="account-display-name"]',
  '[data-sk-display-name]',
] as const;
const UNIQUE_ID_SELECTORS = [
  '[data-e2e="unique-id"]',
  '[data-testid="account-unique-id"]',
  '[data-sk-unique-id]',
] as const;
const SHORT_ID_SELECTORS = [
  '[data-e2e="short-id"]',
  '[data-testid="account-short-id"]',
  '[data-sk-short-id]',
] as const;
const AVATAR_SELECTORS = [
  'img[data-e2e="user-avatar"]',
  'img[data-testid="account-avatar"]',
  'img[data-sk-avatar]',
] as const;
const PROFILE_LINK_SELECTOR = 'a[href*="/user/"]';
const MAX_DOM_VALUE_LENGTH = 4_096;

export type AccountIdentityExtractionErrorCode = 'PROFILE_IDENTITY_UNAVAILABLE';

export class AccountIdentityExtractionError extends Error {
  public readonly code: AccountIdentityExtractionErrorCode;

  public constructor(options?: ErrorOptions) {
    super('The authenticated page did not expose a complete public account identity.', options);
    this.name = 'AccountIdentityExtractionError';
    this.code = 'PROFILE_IDENTITY_UNAVAILABLE';
  }
}

export type AccountOnboardingDetectionResult =
  | { readonly status: 'AUTH_EXPIRED' | 'UNKNOWN'; readonly reason: string }
  | {
      readonly status: 'READY';
      readonly reason: string;
      readonly identity: DouyinAccountIdentity;
    };

/** Reads only already-rendered public account UI. It never inspects browser storage or traffic. */
export class DouyinAccountIdentityExtractor {
  public async extract(page: Page): Promise<DouyinAccountIdentity> {
    if (page.isClosed()) {
      throw new AccountIdentityExtractionError();
    }

    try {
      const profileRoot = await firstVisible(page, PROFILE_ROOT_SELECTORS);
      const displayName = await firstVisibleText(profileRoot ?? page, DISPLAY_NAME_SELECTORS);
      const douyinSecUid =
        (await readBoundedAttribute(profileRoot, 'data-sec-uid')) ??
        (await readSecUidFromPublicProfileLink(profileRoot ?? page));
      const douyinUniqueId =
        (await readBoundedAttribute(profileRoot, 'data-unique-id')) ??
        (await firstVisibleText(profileRoot ?? page, UNIQUE_ID_SELECTORS));
      const douyinShortId =
        (await readBoundedAttribute(profileRoot, 'data-short-id')) ??
        (await firstVisibleText(profileRoot ?? page, SHORT_ID_SELECTORS));
      const avatarRemoteUrl = await firstVisibleAttribute(
        profileRoot ?? page,
        AVATAR_SELECTORS,
        'src',
      );

      return validateDouyinAccountIdentity({
        displayName: displayName ?? '',
        douyinSecUid: douyinSecUid ?? null,
        douyinUniqueId: douyinUniqueId ?? null,
        douyinShortId: douyinShortId ?? null,
        avatarRemoteUrl: avatarRemoteUrl ?? null,
      });
    } catch (cause) {
      if (cause instanceof AccountIdentityExtractionError) {
        throw cause;
      }
      if (cause instanceof AccountValidationError || cause instanceof Error) {
        throw new AccountIdentityExtractionError({ cause });
      }
      throw new AccountIdentityExtractionError();
    }
  }
}

export class AccountOnboardingDetector {
  private readonly authDetector: AuthDetector;
  private readonly identityExtractor: DouyinAccountIdentityExtractor;

  public constructor(
    options: AuthDetectorOptions = {},
    identityExtractor = new DouyinAccountIdentityExtractor(),
  ) {
    this.authDetector = new AuthDetector(options);
    this.identityExtractor = identityExtractor;
  }

  public async detect(page: Page): Promise<AccountOnboardingDetectionResult> {
    const auth = await this.authDetector.detect(page);
    if (auth.status !== 'READY') {
      return { status: auth.status, reason: auth.reason };
    }

    return {
      ...auth,
      identity: await this.identityExtractor.extract(page),
    };
  }
}

type LocatorRoot = Page | Locator;

async function firstVisible(
  root: LocatorRoot,
  selectors: readonly string[],
): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const locator = root.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      return locator;
    }
  }
  return undefined;
}

async function firstVisibleText(
  root: LocatorRoot,
  selectors: readonly string[],
): Promise<string | undefined> {
  const locator = await firstVisible(root, selectors);
  if (locator === undefined) {
    return undefined;
  }
  return readBoundedDomValue(locator, 'text');
}

async function firstVisibleAttribute(
  root: LocatorRoot,
  selectors: readonly string[],
  attribute: string,
): Promise<string | undefined> {
  const locator = await firstVisible(root, selectors);
  return readBoundedAttribute(locator, attribute);
}

async function readBoundedAttribute(
  locator: Locator | undefined,
  attribute: string,
): Promise<string | undefined> {
  if (locator === undefined) {
    return undefined;
  }
  return readBoundedDomValue(locator, 'attribute', attribute);
}

async function readBoundedDomValue(
  locator: Locator,
  mode: 'text' | 'attribute',
  attribute?: string,
): Promise<string | undefined> {
  const value = await locator.evaluate(
    (
      element,
      input: { mode: 'text' | 'attribute'; attribute: string | null; maxLength: number },
    ): string | null => {
      const raw =
        input.mode === 'text'
          ? element.textContent
          : input.attribute === null
            ? null
            : element.getAttribute(input.attribute);
      return raw === null ? null : raw.slice(0, input.maxLength + 1);
    },
    { mode, attribute: attribute ?? null, maxLength: MAX_DOM_VALUE_LENGTH },
  );
  if (value === null || value.length > MAX_DOM_VALUE_LENGTH) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

async function readSecUidFromPublicProfileLink(root: LocatorRoot): Promise<string | undefined> {
  const link = await firstVisible(root, [PROFILE_LINK_SELECTOR]);
  const href = await readBoundedAttribute(link, 'href');
  if (href === undefined) {
    return undefined;
  }

  try {
    const url = new URL(href, 'https://www.douyin.com');
    if (url.hostname !== 'douyin.com' && !url.hostname.endsWith('.douyin.com')) {
      return undefined;
    }
    const match = /^\/user\/([^/?#]+)(?:[/?#]|$)/u.exec(url.pathname);
    return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}
