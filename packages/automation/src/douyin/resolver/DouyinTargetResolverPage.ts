import {
  normalizeResolverIdentifier,
  type ResolverAccountBinding,
  type TargetResolutionFailure,
} from '@sparkkeeper/shared';
import type { Frame, JSHandle, Page } from 'playwright';
import { TARGET_RESOLVER_DOM_V1, TARGET_RESOLVER_LOCAL_STATIC_V1 } from '../selectors.js';
import {
  ResolverBudget,
  stopResolution,
  type ResolverCandidate,
  type ResolverDirectoryPort,
  type ResolverDirectoryWindow,
  type ResolverPageState,
} from './types.js';

interface DomScope {
  state(): { directoryRevision: number; selectionRevision: number; exhaustive: boolean };
  self(): ResolverCandidate;
  window(): ResolverCandidate[];
  current(): ResolverCandidate;
  reset(): void;
  open(
    candidate: ResolverCandidate,
    revision: number,
    deadline: number,
  ): 'OPENED' | 'CHANGED' | 'MISSING' | 'INVALID' | 'EXPIRED';
  dispose(): void;
}

/** Reads only scoped identity attributes. The live contract deliberately cannot certify end. */
export class DouyinTargetResolverPage implements ResolverDirectoryPort {
  private navigation: object = {};
  private scope: JSHandle<DomScope> | undefined;
  private disposed = false;
  private readonly onNavigation = (frame: Frame) => {
    if (frame === this.page.mainFrame()) this.navigation = {};
  };
  private constructor(
    private readonly page: Page,
    private readonly local: boolean,
  ) {
    page.on('framenavigated', this.onNavigation);
  }
  static forOwnedPage(page: Page): DouyinTargetResolverPage {
    return new DouyinTargetResolverPage(page, false);
  }
  static forControlledLocalPage(page: Page): DouyinTargetResolverPage {
    return new DouyinTargetResolverPage(page, true);
  }

