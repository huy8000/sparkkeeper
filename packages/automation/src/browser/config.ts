import path from 'node:path';

export interface BrowserViewport {
  readonly width: number;
  readonly height: number;
}

export interface BrowserSessionConfig {
  readonly userDataDir: string;
  readonly headless: boolean;
  readonly timezoneId: string;
  readonly locale: string;
  readonly viewport: BrowserViewport;
}

export type BrowserSessionEnvironment = Readonly<Record<string, string | undefined>>;

export const DEFAULT_BROWSER_VIEWPORT: BrowserViewport = Object.freeze({
  width: 1440,
  height: 900,
});
export const DEFAULT_BROWSER_LOCALE = 'zh-CN';
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

function readOptionalValue(
  environment: BrowserSessionEnvironment,
  name: string,
): string | undefined {
  const value = environment[name]?.trim();
  return value === '' ? undefined : value;
}

function parseHeadless(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  if (value.toLowerCase() === 'true') {
    return true;
  }

  if (value.toLowerCase() === 'false') {
    return false;
  }

  throw new Error(`Invalid BROWSER_HEADLESS value "${value}". Expected "true" or "false".`);
}

export function resolveBrowserSessionConfig(
  environment: BrowserSessionEnvironment = process.env,
  cwd = process.cwd(),
): BrowserSessionConfig {
  const resolvedCwd = path.resolve(cwd);
  const dataDir = path.resolve(resolvedCwd, readOptionalValue(environment, 'DATA_DIR') ?? 'data');
  const configuredProfileDir = readOptionalValue(environment, 'BROWSER_PROFILE_DIR');

  return {
    userDataDir:
      configuredProfileDir === undefined
        ? path.join(dataDir, 'browser-profile')
        : path.resolve(resolvedCwd, configuredProfileDir),
    headless: parseHeadless(readOptionalValue(environment, 'BROWSER_HEADLESS')),
    timezoneId: readOptionalValue(environment, 'APP_TIMEZONE') ?? DEFAULT_TIMEZONE,
    locale: DEFAULT_BROWSER_LOCALE,
    viewport: DEFAULT_BROWSER_VIEWPORT,
  };
}
