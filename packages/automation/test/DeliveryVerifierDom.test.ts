import assert from 'node:assert/strict';
import { before, after, test, type TestContext } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { DeliveryVerifier } from '../src/douyin/delivery/DeliveryVerifier.js';
import { DouyinDeliveryPage } from '../src/douyin/delivery/DouyinDeliveryPage.js';
import { DouyinTargetResolverPage } from '../src/douyin/resolver/DouyinTargetResolverPage.js';
import { StableTargetResolver } from '../src/douyin/resolver/StableTargetResolver.js';
import { FixtureDirectory, request } from './resolverFixture.js';

let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
});
const known = 'Synthetic delivery text';
const limits = { verificationTimeoutMs: 250, pollIntervalMs: 10 };
function html(
  action = 'appendFixture(3, "new", "OUTGOING", message)',
  options: { noIds?: boolean; message?: string; noSequence?: boolean; group?: boolean } = {},
) {
  const value = options.message ?? known;
  return `<!doctype html><html><body>
  <div data-sk-resolver-auth="READY">Authenticated fixture</div>
  <div data-sk-resolver-self data-sec-uid="synthetic-self">Synthetic self</div>
  <div data-sk-resolver-directory="static-v1" data-sk-resolver-complete="true">
    <button type="button" data-sk-resolver-conversation data-contact-type="${options.group ? 'GROUP' : 'PERSON'}" data-conversation-id="synthetic-chat-1" data-sec-uid="Fixture-001" onclick="document.querySelector('[data-sk-resolver-current]').setAttribute('data-conversation-id','synthetic-chat-1')">Synthetic target</button>
  </div>
  <header data-sk-resolver-current data-contact-type="${options.group ? 'GROUP' : 'PERSON'}" data-conversation-id="old-chat" data-sec-uid="Fixture-001">Synthetic header</header>
  <div data-sk-delivery-list="static-v1" data-sk-delivery-at-tail="true" data-conversation-id="synthetic-chat-1">
    <div data-sk-delivery-bubble ${options.noIds ? '' : 'data-message-id="old-1"'} ${options.noSequence ? '' : 'data-message-sequence="1"'} data-direction="OUTGOING" data-message-kind="TEXT"><span data-sk-delivery-text>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</span></div>
    <div data-sk-delivery-bubble ${options.noIds ? '' : 'data-message-id="old-2"'} data-message-sequence="2" data-direction="INCOMING" data-message-kind="TEXT"><span data-sk-delivery-text>Unrelated synthetic inbound</span></div>
  </div>
  <textarea data-sk-delivery-composer data-conversation-id="synthetic-chat-1">${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</textarea>
  <button type="button" data-sk-delivery-control data-conversation-id="synthetic-chat-1">Fixture action</button>
  <div id="fixture-toast"></div>
  <script>
    const message = ${JSON.stringify(value)}, noIds = ${JSON.stringify(options.noIds ?? false)};
    window.fixtureActions = 0; window.fixtureEvents = [];
    function appendFixture(sequence, id, direction, text, kind = 'TEXT') {
      const row = document.createElement('div'); row.setAttribute('data-sk-delivery-bubble','');
      row.setAttribute('data-message-sequence',String(sequence));
      if (!noIds && id !== null) row.setAttribute('data-message-id',id);
      row.setAttribute('data-direction',direction); row.setAttribute('data-message-kind',kind);
      const span = document.createElement('span'); span.setAttribute('data-sk-delivery-text',''); span.textContent = text; row.append(span);
      document.querySelector('[data-sk-delivery-list]').append(row);
    }
    document.querySelector('[data-sk-delivery-control]').onclick = () => {
      window.fixtureActions++; window.fixtureEvents.push('click'); ${action};
      document.querySelector('[data-sk-delivery-composer]').value = '';
      document.querySelector('#fixture-toast').textContent = 'Submitted fixture';
    };
  </script></body></html>`;
}
async function fixture(t: TestContext, action?: string, options: Parameters<typeof html>[1] = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) =>
    route.fulfill({ contentType: 'text/html', body: html(action, options) }),
  );
  const page = await context.newPage();
  await page.goto('http://127.0.0.1/chat');
  const directory = DouyinTargetResolverPage.forControlledLocalPage(page),
    owner = new FixtureDirectory();
  const resolver = new StableTargetResolver(directory, owner.owner, owner.binding);
  const targetRequest = options.group
    ? request({
        contactType: 'GROUP',
        preferredIdentity: {
          ...request().preferredIdentity,
          kind: 'CONVERSATION_ID',
          normalizedValue: 'synthetic-chat-1',
        },
      })
    : request();
  const found = await resolver.resolve(targetRequest, Date.now() + 10_000);
  if (found.status !== 'FOUND') throw new Error(`fixture directory ${found.status}`);
  const target = await resolver.openAndVerify(found.candidate, targetRequest);
  if (target.status !== 'VERIFIED') throw new Error(`fixture target ${target.status}`);
  const observation = DouyinDeliveryPage.forControlledLocalPage(page);
  t.after(async () => {
    await observation.dispose();
    await directory.dispose();
    await context.close();
  });
  let boundaries = 0;
  const boundary = {
    record: async () => {
      boundaries++;
      await page.evaluate(() => {
        (window as Window & { fixtureEvents: string[] }).fixtureEvents.push('boundary');
      });
    },
  };
  const verify = (record = boundary, port = observation) =>
    new DeliveryVerifier(port, { check: () => resolver.revalidate(target.witness) }).verify(
      target.witness,
      options.message ?? known,
      record,
      limits,
    );
  return {
    context,
    page,
    observation,
    directory,
    resolver,
    witness: target.witness,
    boundary,
    verify,
    boundaries: () => boundaries,
  };
}
async function clicks(page: Page) {
  return page.evaluate(() => (window as Window & { fixtureActions: number }).fixtureActions);
}
test('pre-action observer captures synchronous outgoing bubble, with boundary before one click', async (t) => {
  const f = await fixture(t),
    result = await f.verify();
  assert.equal(result.status, 'SUCCESS');
  assert.equal(f.boundaries(), 1);
  assert.equal(await clicks(f.page), 1);
  assert.deepEqual(
    await f.page.evaluate(() => (window as Window & { fixtureEvents: string[] }).fixtureEvents),
    ['boundary', 'click'],
  );
  assert.equal(JSON.stringify(result).includes(known), false);
});
test('V3 count false-negative: history unmount reduces count while a genuine new bubble succeeds', async (t) => {
  const f = await fixture(
    t,
    `document.querySelector('[data-sk-delivery-list]').replaceChildren(); appendFixture(3, 'new', 'OUTGOING', message)`,
  );
  assert.equal((await f.verify()).status, 'SUCCESS');
  assert.equal(await f.page.locator('[data-sk-delivery-bubble]').count(), 1);
  assert.equal(await clicks(f.page), 1);
});
test('GROUP delivery remains bound to conversationId, not a visible member identity', async (t) => {
  const good = await fixture(t, undefined, { group: true });
  assert.equal((await good.verify()).status, 'SUCCESS');
  const wrong = await fixture(
    t,
    `document.querySelector('[data-sk-resolver-current]').setAttribute('data-conversation-id', 'different-group'); appendFixture(3, 'new', 'OUTGOING', message)`,
    { group: true },
  );
  assert.equal((await wrong.verify()).status, 'DELIVERY_UNKNOWN');
  assert.equal(await clicks(wrong.page), 1);
});
test('baseline remount and unseen old ID never become new delivery evidence', async (t) => {
  for (const action of [
    `const list = document.querySelector('[data-sk-delivery-list]'); const old = list.firstElementChild; old.replaceWith(old.cloneNode(true))`,
    `appendFixture(0, 'unseen-history', 'OUTGOING', message); const list = document.querySelector('[data-sk-delivery-list]'); list.prepend(list.lastElementChild)`,
  ]) {
    const f = await fixture(t, action);
    assert.equal((await f.verify()).status, 'DELIVERY_UNKNOWN');
    assert.equal(await clicks(f.page), 1);
  }
});
test('inbound/nonmatch/sticker/unknown direction and clearing/toast alone cannot succeed', async (t) => {
  for (const action of [
    `appendFixture(3, 'new', 'INCOMING', message)`,
    `appendFixture(3, 'new', 'OUTGOING', 'different')`,
    `appendFixture(3, 'new', 'OUTGOING', message, 'STICKER')`,
    `appendFixture(3, 'new', 'UNKNOWN', message)`,
    'void 0',
    `appendFixture(3, 'new', 'OUTGOING', message); document.querySelector('[data-message-id="new"]').hidden = true`,
  ]) {
    const f = await fixture(t, action);
    assert.equal((await f.verify()).status, 'DELIVERY_UNKNOWN');
    assert.equal(await clicks(f.page), 1);
  }
});
test('exact comparison permits CRLF only, not trimmed spaces or rich text', async (t) => {
  const exact = await fixture(t, undefined, { message: ' A\r\nB ' });
  assert.equal((await exact.verify()).status, 'SUCCESS');
  for (const action of [
    `appendFixture(3, 'new', 'OUTGOING', message.trim())`,
    `appendFixture(3, 'new', 'OUTGOING', message); document.querySelector('[data-message-id="new"] span').innerHTML = '<b>'+message+'</b>'`,
  ]) {
    const f = await fixture(t, action, { message: ' A B ' });
    assert.equal((await f.verify()).status, 'DELIVERY_UNKNOWN');
  }
});
test('no-ID path needs reliable sequence/tail and unseen fingerprint/append evidence', async (t) => {
  const anchored = await fixture(t, undefined, { noIds: true });
  assert.equal((await anchored.verify()).status, 'SUCCESS');
  const unanchored = await fixture(t, undefined, { noIds: true, noSequence: true });
  assert.equal((await unanchored.verify()).status, 'FAILED');
  assert.equal(unanchored.boundaries(), 0);
  assert.equal(await clicks(unanchored.page), 0);
});
test('two post-action matching bubbles or conflicting reused IDs fail closed', async (t) => {
  for (const action of [
    `appendFixture(3, 'new-1', 'OUTGOING', message); appendFixture(4, 'new-2', 'OUTGOING', message)`,
    `document.querySelector('[data-message-id="old-1"]').remove(); appendFixture(3, 'old-1', 'OUTGOING', message)`,
  ]) {
    const f = await fixture(t, action);
    assert.equal((await f.verify()).status, 'DELIVERY_UNKNOWN');
    assert.equal(await clicks(f.page), 1);
  }
});
test('append during pending boundary is pre-action history, not evidence', async (t) => {
  const f = await fixture(t, 'void 0');
  const result = await f.verify({
    record: async () => {
      await f.boundary.record();
      await f.page.evaluate(() => {
        const w = window as Window & {
          appendFixture: (sequence: number, id: string, direction: string, text: string) => void;
        };
        w.appendFixture(3, 'before-click', 'OUTGOING', 'Synthetic delivery text');
      });
    },
  });
  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  assert.equal(await clicks(f.page), 1);
});
test('identity/auth drift and A→B→A after click are UNKNOWN even with matching bubble', async (t) => {
  for (const mutation of [
    `const h = document.querySelector('[data-sk-resolver-current]'); h.setAttribute('data-sec-uid','changed')`,
    `const h = document.querySelector('[data-sk-resolver-current]'); h.setAttribute('data-sec-uid','changed'); h.setAttribute('data-sec-uid','Fixture-001')`,
    `document.querySelector('[data-sk-resolver-auth]').setAttribute('data-sk-resolver-auth','AUTH_EXPIRED')`,
  ]) {
    const f = await fixture(t, `${mutation}; appendFixture(3, 'new', 'OUTGOING', message)`);
    assert.equal((await f.verify()).status, 'DELIVERY_UNKNOWN');
    assert.equal(await clicks(f.page), 1);
  }
});
test('pre-click input/control/identity uncertainty has no boundary or click', async (t) => {
  for (const mode of ['input', 'control', 'tail', 'identity', 'control-target', 'submit']) {
    const f = await fixture(t);
    await f.page.evaluate((mode) => {
      if (mode === 'input')
        (document.querySelector('[data-sk-delivery-composer]') as HTMLTextAreaElement).value =
          'different';
      if (mode === 'control') document.querySelector('[data-sk-delivery-control]')!.remove();
      if (mode === 'tail')
        document
          .querySelector('[data-sk-delivery-list]')!
          .setAttribute('data-sk-delivery-at-tail', 'false');
      if (mode === 'identity')
        document
          .querySelector('[data-sk-resolver-current]')!
          .setAttribute('data-sec-uid', 'changed');
      if (mode === 'control-target')
        document
          .querySelector('[data-sk-delivery-control]')!
          .setAttribute('data-conversation-id', 'wrong-target');
      if (mode === 'submit')
        document.querySelector('[data-sk-delivery-control]')!.setAttribute('type', 'submit');
    }, mode);
    assert.equal((await f.verify()).status, 'FAILED');
    assert.equal(f.boundaries(), 0);
    assert.equal(await clicks(f.page), 0);
  }
});
test('message list loss and navigation after action are UNKNOWN', async (t) => {
  for (const action of [
    `document.querySelector('[data-sk-delivery-list]').remove()`,
    `history.pushState(null,'','/away')`,
  ]) {
    const f = await fixture(t, action);
    assert.equal((await f.verify()).status, 'DELIVERY_UNKNOWN');
    assert.equal(await clicks(f.page), 1);
  }
});
test('Page/Context close after action remain UNKNOWN and never invoke twice', async (t) => {
  for (const mode of ['page', 'context']) {
    const f = await fixture(t, 'setTimeout(() => window.closeFixture(),0)');
    let invoked = 0;
    await f.page.exposeFunction('closeFixture', async () => {
      invoked++;
      if (mode === 'page') await f.page.close();
      else await f.context.close();
    });
    assert.equal((await f.verify()).status, 'DELIVERY_UNKNOWN');
    assert.equal(invoked, 1);
  }
});
test('live adapter cannot use controlled fixture contract or invoke persistence/action', async (t) => {
  const f = await fixture(t),
    live = DouyinDeliveryPage.forOwnedPage(f.page);
  t.after(() => live.dispose());
  assert.equal((await f.verify(f.boundary, live)).status, 'FAILED');
  assert.equal(f.boundaries(), 0);
  assert.equal(await clicks(f.page), 0);
});
test('timed-out boundary cannot produce a late queued click', async (t) => {
  const f = await fixture(t);
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = await new DeliveryVerifier(f.observation, {
    check: () => f.resolver.revalidate(f.witness),
  }).verify(f.witness, known, { record: () => wait }, { ...limits, verificationTimeoutMs: 30 });
  assert.equal(result.status, 'DELIVERY_UNKNOWN');
  release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await clicks(f.page), 0);
});
test('delayed arm acknowledgement still owns and disconnects its real observers before return', async (t) => {
  const f = await fixture(t);
  await f.page.evaluate(() => {
    const Original = MutationObserver;
    const w = window as Window & { deliveryObservers: number };
    w.deliveryObservers = 0;
    window.MutationObserver = class extends Original {
      private active = false;
      override observe(target: Node, options: MutationObserverInit) {
        if (!this.active) {
          this.active = true;
          w.deliveryObservers++;
        }
        super.observe(target, options);
      }
      override disconnect() {
        if (this.active) {
          this.active = false;
          w.deliveryObservers--;
        }
        super.disconnect();
      }
    };
  });
  const original = f.page.evaluateHandle.bind(f.page);
  let installed!: () => void, release!: () => void;
  const armed = new Promise<void>((resolve) => {
    installed = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.page.evaluateHandle = (async (...args: Parameters<Page['evaluateHandle']>) => {
    const handle = await original(...args);
    installed();
    await barrier;
    return handle;
  }) as Page['evaluateHandle'];
  const pending = new DeliveryVerifier(f.observation, {
    check: () => f.resolver.revalidate(f.witness),
  }).verify(f.witness, known, f.boundary, { ...limits, deadline: Date.now() + 80 });
  await armed;
  assert.equal(
    await f.page.evaluate(
      () => (window as Window & { deliveryObservers: number }).deliveryObservers,
    ),
    2,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  const result = await pending;
  assert.equal(result.status, 'FAILED');
  assert.equal(f.boundaries(), 0);
  assert.equal(await clicks(f.page), 0);
  assert.equal(
    await f.page.evaluate(
      () => (window as Window & { deliveryObservers: number }).deliveryObservers,
    ),
    0,
  );
});
test('bounded message-row evidence cannot be replaced by an oversized append stream', async (t) => {
  const f = await fixture(
    t,
    `for (let i=3;i<505;i++) appendFixture(i, 'new-'+i, 'INCOMING', 'Unrelated fixture')`,
  );
  assert.equal((await f.verify()).status, 'DELIVERY_UNKNOWN');
  assert.equal(await clicks(f.page), 1);
});
