/* global HTMLButtonElement, HTMLInputElement, HTMLTextAreaElement */
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { templateDetailFixture } from '../../test/fixtures';
import TemplateEditor from './TemplateEditor.vue';

function randomDetail(messages = ['Message A', 'Message B']) {
  return { ...templateDetailFixture, providerType: 'RANDOM' as const, messages };
}

describe('TemplateEditor', () => {
  it('labels fields and prevents removing the final Random message', async () => {
    const wrapper = mount(TemplateEditor, {
      attachTo: document.body,
      props: { template: randomDetail(['Message A']) },
    });
    expect(wrapper.get('label[for]').text()).toContain('Template name');
    expect(wrapper.get('label[for="template-message-0"]').text()).toBe('Message 1');
    expect(wrapper.get('button[aria-label="Remove Message 1"]').attributes('disabled')).toBe('');
    wrapper.unmount();
  });

  it('adds, edits, and removes Random candidates without altering remaining order', async () => {
    const wrapper = mount(TemplateEditor, {
      attachTo: document.body,
      props: { template: randomDetail() },
    });
    await wrapper.get('button.template-message-editor__add').trigger('click');
    await wrapper.get('textarea[name="message-2"]').setValue('Message C');
    await wrapper.get('button[aria-label="Remove Message 2"]').trigger('click');
    expect(
      wrapper.findAll('textarea').map((item) => (item.element as HTMLTextAreaElement).value),
    ).toEqual(['Message A', 'Message C']);
    wrapper.unmount();
  });

  it('switches Static to Random without losing its message', async () => {
    const wrapper = mount(TemplateEditor, {
      attachTo: document.body,
      props: { template: templateDetailFixture },
    });
    await wrapper.get('select[name="providerType"]').setValue('RANDOM');
    expect(wrapper.get('textarea[name="message-0"]').element).toHaveProperty(
      'value',
      templateDetailFixture.messages[0],
    );
    expect(wrapper.findAll('textarea')).toHaveLength(1);
    wrapper.unmount();
  });

  it('switches one-message Random to Static directly', async () => {
    const wrapper = mount(TemplateEditor, {
      attachTo: document.body,
      props: { template: randomDetail(['Message A']) },
    });
    await wrapper.get('select[name="providerType"]').setValue('STATIC');
    expect(wrapper.get('select[name="providerType"]').element).toHaveProperty('value', 'STATIC');
    expect(document.body.querySelector('.modal-card')).toBeNull();
    expect(wrapper.get('textarea').element).toHaveProperty('value', 'Message A');
    wrapper.unmount();
  });

  it('cancels multi-message Random to Static without data loss', async () => {
    const wrapper = mount(TemplateEditor, {
      attachTo: document.body,
      props: { template: randomDetail() },
    });
    await wrapper.get('select[name="providerType"]').setValue('STATIC');
    expect(document.body.querySelector('.modal-card')?.textContent).toContain(
      'Static templates can contain only one message.',
    );
    const cancel = [
      ...document.body.querySelectorAll<HTMLButtonElement>('.modal-card button'),
    ].find((button) => button.textContent?.trim() === 'Cancel');
    cancel!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.get('select[name="providerType"]').element).toHaveProperty('value', 'RANDOM');
    expect(
      wrapper.findAll('textarea').map((item) => (item.element as HTMLTextAreaElement).value),
    ).toEqual(['Message A', 'Message B']);
    wrapper.unmount();
  });

  it('keeps the explicitly selected message in a multi-message switch', async () => {
    const wrapper = mount(TemplateEditor, {
      attachTo: document.body,
      props: { template: randomDetail() },
    });
    await wrapper.get('select[name="providerType"]').setValue('STATIC');
    const radios = document.body.querySelectorAll<HTMLInputElement>('input[name="staticMessage"]');
    radios[1]!.click();
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('.modal-card button'),
    ].find((button) => button.textContent?.trim() === 'Keep selected message');
    confirm!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.get('select[name="providerType"]').element).toHaveProperty('value', 'STATIC');
    expect(wrapper.findAll('textarea')).toHaveLength(1);
    expect(wrapper.get('textarea').element).toHaveProperty('value', 'Message B');
    wrapper.unmount();
  });

  it('validates Static and Random messages and emits original message whitespace', async () => {
    const wrapper = mount(TemplateEditor, { attachTo: document.body });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.findAll('[role="alert"]').map((item) => item.text())).toEqual(
      expect.arrayContaining(['Template name is required.', 'Message text is required.']),
    );
    expect(wrapper.emitted('submit')).toBeUndefined();

    await wrapper.get('input[name="templateName"]').setValue(' Demo ');
    await wrapper.get('textarea').setValue('  Message A  ');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      name: 'Demo',
      providerType: 'STATIC',
      messages: ['  Message A  '],
    });
    wrapper.unmount();
  });

  it('reports dirty state and renders a server-change warning without overwriting values', async () => {
    const wrapper = mount(TemplateEditor, {
      attachTo: document.body,
      props: { template: templateDetailFixture },
    });
    await wrapper.get('textarea').setValue('Unsaved Message A');
    expect(wrapper.emitted('dirtyChange')?.at(-1)).toEqual([true]);
    await wrapper.setProps({ serverChanged: true });
    expect(wrapper.get('[role="alert"]').text()).toContain('Server configuration changed');
    expect(wrapper.get('textarea').element).toHaveProperty('value', 'Unsaved Message A');
    wrapper.unmount();
  });
});
