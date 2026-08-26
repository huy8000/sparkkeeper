import process from 'node:process';

import { chromium } from 'playwright';

const profileDirectory = process.env.BROWSER_PROFILE_DIR;
const timezoneId = process.env.APP_TIMEZONE?.trim() || 'Asia/Shanghai';
if (profileDirectory === undefined || profileDirectory.trim() === '') {
  throw new Error('Maintenance browser profile is not configured.');
}

const context = await chromium.launchPersistentContext(profileDirectory, {
  headless: false,
  locale: 'zh-CN',
  timezoneId,
  viewport: { width: 1440, height: 900 },
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('about:blank');

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await context.close().catch(() => undefined);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    void close();
  });
}

await new Promise((resolve) => context.once('close', resolve));
