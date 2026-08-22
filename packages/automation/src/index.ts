export {
  BrowserSession,
  BrowserSessionError,
  type BrowserSessionHandle,
} from './browser/BrowserSession.js';
export {
  DEFAULT_BROWSER_LOCALE,
  DEFAULT_BROWSER_VIEWPORT,
  DEFAULT_TIMEZONE,
  resolveBrowserSessionConfig,
  type BrowserSessionConfig,
  type BrowserSessionEnvironment,
  type BrowserViewport,
} from './browser/config.js';
export {
  AuthDetectionError,
  AuthDetector,
  DOUYIN_CHAT_URL,
  type AuthDetectionResult,
  type AuthDetectorOptions,
  type AuthStatus,
} from './douyin/index.js';
