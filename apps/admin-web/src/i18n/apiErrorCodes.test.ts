import { describe, expect, it } from 'vitest';

import { useApiErrorText } from '../composables/useApiErrorText';

import { KNOWN_API_ERROR_CODES, apiErrorTranslationKey } from './apiErrorCodes';
import { setLocale } from './index';
import { enUS } from './locales/en-US';
import { zhCN } from './locales/zh-CN';

type MessageMap = { [key: string]: string | MessageMap };

function lookup(node: MessageMap, path: string): string | undefined {
  let current: string | MessageMap | undefined = node;
  for (const segment of path.split('.')) {
    if (current === undefined || typeof current === 'string') return undefined;
    current = current[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

describe('API error code translation mapping', () => {
  it('covers every known server error code with non-empty zh-CN and en-US copy', () => {
    expect(KNOWN_API_ERROR_CODES).toHaveLength(21);
    for (const code of KNOWN_API_ERROR_CODES) {
      const key = apiErrorTranslationKey(code);
      expect(key, `missing translation key for ${code}`).not.toBeNull();
      expect(key).toMatch(/^errors\.api\./);
      expect(lookup(enUS, key!), `empty en-US copy for ${code}`).toBeTruthy();
      expect(
        lookup(zhCN as unknown as MessageMap, key!),
        `empty zh-CN copy for ${code}`,
      ).toBeTruthy();
    }
  });

  it('returns null for unknown, empty, or missing codes', () => {
    expect(apiErrorTranslationKey('FUTURE_NEW_ERROR')).toBeNull();
    expect(apiErrorTranslationKey('')).toBeNull();
    expect(apiErrorTranslationKey(null)).toBeNull();
    expect(apiErrorTranslationKey(undefined)).toBeNull();
  });
});

describe('apiErrorText humanization', () => {
  it('renders known codes from translations and suppresses the raw server message', () => {
    const { apiErrorText } = useApiErrorText();
    const source = { code: 'ACCOUNT_NOT_FOUND', message: 'THIS RAW MESSAGE SHOULD NOT APPEAR' };
    setLocale('zh-CN');
    expect(apiErrorText(source)).toBe('未找到该账号。');
    setLocale('en-US');
    expect(apiErrorText(source)).toBe('Account not found.');
  });

  it('falls back to the safe server message for unknown codes in both locales', () => {
    const { apiErrorText } = useApiErrorText();
    const source = { code: 'FUTURE_NEW_ERROR', message: 'Something new happened.' };
    setLocale('zh-CN');
    expect(apiErrorText(source)).toBe('Something new happened.');
    setLocale('en-US');
    expect(apiErrorText(source)).toBe('Something new happened.');
  });

  it('falls back to localized generic copy when an unknown code carries no message', () => {
    const { apiErrorText } = useApiErrorText();
    setLocale('zh-CN');
    expect(apiErrorText({ code: 'FUTURE_NEW_ERROR', message: '' })).toBe('发生未知错误。');
    expect(apiErrorText({ code: null, message: '   ' })).toBe('发生未知错误。');
    setLocale('en-US');
    expect(apiErrorText({ code: 'FUTURE_NEW_ERROR' })).toBe('An unexpected error occurred.');
  });

  it('passes through pre-localized strings and renders nothing for empty sources', () => {
    const { apiErrorText } = useApiErrorText();
    expect(apiErrorText('客户端校验文案')).toBe('客户端校验文案');
    expect(apiErrorText(null)).toBe('');
    expect(apiErrorText(undefined)).toBe('');
  });

  it('resolves at render time so a locale switch re-localizes the same error object', () => {
    const { apiErrorText } = useApiErrorText();
    const source = { code: 'INTERNAL_ERROR', message: 'boom' };
    setLocale('en-US');
    expect(apiErrorText(source)).toBe(
      'The service hit an internal error. Please reload and try again.',
    );
    setLocale('zh-CN');
    expect(apiErrorText(source)).toBe('服务发生内部错误，请稍后重新加载。');
  });
});