  async pageState(budget: ResolverBudget): Promise<ResolverPageState> {
    this.checkPage(budget);
    const observed = this.scope
      ? await budget.run(() => this.scope!.evaluate((scope) => scope.state()))
      : null;
    return {
      page: this.page,
      context: this.page.context(),
      navigation: this.navigation,
      selectionRevision: observed?.selectionRevision ?? 0,
      directoryEpoch: observed ? String(observed.directoryRevision) : null,
    };
  }
  async auth(
    binding: ResolverAccountBinding,
    budget: ResolverBudget,
  ): Promise<TargetResolutionFailure | null> {
    this.checkPage(budget);
    const signals = this.local
      ? await budget.run(() =>
          this.page.evaluate(() => {
            const nodes = Array.from(document.querySelectorAll('[data-sk-resolver-auth]')).filter(
              (e) =>
                e instanceof HTMLElement &&
                e.getClientRects().length > 0 &&
                getComputedStyle(e).visibility !== 'hidden',
            );
            return {
              expired:
                nodes.length === 1 &&
                nodes[0]!.getAttribute('data-sk-resolver-auth') === 'AUTH_EXPIRED',
              ready:
                nodes.length === 1 && nodes[0]!.getAttribute('data-sk-resolver-auth') === 'READY',
            };
          }),
        )
      : await budget.run(async () => {
          const login = this.page.getByRole('button', { name: '登录', exact: true });
          const self = this.page.locator(TARGET_RESOLVER_DOM_V1.self);
          const loginCount = await login.count(),
            selfCount = await self.count();
          if (loginCount > 1 || selfCount > 1) return { expired: false, ready: false };
          const loginVisible = loginCount === 1 && (await login.isVisible());
          const selfVisible = selfCount === 1 && (await self.isVisible());
          return { expired: loginVisible && !selfVisible, ready: !loginVisible && selfVisible };
        });
    if (signals.expired) stopResolution('AUTH_EXPIRED');
    if (!signals.ready) stopResolution('AUTH_UNKNOWN');
    const scope = await this.getScope(budget);
    const self = await budget.run(() => scope.evaluate((s) => s.self()));
    if (self.conflict) stopResolution('AUTH_UNKNOWN');
    const value = self.identities[binding.kind];
    if (!value || normalizeResolverIdentifier(value) !== value) stopResolution('AUTH_UNKNOWN');
    if (value !== binding.normalizedValue) stopResolution('ACCOUNT_IDENTITY_MISMATCH');
    return null;
  }
  async reset(budget: ResolverBudget): Promise<void> {
    const scope = await this.getScope(budget);
    await budget.run(() => scope.evaluate((s) => s.reset()));
  }
  async readWindow(budget: ResolverBudget): Promise<ResolverDirectoryWindow> {
    const scope = await this.getScope(budget);
    const view = await budget.run(() =>
      scope.evaluate((s) => ({ candidates: s.window(), state: s.state() })),
    );
    const complete = this.local && view.state.exhaustive;
    return {
      candidates: view.candidates,
      epoch: String(view.state.directoryRevision),
      coverage: complete ? 'STATIC' : 'UNPROVEN',
      beginning: complete,
      end: complete,
      empty: complete && view.candidates.length === 0,
      contiguous: complete,
      loading: false,
    };
  }
  async advance(budget: ResolverBudget): Promise<boolean> {
    this.checkPage(budget);
    return false;
  }
  async certifyCoverage(epoch: string, budget: ResolverBudget): Promise<boolean> {
    this.checkPage(budget);
    if (!this.local) return false;
    const scope = await this.getScope(budget);
    return await budget.run(() =>
      scope.evaluate((s, expected) => {
        const state = s.state();
        return state.exhaustive && String(state.directoryRevision) === expected;
      }, epoch),
    );
  }
  async openCandidate(
    candidate: ResolverCandidate,
    epoch: string,
    budget: ResolverBudget,
  ): Promise<void> {
    if (!this.local) stopResolution('SELECTOR_CONTRACT_UNAVAILABLE');
    const scope = await this.getScope(budget);
    budget.observe(1);
    const result = await budget.run(() =>
      scope.evaluate((s, args) => s.open(args.candidate, args.revision, args.deadline), {
        candidate,
        revision: Number(epoch),
        deadline: budget.deadline,
      }),
    );
    if (result === 'EXPIRED') stopResolution('RESOLUTION_TIMEOUT');
    if (result === 'CHANGED') stopResolution('IDENTITY_CHANGED');
    if (result === 'MISSING') stopResolution('TARGET_DISAPPEARED');
    if (result !== 'OPENED') stopResolution('DIRECTORY_INCOMPLETE');
  }
  async currentConversation(budget: ResolverBudget): Promise<ResolverCandidate> {
    const scope = await this.getScope(budget);
    return budget.run(() => scope.evaluate((s) => s.current()));
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.navigation = {};
    this.page.off('framenavigated', this.onNavigation);
    if (this.scope) {
      const scope = this.scope;
      this.scope = undefined;
      await new ResolverBudget(Date.now() + 1000)
        .run(async () => {
          await scope.evaluate((s) => s.dispose());
          await scope.dispose();
        })
        .catch(() => undefined); // Parent still owns/tears down the Page and its process groups.
    }
  }
  private checkPage(budget: ResolverBudget): void {
    budget.assertActive();
    if (this.disposed || this.page.isClosed()) stopResolution('PAGE_CLOSED');
    const url = new URL(this.page.url());
    const origin = this.local
      ? (url.protocol === 'http:' || url.protocol === 'https:') &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      : url.origin === 'https://www.douyin.com';
    if (
      !origin ||
      url.username ||
      url.password ||
      url.pathname !== '/chat' ||
      url.search ||
      url.hash
    )
      stopResolution('SELECTOR_CONTRACT_UNAVAILABLE');
  }
  private async getScope(budget: ResolverBudget): Promise<JSHandle<DomScope>> {
    this.checkPage(budget);
    if (this.scope) return this.scope;
    const selectors = {
      ...(this.local ? TARGET_RESOLVER_LOCAL_STATIC_V1 : TARGET_RESOLVER_DOM_V1),
      staticLayout: this.local,
    };
    const scope = await budget.run(() =>
      this.page.evaluateHandle((selectors) => {
        // Method expressions stay self-contained when serialized under tsc AND tsx keepNames.
        const visible = {
          check(e: Element) {
            return (
              e instanceof HTMLElement &&
              e.getClientRects().length > 0 &&
              getComputedStyle(e).visibility !== 'hidden'
            );
          },
        }.check;
        const unique = {
          get(selector: string): HTMLElement | null {
            const all = Array.from(document.querySelectorAll(selector));
            return all.length === 1 && all[0] instanceof HTMLElement && visible(all[0])
              ? all[0]
              : null;
          },
        }.get;
        const directory = unique(selectors.directory),
          self = unique(selectors.self),
          current = unique(selectors.current);
        if (!directory || !self || !current || directory === current || directory.contains(current))
          return null;
        const attributes = [
          'data-contact-type',
          'data-type',
          'data-sec-uid',
          'data-unique-id',
          'data-short-id',
          'data-conversation-id',
          'href',
          'hidden',
          'class',
          'style',
          'data-sk-resolver-complete',
          'data-loading',
        ];
        let directoryRevision = 0,
          selectionRevision = 0,
          disposed = false;
        const directoryObserver = new MutationObserver((records) => {
          directoryRevision += records.length;
        });
        const headerObserver = new MutationObserver((records) => {
          selectionRevision += records.length;
        });
        const selfObserver = new MutationObserver((records) => {
          selectionRevision += records.length;
        });
        for (const [observer, element] of [
          [directoryObserver, directory],
          [headerObserver, current],
          [selfObserver, self],
        ] as const)
          observer.observe(element, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: attributes,
          });
        const valid = {
          check() {
            return (
              !disposed &&
              unique(selectors.directory) === directory &&
              unique(selectors.current) === current &&
              unique(selectors.self) === self
            );
          },
        }.check;
        const flush = {
          drain() {
            directoryRevision += directoryObserver.takeRecords().length;
            selectionRevision +=
              headerObserver.takeRecords().length + selfObserver.takeRecords().length;
          },
        }.drain;
        const invalid = {
          candidate(): ResolverCandidate {
            return { anchor: null, type: 'UNKNOWN', identities: {} };
          },
        }.candidate;
        const project = {
          candidate(element: Element, knownSelf = false): ResolverCandidate {
            if (!visible(element)) return invalid();
            const rawType =
              element.getAttribute('data-contact-type') ?? element.getAttribute('data-type');
            const type: ResolverCandidate['type'] = knownSelf
              ? 'PERSON'
              : rawType === 'PERSON' || rawType === 'GROUP' || rawType === 'SYSTEM'
                ? rawType
                : 'UNKNOWN';
            const identities: Partial<
              Record<'SEC_UID' | 'UNIQUE_ID' | 'SHORT_ID' | 'CONVERSATION_ID', string>
            > = {};
            let conflict = false;
            const read = {
              attribute(attribute: string) {
                const value = element.getAttribute(attribute);
                if (value && (value.length > 256 || /[\p{Cc}\p{Cf}]/u.test(value))) conflict = true;
                return value?.trim() || null;
              },
            }.attribute;
            const anchor = read('data-conversation-id');
            if (anchor) identities.CONVERSATION_ID = anchor;
            if (type === 'PERSON') {
              const sec = read('data-sec-uid'),
                unique = read('data-unique-id'),
                short = read('data-short-id');
              if (sec) identities.SEC_UID = sec;
              if (unique) identities.UNIQUE_ID = unique;
              if (short) identities.SHORT_ID = short;
              const links = Array.from(element.querySelectorAll('a[href*="/user/"]'));
              if (links.length > 1) conflict = true;
              if (links.length === 1) {
                try {
                  const href = links[0]!.getAttribute('href') ?? '';
                  const url = new URL(href, 'https://www.douyin.com');
                  const uid = /^\/user\/([^/]+)\/?$/u.exec(url.pathname)?.[1];
                  if (
                    href.length > 2048 ||
                    url.origin !== 'https://www.douyin.com' ||
                    url.search ||
                    url.hash ||
                    url.username ||
                    url.password ||
                    !uid ||
                    uid.length > 256 ||
                    /[\p{Cc}\p{Cf}]/u.test(uid)
                  )
                    conflict = true;
                  else if (sec && sec !== uid) conflict = true;
                  else {
                    identities.SEC_UID = uid;
                  }
                } catch {
                  conflict = true;
                }
              }
            }
            return { anchor, type, identities, conflict };
          },
        }.candidate;
        return {
          state() {
            flush();
            if (!valid()) throw new Error('SELECTOR_CONTRACT_UNAVAILABLE');
            const rows = Array.from(directory.querySelectorAll(selectors.row));
            const exhaustive =
              selectors.staticLayout &&
              directory.getAttribute('data-sk-resolver-complete') === 'true' &&
              directory.getAttribute('data-loading') !== 'true' &&
              rows.length === directory.children.length &&
              Array.from(directory.children).every(
                (e) =>
                  e instanceof HTMLButtonElement && e.type === 'button' && e.matches(selectors.row),
              );
            return { directoryRevision, selectionRevision, exhaustive };
          },
          self() {
            if (!valid()) return invalid();
            return project(self, true);
          },
          window() {
            if (!valid()) return [invalid()];
            return Array.from(directory.querySelectorAll(selectors.row))
              .slice(0, 501)
              .map((e) => project(e));
          },
          current() {
            if (!valid()) return invalid();
            return project(current);
          },
          reset() {
            if (!valid()) throw new Error('SELECTOR_CONTRACT_UNAVAILABLE');
            directory.scrollTop = 0;
          },
          open(expected: ResolverCandidate, revision: number, deadline: number) {
            flush();
            if (Date.now() >= deadline) return 'EXPIRED' as const;
            if (!valid() || revision !== directoryRevision) return 'CHANGED' as const;
            const controls = Array.from(directory.querySelectorAll(selectors.row)).filter(
              (e) => e.getAttribute('data-conversation-id')?.trim() === expected.anchor,
            );
            if (controls.length === 0) return 'MISSING' as const;
            if (controls.length !== 1) return 'INVALID' as const;
            const control = controls[0]!;
            if (
              !(control instanceof HTMLButtonElement) ||
              control.type !== 'button' ||
              control.disabled ||
              control.closest('form') ||
              !visible(control)
            )
              return 'INVALID' as const;
            const actual = project(control);
            if (
              actual.conflict ||
              actual.type !== expected.type ||
              actual.anchor !== expected.anchor ||
              (['SEC_UID', 'UNIQUE_ID', 'SHORT_ID', 'CONVERSATION_ID'] as const).some(
                (kind) => actual.identities[kind] !== expected.identities[kind],
              )
            )
              return 'CHANGED' as const;
            // Same JS turn: no realpath-style check/use gap, virtual nth re-target or send action.
            control.click();
            return 'OPENED' as const;
          },
          dispose() {
            disposed = true;
            directoryObserver.disconnect();
            headerObserver.disconnect();
            selfObserver.disconnect();
          },
        };
      }, selectors),
    );
    if (!(await budget.run(() => scope.evaluate((value) => value !== null)))) {
      await scope.dispose();
      stopResolution('SELECTOR_CONTRACT_UNAVAILABLE');
    }
    this.scope = scope as JSHandle<DomScope>;
    return this.scope;
  }
}
