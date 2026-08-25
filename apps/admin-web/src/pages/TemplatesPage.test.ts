import { flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { TEMPLATE_ID } from '../test/fixtures';
import { failure, installApiFetch } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';

describe('Templates', () => {
  it('renders safe summary data without loading message content', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    expect(wrapper.text()).toContain('Demo Template');
    expect(wrapper.text()).toContain('STATIC');
    expect(wrapper.text()).not.toContain('Fictional template editor content.');
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes(`/api/templates/${TEMPLATE_ID}`)),
    ).toBe(false);
    wrapper.unmount();
  });

  it('creates a STATIC template with local-only editor state', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Create template')!
      .trigger('click');
    await wrapper.get('input[name="templateName"]').setValue('Demo New Template');
    await wrapper.get('textarea[name="message-0"]').setValue('  Fictional unsent editor text.  ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/templates') && init?.method === 'POST',
    );
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({ providerType: 'STATIC' });
    expect(JSON.parse(String(call![1]?.body)).messages).toEqual([
      '  Fictional unsent editor text.  ',
    ]);
    expect(String(call![0])).not.toContain('Fictional unsent editor text.');
    expect(window.location.search).toBe('');
    expect(consoleSpy).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('edits RANDOM messages using the existing provider contract', async () => {
    const fetchMock = installApiFetch();
    const wrapper = await mountAdmin('/templates');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Edit')!
      .trigger('click');
    await flushPromises();
    expect(wrapper.get('textarea[name="message-0"]').element).toHaveProperty(
      'value',
      'Fictional template editor content.',
    );
    await wrapper.get('select[name="providerType"]').setValue('RANDOM');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add message')!
      .trigger('click');
    await wrapper.get('textarea[name="message-1"]').setValue('Fictional second message.');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes(`/api/templates/${TEMPLATE_ID}`) && init?.method === 'PATCH',
    );
    expect(JSON.parse(String(call![1]?.body))).toMatchObject({ providerType: 'RANDOM' });
    wrapper.unmount();
  });

  it('validates messages and shows a safe API failure', async () => {
    installApiFetch((url, init) =>
      url.pathname === '/api/templates' && init?.method === 'POST'
        ? failure('VALIDATION_ERROR', 'Template configuration is invalid.', 400)
        : undefined,
    );
    const wrapper = await mountAdmin('/templates');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Create template')!
      .trigger('click');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain('Template name is required');
    await wrapper.get('input[name="templateName"]').setValue('Demo Invalid');
    await wrapper.get('textarea[name="message-0"]').setValue('Fictional invalid server case.');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Template configuration is invalid.');
    expect(wrapper.html()).not.toMatch(/cookie|browser profile|database path|stack trace/iu);
    wrapper.unmount();
  });
});
