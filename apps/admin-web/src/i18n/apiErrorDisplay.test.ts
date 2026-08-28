import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import TemplateEditor from '../components/template/TemplateEditor.vue';
import { failure, installApiFetch } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, installEventSource } from '../test/realtime';

import { setLocale } from './index';

const RAW_MESSAGE = 'THIS RAW ENGLISH MESSAGE SHOULD NOT APPEAR';

function findButtonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text));
  if (button === undefined) throw new Error(`Button containing "${text}" not found.`);
  return button;
}

describe('API error localization in rendered pages', () => {
  it('shows localized copy for known codes and never leaks the raw server message', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/accounts' ? failure('ACCOUNT_NOT_FOUND', RAW_MESSAGE, 404) : undefined,
    );

    setLocale('zh-CN');
    const zh = await mountAdmin('/accounts');
    expect(zh.get('[role="alert"]').text()).toContain('未找到该账号。');
    expect(zh.text()).not.toContain(RAW_MESSAGE);
    zh.unmount();

    setLocale('en-US');
    const en = await mountAdmin('/accounts');
    expect(en.get('[role="alert"]').text()).toContain('Account not found.');
    expect(en.text()).not.toContain(RAW_MESSAGE);
    en.unmount();
  });

  it('re-localizes an existing error on language switch without refetching or a new SSE', async () => {
    installEventSource();
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/accounts' ? failure('ACCOUNT_NOT_FOUND', RAW_MESSAGE, 404) : undefined,
    );
    setLocale('zh-CN');
    const wrapper = await mountAdmin('/accounts');
    expect(wrapper.text()).toContain('未找到该账号。');
    expect(wrapper.text()).not.toContain(RAW_MESSAGE);

    const sseCount = FakeEventSource.instances.length;
    const requestCount = fetchMock.mock.calls.length;

    await wrapper.find('.language-switcher__select').setValue('en-US');
    await flushPromises();

    expect(wrapper.text()).toContain('Account not found.');
    expect(wrapper.text()).not.toContain(RAW_MESSAGE);
    // Switching language never retries the failed request, opens a new SSE
    // connection, or navigates away from the route.
    expect(fetchMock.mock.calls.length).toBe(requestCount);
    expect(FakeEventSource.instances.length).toBe(sseCount);
    expect(window.location.pathname).toBe('/accounts');
    wrapper.unmount();
  });

  it('localizes mutation errors in zh-CN while retaining typed values', async () => {
    installApiFetch((url, init) =>
      url.pathname === '/api/templates' && init?.method === 'POST'
        ? failure('VALIDATION_ERROR', 'Template configuration is invalid.', 400)
        : undefined,
    );
    setLocale('zh-CN');
    const wrapper = await mountAdmin('/templates');
    await findButtonByText(wrapper, '新建模板').trigger('click');
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('本地化模板');
    await editor.get('textarea').setValue('消息内容');
    await editor.get('form').trigger('submit');
    await flushPromises();
    expect(editor.get('input[name="templateName"]').element).toHaveProperty('value', '本地化模板');
    expect(editor.get('[role="alert"]').text()).toContain('输入内容有误，请检查后重试。');
    expect(wrapper.text()).not.toContain('Template configuration is invalid.');
    wrapper.unmount();
  });
});
