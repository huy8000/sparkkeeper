import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { RUN_ID, runFixture, sendRecordFixture } from '../test/fixtures';
import { installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, installEventSource } from '../test/realtime';
import { formatTimestamp } from '../utils/format';

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  currentLocale,
  i18n,
  resolveInitialLocale,
  setLocale,
  useTranslation,
} from './index';
import { enUS } from './locales/en-US';
import { zhCN } from './locales/zh-CN';

type MessageMap = { [key: string]: string | MessageMap };

function collectKeys(node: MessageMap, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      keys.add(path);
    } else {
      for (const nested of collectKeys(value, path)) keys.add(nested);
    }
  }
  return keys;
}

describe('translation resource parity', () => {
  it('zh-CN and en-US expose exactly the same key tree', () => {
    const enKeys = collectKeys(enUS);
    const zhKeys = collectKeys(zhCN as unknown as MessageMap);

    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key));
    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key));
    expect(missingInZh).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it('never registers a third language', () => {
    expect([...i18n.global.availableLocales].sort()).toEqual(['en-US', 'zh-CN']);
  });

  it('keeps plural forms grammatical in English and neutral in Chinese', () => {
    const { t } = useTranslation();
    setLocale('en-US');
    expect(t('deliveryList.retryWait', 1)).toBe('Waiting to retry after 1 attempt.');
    expect(t('deliveryList.retryWait', 2)).toBe('Waiting to retry after 2 attempts.');
    expect(t('runHero.successDeliveries', 1)).toBe('1 successful delivery');
    expect(t('runHero.successDeliveries', 2)).toBe('2 successful deliveries');

    setLocale('zh-CN');
    expect(t('deliveryList.retryWait', 1)).toBe('已尝试 1 次，等待重试。');
    expect(t('deliveryList.retryWait', 2)).toBe('已尝试 2 次，等待重试。');
    expect(t('runHero.successDeliveries', 2)).toBe('2 条成功送达');
  });
});

describe('initial locale resolution', () => {
  it('defaults to zh-CN on first visit and never sniffs navigator.language', () => {
    const languageSpy = vi.spyOn(navigator, 'language', 'get');
    expect(resolveInitialLocale(null)).toBe('zh-CN');
    expect(resolveInitialLocale(undefined)).toBe('zh-CN');
    expect(DEFAULT_LOCALE).toBe('zh-CN');
    expect(languageSpy).not.toHaveBeenCalled();
    languageSpy.mockRestore();
  });

  it('falls back to zh-CN for empty or invalid stored values without throwing', () => {
    expect(resolveInitialLocale('')).toBe('zh-CN');
    expect(resolveInitialLocale('fr-FR')).toBe('zh-CN');
    expect(resolveInitialLocale('ZH-cn')).toBe('zh-CN');
    expect(resolveInitialLocale('zh')).toBe('zh-CN');
  });

  it('honours a valid stored choice', () => {
    expect(resolveInitialLocale('en-US')).toBe('en-US');
    expect(resolveInitialLocale('zh-CN')).toBe('zh-CN');
  });
});

describe('locale persistence and document lang', () => {
  it('persists the choice and syncs <html lang> on switch', () => {
    setLocale('zh-CN');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');

    setLocale('en-US');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('ignores unsupported values instead of crashing', () => {
    setLocale('zh-CN');
    setLocale('fr-FR' as never);
    expect(currentLocale()).toBe('zh-CN');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
  });

  it('survives a broken localStorage without breaking the switch', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => setLocale('zh-CN')).not.toThrow();
    expect(currentLocale()).toBe('zh-CN');
  });
});

describe('language switch regression guards', () => {
  it('switching reloads text without reload, extra requests, or a new SSE connection', async () => {
    installEventSource();
    const fetchMock = installApiFetch();
    setLocale('zh-CN');
    const wrapper = await mountAdmin('/runs');
    await wrapper.findAll('.filter-bar select')[1]!.setValue('FAILED');

    expect(wrapper.text()).toContain('概览');
    expect(wrapper.text()).toContain('执行');
    expect(wrapper.find('.language-switcher__select').attributes('aria-label')).toBe('切换语言');
    const sseCount = FakeEventSource.instances.length;
    const requestCount = fetchMock.mock.calls.length;

    await wrapper.find('.language-switcher__select').setValue('en-US');
    await flushPromises();

    expect(FakeEventSource.instances.length).toBe(sseCount);
    expect(fetchMock.mock.calls.length).toBe(requestCount);
    // Route-owned filter state survives the switch untouched.
    expect((wrapper.findAll('.filter-bar select')[1]!.element as HTMLSelectElement).value).toBe(
      'FAILED',
    );
    expect(wrapper.text()).toContain('Overview');
    expect(wrapper.text()).toContain('Runs');
    expect(wrapper.find('.language-switcher__select').attributes('aria-label')).toBe(
      'Change language',
    );
    expect(document.documentElement.lang).toBe('en-US');
    wrapper.unmount();
  });
});

describe('delivery-uncertain safety copy', () => {
  it('keeps the full warning triad in both languages with raw status untranslated', async () => {
    const RUN_API = `/api/runs/${RUN_ID}`;
    installApiFetch((url) => {
      if (url.pathname === RUN_API) return success({ ...runFixture, status: 'FAILED' });
      if (url.pathname === `${RUN_API}/send-records`)
        return success([{ ...sendRecordFixture, status: 'DELIVERY_UNKNOWN', failureCode: null }]);
      return undefined;
    });

    setLocale('zh-CN');
    const zhWrapper = await mountAdmin(`/runs/${RUN_ID}`);
    const zhText = zhWrapper.text();
    expect(zhText).toContain('发送结果不确定');
    expect(zhText).toContain('发生了发送操作，但 SparkKeeper 无法验证新发出的消息。');
    expect(zhText).toContain('消息可能已经送达。');
    expect(zhText).toContain('请勿自动重试。');
    // Technical enum stays raw in every language; only the label translates.
    expect(zhText).toContain('发送状态：DELIVERY_UNKNOWN');
    zhWrapper.unmount();

    setLocale('en-US');
    const enWrapper = await mountAdmin(`/runs/${RUN_ID}`);
    const enText = enWrapper.text();
    expect(enText).toContain('Delivery uncertain');
    expect(enText).toContain(
      'A send action occurred, but SparkKeeper could not verify a new outgoing message.',
    );
    expect(enText).toContain('The message may already have been delivered.');
    expect(enText).toContain('Do not retry automatically.');
    enWrapper.unmount();
  });
});

describe('date and relative time localization', () => {
  it('renders locale-aware dates on a 24-hour clock in both languages', () => {
    const iso = new Date(2026, 7, 29, 14, 30, 5).toISOString();

    setLocale('zh-CN');
    const zh = formatTimestamp(iso);
    expect(zh).toContain('2026年8月29日');
    expect(zh).toContain('14:30:05');
    expect(zh).not.toMatch(/AM|PM/);

    setLocale('en-US');
    const en = formatTimestamp(iso);
    expect(en).toContain('Aug 29, 2026');
    expect(en).toContain('14:30:05');
    expect(en).not.toMatch(/AM|PM/);
  });

  it('localizes relative time through Intl.RelativeTimeFormat', () => {
    expect(new Intl.RelativeTimeFormat('zh-CN').format(-5, 'minute')).toBe('5分钟前');
    expect(new Intl.RelativeTimeFormat('en-US').format(-5, 'minute')).toBe('5 minutes ago');
  });
});
