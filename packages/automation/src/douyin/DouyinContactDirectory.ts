import {
  validateContactObservation,
  type ContactObservation,
  type ContactSyncFailureCode,
  type ContactType,
} from '@sparkkeeper/shared';
import type { Page } from 'playwright';
import { AuthDetector } from './AuthDetector.js';
import { DouyinAccountIdentityExtractor } from './AccountOnboardingDetector.js';
import {
  CONVERSATION_LIST_SELECTORS,
  CONVERSATION_ITEM_SELECTOR,
  CONVERSATION_TITLE_SELECTORS,
} from './selectors.js';

export interface DirectoryWindow {
  rows: readonly unknown[];
  issues: number;
  signature: string;
  loading: boolean;
  end: boolean;
  empty: boolean;
  contiguous: boolean;
}
export interface DirectorySource {
  reset(): Promise<void>;
  window(): Promise<DirectoryWindow>;
  advance(): Promise<boolean>;
  verifyBoundary(signature: string): Promise<boolean>;
  auth(): Promise<'READY' | 'AUTH_EXPIRED' | 'UNKNOWN'>;
}
export interface DirectoryResult {
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'AUTH_EXPIRED';
  failureCode: ContactSyncFailureCode | null;
  observations: ContactObservation[];
  issueCount: number;
  authChecked: boolean;
}
export interface DirectoryRowProjection {
  title: string;
  type: string | null;
  secUid?: string | null;
  uniqueId?: string | null;
  shortId?: string | null;
  conversationId?: string | null;
  profileLinks: readonly (string | null)[];
}
/** Parse only the allowlisted projection of one directory row, never page data. */
export function parseDirectoryRow(
  raw: DirectoryRowProjection,
  observedAt: number,
): ContactObservation {
  const identities: ContactObservation['identities'] = {};
  let type: ContactType = ['PERSON', 'GROUP', 'SYSTEM', 'UNKNOWN'].includes(raw.type ?? '')
    ? (raw.type as ContactType)
    : 'UNKNOWN';
  if (raw.type && type === 'UNKNOWN' && raw.type !== 'UNKNOWN')
    throw new Error('Unrecognized type evidence.');
  // Group member profile links/attributes are not the group's identity.
  if (type !== 'GROUP' && type !== 'SYSTEM') {
    if (raw.secUid) identities.SEC_UID = raw.secUid;
    if (raw.uniqueId) identities.UNIQUE_ID = raw.uniqueId;
    if (raw.shortId) identities.SHORT_ID = raw.shortId;
    if (raw.profileLinks.length > 1) throw new Error('Ambiguous profile reference.');
    if (raw.profileLinks.length === 1) {
      const reference = raw.profileLinks[0];
      if (typeof reference !== 'string' || reference.length > 2048)
        throw new Error('Invalid profile reference.');
      const link = new URL(reference, 'https://www.douyin.com');
      if (
        link.origin !== 'https://www.douyin.com' ||
        link.search ||
        link.hash ||
        link.username ||
        link.password
      )
        throw new Error('Unsafe profile reference.');
      const uid = /^\/user\/([^/]+)\/?$/u.exec(link.pathname)?.[1];
      if (!uid || (identities.SEC_UID && identities.SEC_UID !== uid))
        throw new Error('Conflicting identity.');
      identities.SEC_UID = uid;
      type = 'PERSON';
    }
  }
  if (raw.conversationId) identities.CONVERSATION_ID = raw.conversationId;
  return validateContactObservation({
    type,
    displayName: raw.title,
    remarkName: null,
    identities,
    avatarRemoteUrl: null,
    streakDays: null,
    observedAt,
    adapterVersion: 'dom-conservative-v1',
  });
}
export async function collectContactDirectory(
  source: DirectorySource,
  deadline: number,
  now: () => number = Date.now,
): Promise<DirectoryResult> {
  const observations: ContactObservation[] = [];
  let issues = 0,
    firstSignature = '';
  const finish = (
    status: DirectoryResult['status'],
    failureCode: ContactSyncFailureCode | null,
  ): DirectoryResult => ({
    status,
    failureCode,
    observations: status === 'FAILED' || status === 'AUTH_EXPIRED' ? [] : observations,
    issueCount: status === 'FAILED' || status === 'AUTH_EXPIRED' ? 0 : issues,
    authChecked: true,
  });
  await source.reset();
  for (let window = 0; window < 50; window++) {
    if (now() >= deadline) return finish('PARTIAL', 'DISCOVERY_TIMEOUT');
    const auth = await source.auth();
    if (auth !== 'READY')
      return finish(
        auth === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'FAILED',
        auth === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'AUTH_UNKNOWN',
      );
    const view = await source.window();
    if (window === 0) firstSignature = view.signature;
    if (view.loading || !view.contiguous)
      return finish(observations.length ? 'PARTIAL' : 'FAILED', 'PARSER_CONTRACT_FAILURE');
    issues += view.issues;
    for (const raw of view.rows) {
      if (observations.length + issues >= 500) return finish('PARTIAL', 'CANDIDATE_LIMIT_REACHED');
      try {
        observations.push(validateContactObservation(raw));
      } catch {
        issues++;
      }
    }
    if (observations.length + issues >= 500) return finish('PARTIAL', 'CANDIDATE_LIMIT_REACHED');
    if (view.end || view.empty) {
      if (!(await source.verifyBoundary(firstSignature)))
        return finish('PARTIAL', 'DISCOVERY_STALLED');
      if (issues)
        return finish(observations.length ? 'PARTIAL' : 'FAILED', 'PARSER_CONTRACT_FAILURE');
      return finish('COMPLETE', null);
    }
    if (!(await source.advance())) return finish('PARTIAL', 'DISCOVERY_STALLED');
  }
  return finish('PARTIAL', 'CANDIDATE_LIMIT_REACHED');
}

