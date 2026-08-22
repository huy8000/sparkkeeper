import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  AuthDetector,
  BrowserSession,
  DOUYIN_CHAT_URL,
  resolveBrowserSessionConfig,
  type AuthDetectionResult,
} from '../src/index.js';

const NAVIGATION_TIMEOUT_MS = 30_000;

async function main(): Promise<void> {
  const session = new BrowserSession(resolveBrowserSessionConfig());
  let navigationFailure: string | undefined;

  try {
    const { page } = await session.start();

    try {
      await page.goto(DOUYIN_CHAT_URL, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (cause) {
      if (page.isClosed()) {
        throw cause;
      }

      navigationFailure = describeError(cause);
    }

    const result = await new AuthDetector().detect(page);
    const reportedResult = includeNavigationFailure(result, navigationFailure);

    console.info(`Auth status: ${reportedResult.status}`);
    console.info(`Reason: ${reportedResult.reason}`);

    if (reportedResult.status !== 'READY') {
      const screenshotName =
        reportedResult.status === 'AUTH_EXPIRED' ? 'auth-expired' : 'auth-unknown';
      const screenshotPath = await saveDiagnosticScreenshot(page, screenshotName);
      console.info(`Diagnostic screenshot saved: ${screenshotPath}`);
    }
  } finally {
    await session.close();
  }
}

function includeNavigationFailure(
  result: AuthDetectionResult,
  navigationFailure: string | undefined,
): AuthDetectionResult {
  if (navigationFailure === undefined || result.status !== 'UNKNOWN') {
    return result;
  }

  return {
    status: 'UNKNOWN',
    reason: `${result.reason} Navigation did not complete normally: ${navigationFailure}`,
  };
}

async function saveDiagnosticScreenshot(
  page: import('playwright').Page,
  screenshotName: string,
): Promise<string> {
  const dataDir = path.resolve(process.cwd(), readEnvironmentPath('DATA_DIR') ?? 'data');
  const screenshotDir = path.join(dataDir, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const screenshotPath = path.join(screenshotDir, `${screenshotName}-${timestamp}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

function readEnvironmentPath(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === '' ? undefined : value;
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown navigation failure';
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown auth smoke test failure';
  console.error(`Auth smoke test failed: ${message}`);
  process.exitCode = 1;
});
