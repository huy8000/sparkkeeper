import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
/* global document, innerWidth */

// This is a synthetic lab only: named disposable volumes, private CA, no
// real account/profile, no onboarding/discovery/send operation or live gate.
const root = fileURLToPath(new URL('..', import.meta.url));
const project = `sparkkeeper-gate-a-${randomBytes(5).toString('hex')}`;
const fixture = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-gate-a-'));
const origin = 'https://sparkkeeper.test:18443';
const env = {
  ...process.env,
  SCHEDULER_ENABLED: 'false',
  SCHEDULER_ALLOW_REAL_SEND: 'false',
  MANUAL_RUN_ENABLED: 'false',
  SPARKKEEPER_HSTS_MAX_AGE: '0',
};
const composeArgs = [
  'compose',
  '-p',
  project,
  '-f',
  'docker-compose.yml',
  '-f',
  'docker/compose.gate-a.yml',
];
async function command(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '',
      error = '';
    child.stdout.on('data', (b) => {
      output += b;
    });
    child.stderr.on('data', (b) => {
      error += b;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`Docker fixture command failed (${code}): ${error.slice(-1500)}`)),
    );
    child.stdin.end(input);
  });
}
const compose = (args, input) => command([...composeArgs, ...args], input);
let browser,
  context,
  started = false;
let ca;
let forbiddenRequests = 0,
  businessMutations = 0,
  externalRequests = 0;
