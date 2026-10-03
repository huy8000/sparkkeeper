import {
  BrowserSession,
  DouyinContactDirectory,
  collectContactDirectory,
  DOUYIN_CHAT_URL,
} from '@sparkkeeper/automation';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ContactFiles } from './ContactFiles.js';
import {
  validateDiscoveryStart,
  type DiscoveryWorkerEvent,
} from './ContactDiscoveryWorkerProtocol.js';
import { prepareBrowserIdentityFile } from '../onboarding/BrowserProcessIdentity.js';

let browser: BrowserSession | undefined;
let input: ReturnType<typeof validateDiscoveryStart> | undefined;
let stopped = false;
const send = (e: DiscoveryWorkerEvent) => {
  if (!stopped && process.connected && Buffer.byteLength(JSON.stringify(e)) <= 16384)
    process.send?.(e);
};
async function stop() {
  if (stopped) return;
  stopped = true;
  await Promise.race([
    browser?.close().catch(() => undefined),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
  process.exit(0);
}
process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('message', (v) => {
  if ((v as { type?: unknown })?.type === 'STOP') void stop();
});
process.once('message', (v) => void run(v));
async function run(v: unknown) {
  let authChecked = false;
  let launchAttempted = false,
    launchCompleted = false;
  try {
    input = validateDiscoveryStart(v);
    if (process.platform !== 'linux') throw new Error('Unsupported discovery platform');
    const files = new ContactFiles(input.runtimeRoot);
    if (!files.put(`${input.runId}.launching`, Buffer.from(input.runId)))
      throw new Error('Existing launch ownership.');
    send({ type: 'BROWSER_LAUNCHING', runId: input.runId });
    launchAttempted = true;
    const identity = prepareBrowserIdentityFile(input.runId);
    browser = new BrowserSession(
      {
        userDataDir: input.profilePath,
        headless: true,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        viewport: { width: 1440, height: 900 },
      },
      {
        processTracking: {
          launcherExecutablePath: fileURLToPath(
            new URL('../native/chromium-launcher', import.meta.url),
          ),
          identityFilePath: identity,
          discoveryProof: {
            path: path.join(input.runtimeRoot, `${input.runId}.browser`),
            runId: input.runId,
          },
        },
      },
    );
    const { page } = await browser.start();
    launchCompleted = true;
    send({ type: 'BROWSER_STARTED', runId: input.runId });
    await page.goto(DOUYIN_CHAT_URL, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(1, Math.min(30000, input.deadline - Date.now())),
    });
    const source = new DouyinContactDirectory(page, input.expected, input.deadline);
    const auth = await source.auth();
    authChecked = true;
    const result =
      auth === 'READY'
        ? await collectContactDirectory(source, input.deadline)
        : {
            status: auth === 'AUTH_EXPIRED' ? ('AUTH_EXPIRED' as const) : ('FAILED' as const),
            failureCode:
              auth === 'AUTH_EXPIRED' ? ('AUTH_EXPIRED' as const) : ('AUTH_UNKNOWN' as const),
            observations: [],
            issueCount: 0,
            authChecked: true,
          };
    let sequence = 0;
    for (const observation of result.observations) {
      if (stopped) return;
      const current = sequence++;
      const ack = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => {
            process.off('message', listener);
            reject(new Error('Discovery acknowledgement timeout.'));
          },
          Math.min(2000, Math.max(1, input!.deadline - Date.now())),
        );
        const listener = (m: unknown) => {
          const a = m as { type?: unknown; sequence?: unknown; runId?: unknown };
          if (a?.type === 'ACK' && a.sequence === current && a.runId === input!.runId) {
            clearTimeout(timer);
            process.off('message', listener);
            resolve();
          }
        };
        process.on('message', listener);
      });
      send({ type: 'BATCH', runId: input.runId, sequence: current, observations: [observation] });
      await ack;
    }
    send({
      type: 'RESULT',
      runId: input.runId,
      status: result.status,
      failureCode: result.failureCode,
      issueCount: result.issueCount,
      authChecked: result.authChecked,
    });
  } catch {
    if (input && launchAttempted && !launchCompleted)
      send({ type: 'BROWSER_LAUNCH_ABORTED', runId: input.runId });
    if (input)
      send({
        type: 'RESULT',
        runId: input.runId,
        status: 'FAILED',
        failureCode: authChecked ? 'PARSER_CONTRACT_FAILURE' : 'BROWSER_FAILURE',
        issueCount: 0,
        authChecked,
      });
  }
  // Parent owns teardown/publication. Never remove identity or release the profile here.
}
