/* global HTMLButtonElement, HTMLInputElement */
import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import TemplateEditor from '../components/template/TemplateEditor.vue';
import { TEMPLATE_ID, templateDetailFixture, templateSummaryFixture } from '../test/fixtures';
import { failure, installApiFetch, success } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import { FakeEventSource, configEvent, installEventSource } from '../test/realtime';

const TEMPLATE_B_ID = '00000000-0000-4000-8000-000000000007';

function summaryB() {
  return {
    ...templateSummaryFixture,
    id: TEMPLATE_B_ID,
    name: 'Random Template B',
    providerType: 'RANDOM' as const,
    messageCount: 2,
    enabled: false,
  };
}

function findButton(wrapper: Awaited<ReturnType<typeof mountAdmin>>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().trim() === text)!;
}

describe('V3 Templates', () => {
  it('renders summary cards and proves initial load has no detail N+1', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/templates' ? success([templateSummaryFixture, summaryB()]) : undefined,
    );
    const wrapper = await mountAdmin('/templates');
    expect(wrapper.text()).toContain('Demo Template');
    expect(wrapper.text()).toContain('Random Template B');
    expect(wrapper.text()).toContain('2 messages');
    expect(wrapper.text()).toContain('Disabled');
    expect(wrapper.text()).not.toContain(templateDetailFixture.messages[0]);
    expect(
      fetchMock.mock.calls.filter(([url]) => /\/api\/templates\/[^?]+$/u.test(String(url))),
    ).toHaveLength(0);
    wrapper.unmount();
  });

  it('has no template delete, preview, render, generate, or AI controls', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/templates');
    expect(
      wrapper
        .findAll('button')
        .some((button) =>
          /delete|archive|preview|generate|rewrite|improve|suggest/iu.test(button.text()),
        ),
    ).toBe(false);
    expect(wrapper.text()).not.toMatch(/server preview|AI writing/iu);
    wrapper.unmount();
  });

  it('distinguishes initial Loading, Empty, and API Error', async () => {
    installApiFetch((url) =>
      url.pathname === '/api/templates' ? new Promise<Response>(() => undefined) : undefined,
    );
    const loading = await mountAdmin('/templates');
    expect(loading.get('[aria-label="Loading templates"]').attributes('aria-busy')).toBe('true');
    expect(loading.findAll('.template-card')).toHaveLength(3);
    loading.unmount();

    installApiFetch((url) => (url.pathname === '/api/templates' ? success([]) : undefined));
    const empty = await mountAdmin('/templates');
    expect(empty.text()).toContain('No templates yet');
    expect(empty.text()).toContain('Create a template before running SparkKeeper.');
    expect(findButton(empty, '+ New template').exists()).toBe(true);
    empty.unmount();

    installApiFetch((url) =>
      url.pathname === '/api/templates'
        ? failure('TEMPLATES_UNAVAILABLE', 'Templates could not be loaded.', 503)
        : undefined,
    );
    const failed = await mountAdmin('/templates');
    expect(failed.get('[role="alert"]').text()).toContain('Templates could not be loaded.');
    expect(failed.text()).not.toContain('No templates yet');
    failed.unmount();
  });

  it('opens Create with blank Static content and creates without trimming message whitespace', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    await findButton(wrapper, '+ New template').trigger('click');
    const editor = wrapper.getComponent(TemplateEditor);
    expect(editor.get('select[name="providerType"]').element).toHaveProperty('value', 'STATIC');
    expect(editor.get('textarea').element).toHaveProperty('value', '');
    expect(editor.findAll('textarea')).toHaveLength(1);
    expect(editor.find('button.template-message-editor__add').exists()).toBe(false);
    await editor.get('input[name="templateName"]').setValue('New Static');
    await editor.get('textarea').setValue('  Message A  ');
    await editor.get('form').trigger('submit');
    await flushPromises();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/templates') && init?.method === 'POST',
    );
    expect(JSON.parse(String(call![1]?.body))).toEqual({
      name: 'New Static',
      providerType: 'STATIC',
      messages: ['  Message A  '],
      enabled: true,
    });
    expect(String(call![0])).not.toContain('Message A');
    expect(window.location.search).toBe('');
    expect(consoleSpy).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Template configuration saved.');
    wrapper.unmount();
  });

  it('creates a valid one-message Random template', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    await findButton(wrapper, '+ New template').trigger('click');
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('One Message Random');
    await editor.get('select[name="providerType"]').setValue('RANDOM');
    await editor.get('textarea[name="message-0"]').setValue('Message A');
    await editor.get('form').trigger('submit');
    await flushPromises();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/templates') && init?.method === 'POST',
    );
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({
      providerType: 'RANDOM',
      messages: ['Message A'],
    });
    wrapper.unmount();
  });

  it('creates a valid multi-message Random template', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    await findButton(wrapper, '+ New template').trigger('click');
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('Random Template');
    await editor.get('select[name="providerType"]').setValue('RANDOM');
    await editor.get('textarea[name="message-0"]').setValue('Message A');
    await editor.get('button.template-message-editor__add').trigger('click');
    await editor.get('textarea[name="message-1"]').setValue('Message B');
    await editor.get('form').trigger('submit');
    await flushPromises();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/templates') && init?.method === 'POST',
    );
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({
      providerType: 'RANDOM',
      messages: ['Message A', 'Message B'],
    });
    wrapper.unmount();
  });

  it('rejects blank Static and all-blank Random messages before POST', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    await findButton(wrapper, '+ New template').trigger('click');
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('Invalid Template');
    await editor.get('form').trigger('submit');
    expect(editor.text()).toContain('Message text is required.');
    await editor.get('select[name="providerType"]').setValue('RANDOM');
    await editor.get('button.template-message-editor__add').trigger('click');
    await editor.get('textarea[name="message-0"]').setValue('   ');
    await editor.get('textarea[name="message-1"]').setValue('');
    await editor.get('form').trigger('submit');
    expect(editor.text()).toContain('Every configured message must contain text.');
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).endsWith('/api/templates') && init?.method === 'POST',
      ),
    ).toBe(false);
    wrapper.unmount();
  });

  it('protects Create against duplicate submissions and exposes loading', async () => {
    let resolvePost!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolvePost = resolve;
    });
    const fetchMock = installApiFetch((url, init) =>
      url.pathname === '/api/templates' && init?.method === 'POST' ? pending : undefined,
    );
    const wrapper = await mountAdmin('/templates');
    await findButton(wrapper, '+ New template').trigger('click');
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('Single Submit');
    await editor.get('textarea').setValue('Message A');
    await editor.get('form').trigger('submit');
    await editor.get('form').trigger('submit');
    expect(editor.text()).toContain('Saving…');
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).endsWith('/api/templates') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    resolvePost(success(templateDetailFixture, 201));
    await flushPromises();
    wrapper.unmount();
  });

  it('retains Create values and shows inline/toast errors after POST failure', async () => {
    installApiFetch((url, init) =>
      url.pathname === '/api/templates' && init?.method === 'POST'
        ? failure('VALIDATION_ERROR', 'Template configuration is invalid.', 400)
        : undefined,
    );
    const wrapper = await mountAdmin('/templates');
    await findButton(wrapper, '+ New template').trigger('click');
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('Retained Template');
    await editor.get('textarea').setValue('Message A');
    await editor.get('form').trigger('submit');
    await flushPromises();
    expect(editor.get('input[name="templateName"]').element).toHaveProperty(
      'value',
      'Retained Template',
    );
    expect(editor.get('[role="alert"]').text()).toContain(
      'The submitted input is invalid. Please review it and try again.',
    );
    expect(wrapper.text()).toContain('Template configuration could not be saved.');
    wrapper.unmount();
  });

  it('shows editor-local detail loading without hiding the Template list', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/templates/${TEMPLATE_ID}`
        ? new Promise<Response>(() => undefined)
        : undefined,
    );
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    expect(wrapper.text()).toContain(templateSummaryFixture.name);
    expect(document.body.querySelector('.drawer .section-loading')?.textContent).toContain(
      'Loading template editor',
    );
    expect(document.body.querySelector('.drawer')).not.toBeNull();
    wrapper.unmount();
  });

  it('loads only the selected Template detail before editing', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/templates' ? success([templateSummaryFixture, summaryB()]) : undefined,
    );
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/api/templates/${TEMPLATE_ID}`)),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith(`/api/templates/${TEMPLATE_B_ID}`),
      ),
    ).toHaveLength(0);
    expect(wrapper.getComponent(TemplateEditor).get('textarea').element).toHaveProperty(
      'value',
      templateDetailFixture.messages[0],
    );
    wrapper.unmount();
  });

  it('keeps list content when selected detail fails and offers Retry and Close', async () => {
    installApiFetch((url) =>
      url.pathname === `/api/templates/${TEMPLATE_ID}`
        ? failure('TEMPLATE_UNAVAILABLE', 'Template detail could not be loaded.', 503)
        : undefined,
    );
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain(templateSummaryFixture.name);
    expect(document.body.querySelector('.drawer [role="alert"]')?.textContent).toContain(
      'Template detail could not be loaded.',
    );
    expect(document.body.querySelector('.drawer')?.textContent).toContain('Retry');
    expect(document.body.querySelector('.drawer')?.textContent).toContain('Close');
    expect(wrapper.findComponent(TemplateEditor).exists()).toBe(false);
    wrapper.unmount();
  });

  it('PATCHes only supported mutable fields and supports enabled/name/message edits', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('Edited Template');
    await editor.get('textarea').setValue('Edited Message A');
    await editor.get('input[name="templateEnabled"]').setValue(false);
    await editor.get('form').trigger('submit');
    await flushPromises();
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(`/api/templates/${TEMPLATE_ID}`) && init?.method === 'PATCH',
    );
    const body = JSON.parse(String(call![1]?.body));
    expect(body).toEqual({
      name: 'Edited Template',
      providerType: 'STATIC',
      messages: ['Edited Message A'],
      enabled: false,
    });
    expect(body).not.toHaveProperty('createdAt');
    expect(body).not.toHaveProperty('updatedAt');
    expect(body).not.toHaveProperty('messageCount');
    wrapper.unmount();
  });

  it('retains all Edit values after PATCH failure', async () => {
    installApiFetch((url, init) =>
      url.pathname === `/api/templates/${TEMPLATE_ID}` && init?.method === 'PATCH'
        ? failure('CONFLICT', 'Template changed before save.', 409)
        : undefined,
    );
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('Retained Edit');
    await editor.get('textarea').setValue('Retained Message');
    await editor.get('input[name="templateEnabled"]').setValue(false);
    await editor.get('form').trigger('submit');
    await flushPromises();
    expect(editor.get('input[name="templateName"]').element).toHaveProperty(
      'value',
      'Retained Edit',
    );
    expect(editor.get('textarea').element).toHaveProperty('value', 'Retained Message');
    expect((editor.get('input[name="templateEnabled"]').element as HTMLInputElement).checked).toBe(
      false,
    );
    expect(editor.get('[role="alert"]').text()).toContain(
      'The current state conflicts with this operation. Please refresh and try again.',
    );
    wrapper.unmount();
  });

  it('closes an unchanged editor directly and confirms before discarding dirty state', async () => {
    installApiFetch();
    const wrapper = await mountAdmin('/templates');
    await findButton(wrapper, '+ New template').trigger('click');
    await wrapper
      .getComponent(TemplateEditor)
      .get('button[type="button"]:last-of-type')
      .trigger('click');
    expect(document.body.querySelector('.drawer')).toBeNull();
    expect(document.body.querySelector('.danger-confirmation')).toBeNull();

    await findButton(wrapper, '+ New template').trigger('click');
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('Unsaved Template');
    await editor
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click');
    expect(document.body.querySelector('.modal-card')?.textContent).toContain(
      'Discard unsaved changes?',
    );
    const keepEditing = [
      ...document.body.querySelectorAll<HTMLButtonElement>('.danger-confirmation button'),
    ].find((button) => button.textContent?.trim() === 'Keep editing');
    keepEditing!.click();
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.drawer')).not.toBeNull();
    expect(editor.get('input[name="templateName"]').element).toHaveProperty(
      'value',
      'Unsaved Template',
    );

    await editor
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click');
    const discard = document.body.querySelector<HTMLButtonElement>(
      '.danger-confirmation .button--danger',
    );
    discard!.click();
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('.drawer')).toBeNull();
    wrapper.unmount();
  });

  it('coalesces TEMPLATE SSE bursts into one list refresh', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/templates');
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();
    source.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_ID, undefined, 't1'));
    source.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_B_ID, undefined, 't2'));
    source.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_ID, undefined, 't3'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/templates')).length,
    ).toBe(2);
    wrapper.unmount();
  });

  it('retains the list after a background SSE refresh error without a toast storm', async () => {
    let listReads = 0;
    const fetchMock = installApiFetch((url) => {
      if (url.pathname !== '/api/templates') return undefined;
      listReads += 1;
      return listReads === 1
        ? success([templateSummaryFixture])
        : failure('TEMPLATE_REFRESH_FAILED', 'Latest templates could not be loaded.', 503);
    });
    installEventSource();
    const wrapper = await mountAdmin('/templates');
    vi.useFakeTimers();
    const source = FakeEventSource.instances[0]!;
    source.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_ID, undefined, 'e1'));
    source.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_ID, undefined, 'e2'));
    source.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_ID, undefined, 'e3'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();

    expect(wrapper.text()).toContain(templateSummaryFixture.name);
    expect(wrapper.text()).toContain('Latest templates could not be loaded.');
    expect(wrapper.find('.stale-data-notice').exists()).toBe(true);
    expect(wrapper.findAll('.toast')).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/templates')),
    ).toHaveLength(2);
    wrapper.unmount();
  });

  it('refreshes an open clean editor after same-template CONFIG_CHANGED', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();
    source.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_ID));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/api/templates/${TEMPLATE_ID}`)),
    ).toHaveLength(2);
    wrapper.unmount();
  });

  it('refreshes the list but not Template A detail for Template B CONFIG_CHANGED', async () => {
    const fetchMock = installApiFetch((url) =>
      url.pathname === '/api/templates' ? success([templateSummaryFixture, summaryB()]) : undefined,
    );
    installEventSource();
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    vi.useFakeTimers();
    FakeEventSource.instances[0]!.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_B_ID));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();

    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/templates')),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(`/api/templates/${TEMPLATE_ID}`),
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it('does not overwrite a dirty editor on SSE and confirms Reload from server', async () => {
    let detailReads = 0;
    const fetchMock = installApiFetch((url) => {
      if (url.pathname !== `/api/templates/${TEMPLATE_ID}`) return undefined;
      detailReads += 1;
      return success({
        ...templateDetailFixture,
        messages: [detailReads === 1 ? 'Message A' : 'Server Message B'],
      });
    });
    installEventSource();
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('textarea').setValue('Unsaved Message');
    const source = FakeEventSource.instances[0]!;
    vi.useFakeTimers();
    source.emit('config-changed', configEvent('TEMPLATE', TEMPLATE_ID));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();
    expect(editor.get('textarea').element).toHaveProperty('value', 'Unsaved Message');
    expect(editor.text()).toContain('Server configuration changed while you were editing.');
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith(`/api/templates/${TEMPLATE_ID}`)),
    ).toHaveLength(1);

    await editor
      .findAll('button')
      .find((button) => button.text() === 'Reload from server')!
      .trigger('click');
    expect(document.body.querySelector('.modal-card')?.textContent).toContain(
      'Reload from server?',
    );
    document.body.querySelector<HTMLButtonElement>('.danger-confirmation .button--danger')!.click();
    await flushPromises();
    expect(wrapper.getComponent(TemplateEditor).get('textarea').element).toHaveProperty(
      'value',
      'Server Message B',
    );
    wrapper.unmount();
  });

  it('retains list and dirty editor while SSE is reconnecting', async () => {
    installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('textarea').setValue('Unsaved during reconnect');
    FakeEventSource.instances[0]!.emit('error');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Reconnecting');
    expect(wrapper.text()).toContain(templateSummaryFixture.name);
    expect(editor.get('textarea').element).toHaveProperty('value', 'Unsaved during reconnect');
    expect(document.body.querySelector('.drawer')).not.toBeNull();
    wrapper.unmount();
  });

  it('bounds a successful mutation plus its SSE echo without duplicate toasts', async () => {
    const fetchMock = installApiFetch();
    installEventSource();
    const wrapper = await mountAdmin('/templates');
    await wrapper.get(`button[aria-label="Edit ${templateSummaryFixture.name}"]`).trigger('click');
    await flushPromises();
    const editor = wrapper.getComponent(TemplateEditor);
    await editor.get('input[name="templateName"]').setValue('Saved Once');
    await editor.get('form').trigger('submit');
    await flushPromises();

    vi.useFakeTimers();
    FakeEventSource.instances[0]!.emit(
      'config-changed',
      configEvent('TEMPLATE', TEMPLATE_ID, undefined, 'echo'),
    );
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    vi.useRealTimers();

    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/templates')),
    ).toHaveLength(3);
    expect(wrapper.findAll('.toast')).toHaveLength(1);
    expect(wrapper.find('.toast').text()).toContain('Template configuration saved.');
    wrapper.unmount();
  });

  it('performs no mutation during ordinary /templates load', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    expect(
      fetchMock.mock.calls.filter(([, init]) =>
        ['POST', 'PATCH', 'PUT'].includes(String(init?.method)),
      ),
    ).toHaveLength(0);
    wrapper.unmount();
  });
});