function request(
  urlPath,
  {
    method = 'GET',
    headers = {},
    body,
    insecure = false,
    sse = false,
    websocket = false,
    minVersion,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: 18443,
        servername: 'sparkkeeper.test',
        ca,
        rejectUnauthorized: !insecure,
        minVersion,
        path: urlPath,
        method,
        headers: {
          host: 'sparkkeeper.test:18443',
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
                origin,
                'sec-fetch-site': 'same-origin',
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let text = '';
        res.on('data', (b) => {
          text += b;
          if (sse && text.includes('\n\n')) {
            resolve({ status: res.statusCode, headers: res.headers, text });
            res.destroy();
            req.destroy();
          }
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      },
    );
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      reject(new Error('Unexpected websocket upgrade'));
    });
    req.on('error', reject);
    req.setTimeout(websocket ? 5000 : 15000, () => req.destroy(new Error('Fixture HTTP timeout')));
    req.end(payload);
  });
}
try {
  await command(['info', '--format', '{{.ServerVersion}}']);
  const config = JSON.parse(
    await compose(['--profile', 'maintenance', 'config', '--format', 'json']),
  );
  assert.deepEqual(config.services.edge.ports.map((p) => [p.host_ip, p.published]).sort(), [
    ['127.0.0.1', '18080'],
    ['127.0.0.1', '18443'],
  ]);
  for (const service of ['app', 'admin', 'maintenance'])
    assert.equal(config.services[service].ports, undefined);
  assert.equal(config.services.app.volumes.length, 1);
  assert.equal(config.services.app.volumes[0].type, 'volume');
  for (const gate of ['SCHEDULER_ENABLED', 'SCHEDULER_ALLOW_REAL_SEND', 'MANUAL_RUN_ENABLED'])
    assert.equal(config.services.app.environment[gate], 'false');
  if (!process.argv.includes('--skip-build')) {
    process.stdout.write('Gate A: building production fixtures\n');
    await compose(['build', 'app', 'admin', 'edge']);
  }
  await compose([
    'run',
    '--rm',
    '--no-deps',
    '--user',
    'root',
    '--entrypoint',
    'sh',
    'app',
    '-c',
    'install -d -o "$(id -u pwuser)" -g "$(id -g pwuser)" -m 0700 /app/data',
  ]);
  started = true;
  await compose(['up', '-d', '--wait', '--wait-timeout', '120', 'app', 'admin', 'edge']);
  for (let i = 0; i < 30; i++) {
    try {
      const health = await request('/api/health', { insecure: true });
      if (health.status === 200) break;
    } catch {
      /* bounded lab TLS readiness */
    }
    if (i === 29) throw new Error('Local TLS fixture not ready');
    await setTimeout(1000);
  }
  await compose([
    'cp',
    'edge:/data/caddy/pki/authorities/local/root.crt',
    path.join(fixture, 'ca.crt'),
  ]);
  ca = readFileSync(path.join(fixture, 'ca.crt'));
  const tls = await request('/', { minVersion: 'TLSv1.2' });
  assert.equal(tls.status, 200);
  assert.equal(tls.headers['x-frame-options'], 'DENY');
  assert.equal(tls.headers['x-content-type-options'], 'nosniff');
  assert.equal(tls.headers['referrer-policy'], 'no-referrer');
  assert.equal(tls.headers['strict-transport-security'], 'max-age=0');
  assert.match(tls.headers['content-security-policy'], /script-src 'self';/u);
  assert.doesNotMatch(
    tls.headers['content-security-policy'],
    /unsafe-eval|script-src[^;]*unsafe-inline/u,
  );
  const redirect = await new Promise((resolve, reject) => {
    http
      .get(
        { hostname: '127.0.0.1', port: 18080, path: '/', headers: { host: 'sparkkeeper.test' } },
        (res) => {
          res.resume();
          resolve(res);
        },
      )
      .on('error', reject);
  });
  assert.equal(redirect.statusCode, 308);
  assert.match(redirect.headers.location, /^https:\/\/sparkkeeper\.test/u);
  for (const p of [
    '/api/auth/me',
    '/api/accounts',
    '/api/events/stream',
    '/api/account-login-sessions/00000000-0000-4000-8000-000000000001/console',
  ])
    assert.equal((await request(p)).status, 401);
  const ws = await request(
    '/api/account-login-sessions/00000000-0000-4000-8000-000000000001/console/ws',
    {
      websocket: true,
      headers: {
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': randomBytes(16).toString('base64'),
        origin,
      },
    },
  );
  assert.equal(ws.status, 401);
  const password = randomBytes(32).toString('base64url'),
    username = 'Gate_A_Fixture';
  const seed = `import { createDatabase, AdminAuthRepository, AccountRepository } from '@sparkkeeper/database';
    import { PasswordHasher } from './dist/security/PasswordHasher.js';
    let raw=''; for await (const b of process.stdin) raw+=b; const input=JSON.parse(raw);
    const db=createDatabase({databasePath:'/app/data/sparkkeeper.db'});
    const hash=await new PasswordHasher().hash(input.password);
    new AdminAuthRepository(db).bootstrapInitialAdminWithAudit({username:input.username,passwordHash:hash});
    const account=new AccountRepository(db).create({name:'Gate A Synthetic',enabled:false,loginStatus:'UNKNOWN'});
    process.stdout.write(JSON.stringify({accountId:account.id})); db.close();`;
  const { accountId } = JSON.parse(
    await compose(
      ['exec', '-T', 'app', 'node', '--input-type=module', '-e', seed],
      JSON.stringify({ username, password }),
    ),
  );
  const { chromium } = createRequire(new URL('../apps/server/package.json', import.meta.url))(
    'playwright',
  );
  browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP sparkkeeper.test 127.0.0.1', '--no-proxy-server'],
  });
  context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 960 },
  });
  // Browser trust bypass is private-CA fixture only; Node HTTPS above validates the CA.
  await context.route('**/*', async (route) => {
    const req = route.request(),
      u = new URL(req.url());
    if (u.hostname !== 'sparkkeeper.test') {
      externalRequests++;
      return route.abort();
    }
    if (
      req.method() !== 'GET' &&
      !/^\/api\/auth\/(login|logout|reauth|change-password|sessions\/[^/]+\/revoke)$/u.test(
        u.pathname,
      )
    ) {
      businessMutations++;
      forbiddenRequests++;
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage(),
    pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`${origin}/login`);
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  await page.locator('#admin-username').fill(username);
  await page.locator('#admin-password').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(`${origin}/`);
  await page.getByRole('heading', { name: 'V4 工作空间', exact: true }).waitFor();
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === '__Host-sparkkeeper_session');
  assert.ok(
    cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === '/',
  );
  assert.ok(!(await page.evaluate(() => document.cookie)));
  const cookieHeader = `${cookie.name}=${cookie.value}`;
  const auth = await request('/api/auth/me', {
    headers: {
      cookie: cookieHeader,
      'x-forwarded-proto': 'http',
      'x-forwarded-for': '203.0.113.9',
      'x-forwarded-host': 'forged.invalid',
      forwarded: 'for=203.0.113.99;proto=http;host=forged.invalid',
    },
  });
  assert.equal(auth.status, 200);
  assert.ok(JSON.parse(auth.text).data.csrfToken);
  assert.equal(
    (
      await request('/api/auth/reauth', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { password },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/auth/login', {
        method: 'POST',
        headers: { origin: 'https://forged.invalid' },
        body: { username, password },
      })
    ).status,
    403,
  );
  const runtime = JSON.parse(
    (await request('/api/runtime/status', { headers: { cookie: cookieHeader } })).text,
  ).data;
  for (const gate of ['schedulerEnabled', 'manualRunEnabled', 'realSendAuthorizationEnabled'])
    assert.equal(runtime[gate], false);
  const sse = await request('/api/events/stream', {
    sse: true,
    headers: { cookie: cookieHeader, origin, accept: 'text/event-stream' },
  });
  assert.equal(sse.status, 200);
  assert.match(sse.text, /event: ready/u);
  const routes = [
    '/',
    '/accounts',
    '/templates',
    '/tasks',
    '/history',
    '/operations/notifications',
    '/operations/system',
    '/operations/migration',
    '/operations/audit',
    '/operations/security',
    ...['overview', 'contacts', 'test-send', 'tasks', 'history'].map(
      (t) => `/accounts/${accountId}/${t}`,
    ),
  ];
  for (const locale of ['zh-CN', 'en-US']) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 960 });
      for (const route of routes) {
        await page.goto(origin + route);
        await page.locator('.content').waitFor();
        await page.locator('.language-switcher select').selectOption(locale);
        await page.waitForTimeout(80);
        assert.equal(await page.locator('html').getAttribute('lang'), locale);
        assert.ok(await page.locator('h1').innerText());
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        if (overflow) {
          const boxes = await page.evaluate(() =>
            [...document.querySelectorAll('body *')]
              .map((e) => ({
                tag: e.tagName,
                cls: e.className,
                right: e.getBoundingClientRect().right,
              }))
              .filter((e) => e.right > innerWidth + 1)
              .slice(0, 12),
          );
          process.stderr.write(`Overflow: ${JSON.stringify(boxes)}\n`);
          await page.screenshot({ path: '/tmp/sparkkeeper-v410-mobile.png', fullPage: true });
        }
        assert.equal(overflow, false, `Page overflow: ${route} (${width})`);
      }
    }
  }
  await page.goto(`${origin}/accounts/${accountId}/overview`);
  await page.locator('.language-switcher select').selectOption('en-US');
  const settings = page.locator('.account-workspace__header button');
  await settings.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate((el) => el.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await settings.evaluate((el) => el === document.activeElement), true);
  assert.equal(pageErrors.length, 0, 'Browser runtime errors');
  await page.getByRole('button', { name: 'Log Out', exact: true }).click();
  await page.waitForURL(/\/login/u);
  assert.equal((await request('/api/accounts', { headers: { cookie: cookieHeader } })).status, 401);
  assert.equal(
    (await request('/api/events/stream', { headers: { cookie: cookieHeader, origin } })).status,
    401,
  );
  // Different names prevent the username limit from masking a spoofable IP bucket.
  for (let i = 0; i < 6; i++) {
    const probe = await request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': `203.0.113.${i + 1}`,
        'x-real-ip': `198.51.100.${i + 1}`,
        'x-forwarded-proto': 'https',
      },
      body: { username: `Unknown_${i}`, password },
    });
    assert.equal(probe.status, i < 5 ? 401 : 429);
    if (i === 5) assert.ok(probe.headers['retry-after']);
  }
  const proof = JSON.parse(
    await compose([
      'exec',
      '-T',
      'app',
      'node',
      '--input-type=module',
      '-e',
      `import {createDatabase,dailyRuns,executionRuns,testSendIntents,sendRecords,targetSendRecords,accountLoginSessions,contactSyncRuns} from '@sparkkeeper/database'; import {readdirSync} from 'node:fs';
    const db=createDatabase({databasePath:'/app/data/sparkkeeper.db'}),counts={};
    for(const [name,table] of Object.entries({dailyRuns,executionRuns,testSendIntents,sendRecords,targetSendRecords,accountLoginSessions,contactSyncRuns})) counts[name]=db.orm.select().from(table).all().length;
    const profiles=readdirSync('/app/data/browser-profiles').filter(n=>!n.startsWith('.')).length+readdirSync('/app/data/browser-profiles/.onboarding').length;
    process.stdout.write(JSON.stringify({counts,profiles,migrations:db.inspect().appliedMigrationCount})); db.close();`,
    ]),
  );
  for (const count of Object.values(proof.counts)) assert.equal(count, 0);
  assert.equal(proof.migrations, 14);
  assert.equal(proof.profiles, 0);
  const processes = await compose(['exec', '-T', 'app', 'ps', '-eo', 'comm']);
  assert.equal(
    processes
      .split('\n')
      .some((p) => /^(chrome|chromium|Xvfb|openbox|x11vnc|websockify)$/iu.test(p.trim())),
    false,
  );
  for (const service of ['app', 'admin']) {
    const ids = (await compose(['ps', '-q', service])).trim();
    const inspected = JSON.parse(await command(['inspect', ids]))[0];
    assert.equal(Object.keys(inspected.HostConfig.PortBindings ?? {}).length, 0);
  }
  await compose([
    'exec',
    '-T',
    'app',
    'sh',
    '-c',
    'test -x /app/server/dist/native/chromium-launcher && test -x /app/server/dist/native/rename-noreplace && test -x /app/server/dist/native/contact-files',
  ]);
  const sentinel = randomBytes(24).toString('hex');
  await request(`/?privacy=${sentinel}`, { headers: { 'x-sparkkeeper-csrf': sentinel } });
  await compose(['stop', 'admin']);
  assert.equal(
    (
      await request(`/?privacy=${sentinel}`, {
        headers: { cookie: `fixture=${sentinel}`, 'x-sparkkeeper-csrf': sentinel },
      })
    ).status,
    502,
  );
  const logs = await compose(['logs', '--no-color', 'app', 'admin', 'edge']);
  for (const value of [sentinel, password, cookie.value, JSON.parse(auth.text).data.csrfToken])
    assert.equal(logs.includes(value), false, 'Credential/query leaked into proxy/app log');
  assert.equal(forbiddenRequests, 0);
  assert.equal(externalRequests, 0);
  assert.equal(businessMutations, 0);
  process.stdout.write(
    JSON.stringify({
      gate: 'A',
      result: 'PASS',
      locales: 2,
      widths: [1440, 390],
      routes: routes.length,
      externalRequests,
      businessMutations,
      counts: proof.counts,
      migrations: proof.migrations,
      profiles: proof.profiles,
      browserWorkerProcesses: 0,
      logRedaction: 'PASS (normal + upstream failure)',
      tls: 'private CA validated',
      gatesBF: 'NOT EXECUTED',
    }) + '\n',
  );
} catch (error) {
  // No bootstrap credentials enter container logs. Bound diagnostics and never
  // retain fixture data/CA/credentials in the repository.
  const state = await compose(['ps', '-a', '--format', 'json']).catch(() => 'unavailable');
  process.stderr.write(`Gate A fixture state: ${state}\n`);
  const logs = await compose(['logs', '--no-color', '--tail', '12', 'app']).catch(
    () => 'unavailable',
  );
  process.stderr.write(logs);
  throw error;
} finally {
  await context?.close();
  await browser?.close();
  // Only this exact random fixture project and its named volumes can be removed.
  if (started) await compose(['down', '--volumes', '--remove-orphans', '--timeout', '30']);
  else
    await compose(['down', '--volumes', '--remove-orphans', '--timeout', '30']).catch(
      () => undefined,
    );
  rmSync(fixture, { recursive: true, force: true });
}
