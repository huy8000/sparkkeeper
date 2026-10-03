import type { JSHandle, Page, Frame } from 'playwright';
import { DELIVERY_LOCAL_V1, TARGET_RESOLVER_LOCAL_STATIC_V1 } from '../selectors.js';
import type { ResolutionWitnessBinding } from '../resolver/ResolutionWitness.js';
import {
  stopDelivery,
  type DeliveryBudget,
  type DeliveryEvidence,
  type DeliveryObservationPort,
} from './types.js';

interface Scope {
  ready(): void;
  boundary(remaining: number): void;
  invoke(remaining: number): void;
  observe(): DeliveryEvidence;
  reconcile(): DeliveryEvidence;
  dispose(): void;
}
/** No verified live action contract yet. Only a controlled loopback fixture can invoke a button. */
export class DouyinDeliveryPage implements DeliveryObservationPort {
  private scope: JSHandle<Scope> | undefined;
  private pendingScope: Promise<JSHandle<Scope>> | undefined;
  private disposed = false;
  private navigated = false;
  private readonly onNavigation = (frame: Frame) => {
    if (frame === this.handle.mainFrame()) this.navigated = true;
  };
  private constructor(
    private readonly handle: Page,
    private readonly local: boolean,
  ) {}
  get page(): object {
    return this.handle;
  }
  get context(): object {
    return this.handle.context();
  }
  static forOwnedPage(page: Page): DouyinDeliveryPage {
    return new DouyinDeliveryPage(page, false);
  }
  static forControlledLocalPage(page: Page): DouyinDeliveryPage {
    return new DouyinDeliveryPage(page, true);
  }
  private check(budget: DeliveryBudget): void {
    budget.assertActive();
    if (this.disposed || this.handle.isClosed() || this.navigated) stopDelivery('PAGE_UNAVAILABLE');
    const url = new URL(this.handle.url());
    if (
      !this.local ||
      !['http:', 'https:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/chat' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      stopDelivery('SELECTOR_CONTRACT_UNAVAILABLE');
  }
  async arm(
    binding: ResolutionWitnessBinding,
    knownText: string,
    budget: DeliveryBudget,
  ): Promise<void> {
    this.check(budget);
    if (
      this.scope ||
      this.pendingScope ||
      binding.page !== this.page ||
      binding.context !== this.context
    )
      stopDelivery('WITNESS_INVALID');
    this.handle.on('framenavigated', this.onNavigation);
    const pending = this.handle.evaluateHandle(
      (input) => {
        type Projection = {
          id: string | null;
          sequence: number;
          direction: string;
          kind: string;
          matches: boolean;
          fingerprint: string;
          signature: string;
        };
        let disposed = false,
          clicked = false,
          boundaryArmed = false;
        let expires = performance.now() + input.remaining;
        let identityMutations = 0,
          events = 0,
          tail = 0;
        let invalid: string | null = null;
        const seenIds = new Map<string, string>(),
          seenSequences = new Map<number, string>();
        const proofs = new Map<string, Projection>();
        const tools = {
          visible(e: Element): e is HTMLElement {
            return (
              e instanceof HTMLElement &&
              e.getClientRects().length > 0 &&
              getComputedStyle(e).visibility !== 'hidden'
            );
          },
          unique(selector: string): HTMLElement {
            const all = Array.from(document.querySelectorAll(selector));
            if (all.length !== 1 || !tools.visible(all[0]!))
              throw new Error('SELECTOR_CONTRACT_UNAVAILABLE');
            return all[0] as HTMLElement;
          },
          identifier(value: string | null): string | null {
            if (value === null) return null;
            if (
              !value ||
              value !== value.trim() ||
              value.length > 256 ||
              /[\p{Cc}\p{Cf}]/u.test(value)
            )
              throw new Error('EVIDENCE_INSUFFICIENT');
            return value;
          },
          project(e: Element): Projection {
            if (
              !(e instanceof HTMLDivElement) ||
              !e.matches(input.selectors.row) ||
              !tools.visible(e)
            )
              throw new Error('EVIDENCE_INSUFFICIENT');
            const sequenceValue = e.getAttribute('data-message-sequence');
            if (
              !sequenceValue ||
              !/^(0|[1-9][0-9]*)$/u.test(sequenceValue) ||
              !Number.isSafeInteger(Number(sequenceValue))
            )
              throw new Error('EVIDENCE_INSUFFICIENT');
            const sequence = Number(sequenceValue),
              id = tools.identifier(e.getAttribute('data-message-id'));
            const direction = e.getAttribute('data-direction'),
              kind = e.getAttribute('data-message-kind');
            if (direction !== 'OUTGOING' && direction !== 'INCOMING')
              throw new Error('EVIDENCE_INSUFFICIENT');
            let matches = false;
            if (direction === 'OUTGOING' && kind === 'TEXT') {
              const text = Array.from(e.children);
              if (
                text.length !== 1 ||
                !(text[0] instanceof HTMLSpanElement) ||
                !text[0].matches(input.selectors.text) ||
                text[0].children.length ||
                Array.from(e.childNodes).some(
                  (n) =>
                    n !== text[0] &&
                    (n.nodeType !== Node.TEXT_NODE || /\S/u.test(n.textContent ?? '')),
                )
              )
                throw new Error('EVIDENCE_INSUFFICIENT');
              // Comparison only: neither history text nor incoming text leaves this JS turn.
              matches = (text[0].textContent ?? '').replaceAll('\r\n', '\n') === input.knownText;
            }
            const fingerprint = JSON.stringify([
              direction,
              kind,
              matches,
              sequence,
              tools.identifier(e.getAttribute('data-message-timestamp')),
            ]);
            return {
              id,
              sequence,
              direction,
              kind: kind ?? 'UNKNOWN',
              matches,
              fingerprint,
              signature: fingerprint,
            };
          },
          learn(p: Projection): boolean {
            const oldId = p.id ? seenIds.get(p.id) : undefined,
              oldSequence = seenSequences.get(p.sequence);
            if (
              (oldId && oldId !== p.signature) ||
              (oldSequence && oldSequence !== `${p.id ?? ''}:${p.signature}`)
            )
              throw new Error('EVIDENCE_INSUFFICIENT');
            const existed = oldId !== undefined || oldSequence !== undefined;
            if (p.id) seenIds.set(p.id, p.signature);
            seenSequences.set(p.sequence, `${p.id ?? ''}:${p.signature}`);
            if (seenSequences.size > 1500) throw new Error('OBSERVATION_FAILED');
            return existed;
          },
          scan() {
            const rows = Array.from(list.children);
            if (rows.length > 500 || list.getAttribute('data-sk-delivery-at-tail') !== 'true')
              throw new Error('EVIDENCE_INSUFFICIENT');
            const ids = new Set<string>();
            let previous = -1;
            for (const element of rows) {
              const p = tools.project(element);
              if (p.sequence <= previous || (p.id && ids.has(p.id)))
                throw new Error('EVIDENCE_INSUFFICIENT');
              if (p.id) ids.add(p.id);
              previous = p.sequence;
              tools.learn(p);
              if (!clicked) tail = Math.max(tail, p.sequence);
            }
          },
          identity() {
            if (
              disposed ||
              !list.isConnected ||
              tools.unique(input.selectors.list) !== list ||
              tools.unique(input.target.current) !== header ||
              tools.unique(input.target.self) !== self ||
              tools.unique(input.target.directory) !== directory ||
              tools.unique('[data-sk-resolver-auth]') !== auth ||
              auth.getAttribute('data-sk-resolver-auth') !== 'READY' ||
              list.getAttribute('data-conversation-id') !== input.anchor ||
              header.getAttribute('data-conversation-id') !== input.anchor ||
              header.getAttribute('data-contact-type') !== input.contactType ||
              header.getAttribute(input.preferredAttribute) !== input.preferredValue ||
              self.getAttribute(input.selfAttribute) !== input.selfValue
            )
              throw new Error('TARGET_CHANGED');
            if (performance.now() >= expires) throw new Error('DELIVERY_TIMEOUT');
          },
          consume(records: MutationRecord[]) {
            try {
              if ((events += records.length) > 1000) throw new Error('OBSERVATION_FAILED');
              for (const record of records) {
                if (record.type !== 'childList' || record.target !== list) continue;
                for (const node of Array.from(record.addedNodes)) {
                  if (!(node instanceof Element)) continue;
                  const p = tools.project(node),
                    existed = tools.learn(p);
                  if (!clicked) {
                    tail = Math.max(tail, p.sequence);
                    continue;
                  }
                  if (existed || p.sequence <= tail) continue; // Remount/history, never newness.
                  if (p.direction === 'OUTGOING' && p.kind !== 'TEXT')
                    throw new Error('EVIDENCE_INSUFFICIENT');
                  if (p.direction === 'OUTGOING' && p.matches)
                    proofs.set(p.id ? `id:${p.id}` : `fp:${p.fingerprint}`, p);
                }
              }
            } catch (error) {
              invalid = error instanceof Error ? error.message : 'OBSERVATION_FAILED';
            }
          },
          flush() {
            tools.consume(observer.takeRecords());
            identityMutations += identityObserver.takeRecords().length;
            tools.identity();
            if (identityMutations) throw new Error('TARGET_CHANGED');
            if (invalid) throw new Error(invalid);
            tools.scan();
          },
          ready() {
            tools.flush();
            const composer = tools.unique(input.selectors.composer),
              control = tools.unique(input.selectors.control);
            if (
              !(composer instanceof HTMLTextAreaElement) ||
              composer.disabled ||
              composer.readOnly ||
              composer.closest('[inert]') ||
              composer.getAttribute('aria-readonly') === 'true' ||
              composer.getAttribute('aria-disabled') === 'true' ||
              composer.getAttribute('data-conversation-id') !== input.anchor ||
              composer.value.replaceAll('\r\n', '\n') !== input.knownText
            )
              throw new Error('PREPARED_INPUT_MISMATCH');
            if (
              !(control instanceof HTMLButtonElement) ||
              control.type !== 'button' ||
              control.disabled ||
              control.getAttribute('aria-disabled') === 'true' ||
              control.getAttribute('data-conversation-id') !== input.anchor ||
              control.closest('form') ||
              control.closest('[inert]')
            )
              throw new Error('SELECTOR_CONTRACT_UNAVAILABLE');
            return control;
          },
          evidence(): DeliveryEvidence {
            tools.flush();
            return proofs.size > 1 ? 'AMBIGUOUS' : proofs.size === 1 ? 'VERIFIED' : 'PENDING';
          },
        };
        const list = tools.unique(input.selectors.list),
          header = tools.unique(input.target.current),
          self = tools.unique(input.target.self),
          directory = tools.unique(input.target.directory),
          auth = tools.unique('[data-sk-resolver-auth]');
        tools.identity();
        tools.scan();
        const observer = new MutationObserver((records) => tools.consume(records));
        const identityObserver = new MutationObserver((records) => {
          identityMutations += records.length;
        });
        observer.observe(list, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        for (const node of [header, self, directory, auth])
          identityObserver.observe(node, { subtree: true, childList: true, attributes: true });
        return {
          ready() {
            tools.ready();
          },
          boundary(remaining: number) {
            tools.ready();
            expires = Math.min(expires, performance.now() + remaining);
            boundaryArmed = true;
          },
          invoke(remaining: number) {
            expires = Math.min(expires, performance.now() + remaining);
            if (clicked || !boundaryArmed) throw new Error('ACTION_UNCERTAIN');
            const control = tools.ready(); // drain pre-action mutations and recheck in this same JS turn
            clicked = true;
            control.click();
          },
          observe() {
            return tools.evidence();
          },
          reconcile() {
            return tools.evidence();
          },
          dispose() {
            disposed = true;
            observer.disconnect();
            identityObserver.disconnect();
            proofs.clear();
            seenIds.clear();
            seenSequences.clear();
          },
        };
      },
      {
        knownText,
        remaining: budget.remaining(),
        selectors: DELIVERY_LOCAL_V1,
        target: TARGET_RESOLVER_LOCAL_STATIC_V1,
        anchor: binding.candidate.anchor,
        contactType: binding.request.contactType,
        preferredAttribute: attribute(binding.request.preferredIdentity.kind),
        preferredValue: binding.request.preferredIdentity.normalizedValue,
        selfAttribute: attribute(binding.self.kind),
        selfValue: binding.self.normalizedValue,
      },
    );
    this.pendingScope = pending;
    const scope = await budget.run(() => pending);
    if (this.disposed) stopDelivery('PAGE_UNAVAILABLE');
    this.scope = scope;
  }
  private async call(
    budget: DeliveryBudget,
    operation: 'ready' | 'boundary' | 'invoke' | 'observe' | 'reconcile',
  ): Promise<DeliveryEvidence | undefined> {
    this.check(budget);
    if (!this.scope) stopDelivery('OBSERVATION_FAILED');
    const result = await budget.run(() =>
      this.scope!.evaluate(
        (scope, args) => {
          try {
            let value: DeliveryEvidence | undefined;
            switch (args.operation) {
              case 'ready':
                scope.ready();
                break;
              case 'boundary':
                scope.boundary(args.remaining);
                break;
              case 'invoke':
                scope.invoke(args.remaining);
                break;
              case 'observe':
                value = scope.observe();
                break;
              case 'reconcile':
                value = scope.reconcile();
                break;
            }
            return { ok: true as const, value };
          } catch (error) {
            const reasons = [
              'TARGET_CHANGED',
              'DELIVERY_TIMEOUT',
              'EVIDENCE_INSUFFICIENT',
              'OBSERVATION_FAILED',
              'PREPARED_INPUT_MISMATCH',
              'SELECTOR_CONTRACT_UNAVAILABLE',
              'ACTION_UNCERTAIN',
            ] as const;
            const reason =
              reasons.find((value) => error instanceof Error && error.message === value) ??
              'OBSERVATION_FAILED';
            return { ok: false as const, reason };
          }
        },
        { operation, remaining: budget.remaining() },
      ),
    );
    if (!result.ok) stopDelivery(result.reason);
    return result.value;
  }
  async ready(budget: DeliveryBudget): Promise<void> {
    await this.call(budget, 'ready');
  }
  async beginBoundary(budget: DeliveryBudget): Promise<void> {
    await this.call(budget, 'boundary');
  }
  async invokeOnce(budget: DeliveryBudget): Promise<void> {
    await this.call(budget, 'invoke');
  }
  async observe(budget: DeliveryBudget): Promise<DeliveryEvidence> {
    const value = await this.call(budget, 'observe');
    if (!value) stopDelivery('OBSERVATION_FAILED');
    return value;
  }
  async reconcile(budget: DeliveryBudget): Promise<DeliveryEvidence> {
    const value = await this.call(budget, 'reconcile');
    if (!value) stopDelivery('OBSERVATION_FAILED');
    return value;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.handle.off('framenavigated', this.onNavigation);
    const pending = this.pendingScope;
    this.pendingScope = undefined;
    const scope = this.scope ?? (pending ? await pending : undefined);
    this.scope = undefined;
    if (scope) {
      try {
        await scope.evaluate((s) => s.dispose());
      } finally {
        await scope.dispose();
      }
    }
  }
}
function attribute(kind: string): string {
  const attrs: Record<string, string> = {
    SEC_UID: 'data-sec-uid',
    UNIQUE_ID: 'data-unique-id',
    SHORT_ID: 'data-short-id',
    CONVERSATION_ID: 'data-conversation-id',
  };
  return attrs[kind] ?? '__unsupported_identity__';
}