/** Conservative DOM adapter: no live end-of-directory contract is verified yet. */
export class DouyinContactDirectory implements DirectorySource {
  private listSelector: string | undefined;
  constructor(
    private readonly page: Page,
    private readonly expected: { secUid: string | null; uniqueId: string | null },
    private readonly deadline: number,
  ) {}
  private remaining() {
    const left = this.deadline - Date.now();
    if (left <= 0) throw new Error('Discovery deadline.');
    return Math.min(2000, left);
  }
  async auth(): Promise<'READY' | 'AUTH_EXPIRED' | 'UNKNOWN'> {
    const result = await new AuthDetector({ timeoutMs: this.remaining() }).detect(this.page);
    if (result.status !== 'READY') return result.status;
    // Never permit extractor's page-wide fallback to mistake a Contact for self.
    const roots = this.page.locator('[data-e2e="user-profile"]');
    if ((await roots.count()) !== 1 || !(await roots.isVisible())) return 'UNKNOWN';
    try {
      const self = await new DouyinAccountIdentityExtractor().extract(this.page);
      return this.expected.secUid
        ? self.douyinSecUid === this.expected.secUid
          ? 'READY'
          : 'UNKNOWN'
        : this.expected.uniqueId && self.douyinUniqueId === this.expected.uniqueId
          ? 'READY'
          : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }
  private async list() {
    if (this.listSelector) return this.page.locator(this.listSelector).first();
    for (const signal of CONVERSATION_LIST_SELECTORS.filter(
      (s) => !s.selector.includes('data-testid'),
    )) {
      const list = this.page.locator(signal.selector);
      if ((await list.count()) === 1 && (await list.isVisible())) {
        this.listSelector = signal.selector;
        return list;
      }
    }
    throw new Error('Directory contract unavailable.');
  }
  async reset() {
    const list = await this.list();
    await list.evaluate((e) => {
      e.scrollTop = 0;
    });
    await this.page.waitForTimeout(Math.min(250, this.remaining()));
  }
  async window(): Promise<DirectoryWindow> {
    const list = await this.list();
    const items = list.locator(CONVERSATION_ITEM_SELECTOR);
    const rows: ContactObservation[] = [];
    let issues = 0;
    const count = await items.count();
    if (count > 500) throw new Error('Directory window too large.');
    for (let index = 0; index < count; index++) {
      this.remaining();
      const item = items.nth(index);
      const raw = await item.evaluate(
        (element, titleSelectors) => {
          const title = titleSelectors.map((s) => element.querySelector(s)).find(Boolean);
          const profileLinks = Array.from(element.querySelectorAll('a[href*="/user/"]')).map(
            (a) => a.getAttribute('href')?.slice(0, 2049) ?? null,
          );
          return {
            title: Array.from(title?.textContent ?? '')
              .slice(0, 201)
              .join(''),
            type: element.getAttribute('data-conversation-type')?.slice(0, 16) ?? null,
            secUid: Array.from(element.getAttribute('data-sec-uid') ?? '')
              .slice(0, 513)
              .join(''),
            uniqueId: Array.from(element.getAttribute('data-unique-id') ?? '')
              .slice(0, 513)
              .join(''),
            shortId: Array.from(element.getAttribute('data-short-id') ?? '')
              .slice(0, 513)
              .join(''),
            conversationId: Array.from(element.getAttribute('data-conversation-id') ?? '')
              .slice(0, 513)
              .join(''),
            profileLinks: profileLinks.slice(0, 2),
          };
        },
        CONVERSATION_TITLE_SELECTORS.filter((s) => !s.includes('data-testid')),
      );
      try {
        rows.push(parseDirectoryRow(raw, Date.now()));
      } catch {
        issues++;
      }
    }
    return {
      rows,
      issues,
      signature: JSON.stringify(rows.map((r) => r.identities)),
      loading: false,
      end: false,
      empty: false,
      contiguous: count > 0,
    };
  }
  async advance() {
    const list = await this.list();
    const moved = await list.evaluate((e) => {
      const before = e.scrollTop;
      e.scrollTop += Math.max(1, Math.floor(e.clientHeight * 0.8));
      return e.scrollTop > before;
    });
    await this.page.waitForTimeout(Math.min(250, this.remaining()));
    return moved;
  }
  async verifyBoundary() {
    return false;
  }
}
