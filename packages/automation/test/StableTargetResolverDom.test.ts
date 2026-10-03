import assert from 'node:assert/strict';
import { after, before, test, type TestContext } from 'node:test';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { DouyinTargetResolverPage } from '../src/douyin/resolver/DouyinTargetResolverPage.js';
import { StableTargetResolver } from '../src/douyin/resolver/StableTargetResolver.js';
import { FixtureDirectory, request } from './resolverFixture.js';
import { ResolverBudget } from '../src/douyin/resolver/types.js';

let browser: Browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
});
function html(
  options: {
    group?: boolean;
    header?: 'missing' | 'wrong';
    duplicate?: boolean;
    unknown?: boolean;
    submit?: boolean;
    empty?: boolean;
  } = {},
): string {
  const type = options.group ? 'GROUP' : options.unknown ? 'UNKNOWN' : 'PERSON';
  const target = options.group ? 'fixture-group-chat' : 'fixture-target-chat';
  const attributes = `data-contact-type="${type}" data-conversation-id="${target}" data-sec-uid="Fixture-001"`;
  const targetRow = `<button type="${options.submit ? 'submit' : 'button'}" data-sk-resolver-conversation data-index="99" ${attributes} onclick="openFixture(this)">Same name${options.group || options.unknown ? '<a href="https://www.douyin.com/user/Fixture-001">Synthetic member</a>' : ''}</button>`;
  return `<!doctype html><html><body>
    <div data-sk-resolver-auth="READY">Authenticated fixture</div>
    <div data-sk-resolver-self data-sec-uid="synthetic-self">Synthetic owner</div>
    <div data-sk-resolver-directory="static-v1" data-sk-resolver-complete="true" style="min-height:40px">
      ${options.empty ? '' : `<button type="button" data-sk-resolver-conversation data-index="0" data-contact-type="${options.group ? 'GROUP' : 'PERSON'}" data-conversation-id="fixture-other-chat" data-sec-uid="Fixture-other" onclick="openFixture(this)">Same name</button>${targetRow}${options.duplicate ? targetRow : ''}`}
    </div>
    <header data-sk-resolver-current data-contact-type="PERSON" data-conversation-id="fixture-old-chat" data-sec-uid="Fixture-old">Same name</header>
    <textarea id="fixture-draft" onkeydown="if(event.key === 'Enter') window.fixtureSends++">Pre-existing synthetic draft</textarea>
    <button id="fixture-send" onclick="window.fixtureSends++">Send fixture</button>
    <script>
      window.fixtureOpens = 0; window.fixtureSends = 0; window.fixtureOpened = null;
      function openFixture(control) {
        window.fixtureOpens++;
        window.fixtureOpened = control.getAttribute('data-conversation-id');
        const header = document.querySelector('[data-sk-resolver-current]');
        for (const attr of ['data-contact-type','data-conversation-id','data-sec-uid']) {
          ${options.header === 'missing' ? 'header.removeAttribute(attr);' : `header.setAttribute(attr, ${options.header === 'wrong' ? "attr === 'data-sec-uid' ? 'Changed-fixture' : " : ''}control.getAttribute(attr));`}
        }
      }
    </script></body></html>`;
}
async function fixture(t: TestContext, source = html()) {
  const context: BrowserContext = await browser.newContext({ serviceWorkers: 'block' });
  // Every request is fulfilled locally; no DNS/site request or Account profile is used.
  await context.route('**/*', (route) => route.fulfill({ contentType: 'text/html', body: source }));
  const page: Page = await context.newPage();
  await page.goto('http://127.0.0.1/chat');
  const adapter = DouyinTargetResolverPage.forControlledLocalPage(page);
  const owner = new FixtureDirectory();
  const resolver = new StableTargetResolver(adapter, owner.owner, owner.binding);
  t.after(async () => {
    await adapter.dispose();
    await context.close();
  });
  return { page, adapter, resolver, owner };
}
async function noSend(page: Page, expectedOpens: number) {
  const counters = await page.evaluate(() => {
    const w = window as Window & {
      fixtureOpens: number;
      fixtureSends: number;
      fixtureOpened: string | null;
    };
    return { opens: w.fixtureOpens, sends: w.fixtureSends, opened: w.fixtureOpened };
  });
  assert.equal(counters.opens, expectedOpens);
  assert.equal(counters.sends, 0);
  assert.equal(await page.locator('#fixture-draft').inputValue(), 'Pre-existing synthetic draft');
  return counters;
}
test('real DOM opens stable identity despite same names/positions; draft stays unchanged', async (t) => {
  const { page, resolver, adapter, owner } = await fixture(t);
  await adapter.auth(owner.binding, new ResolverBudget(Date.now() + 5000));
  const found = await resolver.resolve(request(), Date.now() + 5000);
  assert.equal(found.status, 'FOUND');
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  const result = await resolver.openAndVerify(found.candidate, request());
  assert.equal(result.status, 'VERIFIED');
  assert.equal((await noSend(page, 1)).opened, 'fixture-target-chat');
  if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
  assert.equal(await resolver.revalidate(result.witness), null);
  await page
    .locator('[data-conversation-id="fixture-target-chat"][data-sk-resolver-conversation]')
    .evaluate((e) => e.setAttribute('data-index', '0'));
  assert.equal(await resolver.revalidate(result.witness), null); // Position is not identity.
});
test('real GROUP header proof uses conversationId, ignoring member SEC_UID', async (t) => {
  const { page, resolver } = await fixture(t, html({ group: true }));
  const target = request({
    contactType: 'GROUP',
    preferredIdentity: {
      ...request().preferredIdentity,
      kind: 'CONVERSATION_ID',
      normalizedValue: 'fixture-group-chat',
    },
  });
  const found = await resolver.resolve(target, Date.now() + 5000);
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  assert.equal((await resolver.openAndVerify(found.candidate, target)).status, 'VERIFIED');
  assert.equal((await noSend(page, 1)).opened, 'fixture-group-chat');
});
test('title-only/wrong identity header cannot verify or submit existing draft', async (t) => {
  for (const header of ['missing', 'wrong'] as const) {
    const { page, resolver } = await fixture(t, html({ header }));
    const found = await resolver.resolve(request(), Date.now() + 5000);
    if (found.status !== 'FOUND') throw new Error('fixture not found');
    assert.notEqual((await resolver.openAndVerify(found.candidate, request())).status, 'VERIFIED');
    await noSend(page, 1);
  }
});
test('DOM swap between scan/check and actual click is rejected without an open', async (t) => {
  const { page, resolver, adapter } = await fixture(t);
  const found = await resolver.resolve(request(), Date.now() + 5000);
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  const open = adapter.openCandidate.bind(adapter);
  adapter.openCandidate = async (...args) => {
    await page
      .locator('[data-sk-resolver-conversation][data-sec-uid="Fixture-001"]')
      .evaluate((e) => e.setAttribute('data-sec-uid', 'Swapped-fixture'));
    await open(...args);
  };
  assert.notEqual((await resolver.openAndVerify(found.candidate, request())).status, 'VERIFIED');
  await noSend(page, 0);
});
test('duplicate controls, UNKNOWN member link and submit button fail closed', async (t) => {
  for (const options of [{ duplicate: true }, { unknown: true }, { submit: true }]) {
    const { page, resolver } = await fixture(t, html(options));
    const found = await resolver.resolve(request(), Date.now() + 5000);
    if (found.status === 'FOUND')
      assert.notEqual(
        (await resolver.openAndVerify(found.candidate, request())).status,
        'VERIFIED',
      );
    else assert.notEqual(found.status, 'NOT_FOUND');
    await noSend(page, 0);
  }
});
test('real header A→B→A mutation invalidates witness; directory mutation also invalidates', async (t) => {
  for (const mutation of ['header', 'directory'] as const) {
    const { page, resolver } = await fixture(t);
    const found = await resolver.resolve(request(), Date.now() + 5000);
    if (found.status !== 'FOUND') throw new Error('fixture not found');
    const result = await resolver.openAndVerify(found.candidate, request());
    if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
    if (mutation === 'header')
      await page.locator('[data-sk-resolver-current]').evaluate((e) => {
        e.setAttribute('data-sec-uid', 'Other-fixture');
        e.setAttribute('data-sec-uid', 'Fixture-001');
      });
    else
      await page
        .locator('[data-sk-resolver-directory]')
        .evaluate((e) => e.appendChild(e.querySelector('button')!.cloneNode(true)));
    assert.notEqual(await resolver.revalidate(result.witness), null);
    await noSend(page, 1);
  }
});
test('auth expiry/unknown/self mismatch stop before click, complete empty alone is NOT_FOUND', async (t) => {
  for (const mode of ['AUTH_EXPIRED', 'UNKNOWN', 'self-mismatch', 'empty']) {
    const { page, resolver } = await fixture(t, html({ empty: mode === 'empty' }));
    if (mode === 'self-mismatch')
      await page
        .locator('[data-sk-resolver-self]')
        .evaluate((e) => e.setAttribute('data-sec-uid', 'Wrong-self'));
    else if (mode !== 'empty')
      await page
        .locator('[data-sk-resolver-auth]')
        .evaluate((e, mode) => e.setAttribute('data-sk-resolver-auth', mode), mode);
    const result = await resolver.resolve(request(), Date.now() + 5000);
    assert.equal(
      result.status,
      mode === 'empty' ? 'NOT_FOUND' : mode === 'AUTH_EXPIRED' ? 'AUTH_EXPIRED' : 'UNVERIFIABLE',
    );
    await noSend(page, 0);
  }
});
test('fixture contract cannot enable production verification; disposed page adapter stays invalid', async (t) => {
  const { page, owner, resolver, adapter } = await fixture(t);
  const production = DouyinTargetResolverPage.forOwnedPage(page);
  t.after(() => production.dispose());
  assert.notEqual(
    (
      await new StableTargetResolver(production, owner.owner, owner.binding).resolve(
        request(),
        Date.now() + 5000,
      )
    ).status,
    'FOUND',
  );
  const found = await resolver.resolve(request(), Date.now() + 5000);
  if (found.status !== 'FOUND') throw new Error('fixture not found');
  const result = await resolver.openAndVerify(found.candidate, request());
  if (result.status !== 'VERIFIED') throw new Error('fixture not verified');
  await adapter.dispose();
  assert.notEqual(await resolver.revalidate(result.witness), null);
  await noSend(page, 1);
});
test('static fixture needs explicit exhaustive shape/end evidence; ignored rows/loading are not empty', async (t) => {
  for (const evidence of ['unknown-row', 'loading', 'no-end'] as const) {
    const { page, resolver } = await fixture(t, html({ empty: true }));
    await page.locator('[data-sk-resolver-directory]').evaluate((e, evidence) => {
      if (evidence === 'unknown-row') e.appendChild(document.createElement('div'));
      else if (evidence === 'loading') e.setAttribute('data-loading', 'true');
      else e.removeAttribute('data-sk-resolver-complete');
    }, evidence);
    const result = await resolver.resolve(request(), Date.now() + 5000);
    assert.equal(result.status, 'UNVERIFIABLE');
    await noSend(page, 0);
  }
});
