import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';

import { useToasts } from '../composables/useToasts';
import Drawer from './Drawer.vue';
import EmptyState from './EmptyState.vue';
import FormField from './FormField.vue';
import InlineError from './InlineError.vue';
import Modal from './Modal.vue';
import PageError from './PageError.vue';
import PageLoading from './PageLoading.vue';
import Skeleton from './Skeleton.vue';
import ToastHost from './ToastHost.vue';

describe('PageLoading', () => {
  it('renders skeleton placeholders instead of a full-screen spinner', () => {
    const wrapper = mount(PageLoading);
    expect(wrapper.find('.skeleton').exists()).toBe(true);
    expect(wrapper.text()).toContain('Loading page…');
    expect(wrapper.find('.page-loading').attributes('role')).toBe('status');
  });

  it('accepts a custom label', () => {
    const wrapper = mount(PageLoading, { props: { label: 'Loading runs…' } });
    expect(wrapper.text()).toContain('Loading runs…');
  });
});

describe('Skeleton', () => {
  it('exposes a status role with an accessible label and size', () => {
    const wrapper = mount(Skeleton, {
      props: { width: '240px', height: '20px', label: 'Loading table…' },
    });
    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.attributes('aria-label')).toBe('Loading table…');
    expect(wrapper.attributes('style')).toContain('width: 240px');
    expect(wrapper.attributes('style')).toContain('height: 20px');
  });
});

describe('InlineError', () => {
  it('renders an inline alert without hiding surrounding content', () => {
    const wrapper = mount(InlineError, { props: { message: 'Section failed to load.' } });
    expect(wrapper.find('.inline-error').attributes('role')).toBe('alert');
    expect(wrapper.text()).toBe('Section failed to load.');
  });
});

describe('PageError', () => {
  it('renders the message and emits retry', async () => {
    const wrapper = mount(PageError, { props: { message: 'Run history failed.' } });
    expect(wrapper.attributes('role')).toBe('alert');
    expect(wrapper.text()).toContain('Unable to load data');
    expect(wrapper.text()).toContain('Run history failed.');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});

describe('EmptyState', () => {
  it('renders title, description and an action slot', () => {
    const wrapper = mount(EmptyState, {
      props: { title: 'No runs yet', description: 'Runs appear after the first schedule fires.' },
      slots: { action: '<button type="button">Create run</button>' },
    });
    expect(wrapper.text()).toContain('No runs yet');
    expect(wrapper.text()).toContain('Runs appear after the first schedule fires.');
    expect(wrapper.find('.empty-state__action button').text()).toBe('Create run');
  });

  it('omits the action region without an action slot', () => {
    const wrapper = mount(EmptyState, { props: { title: 'No templates' } });
    expect(wrapper.find('.empty-state__action').exists()).toBe(false);
  });
});

describe('ToastHost', () => {
  it('renders the shared toast queue with dismiss buttons', async () => {
    const wrapper = mount(ToastHost);
    const { notify } = useToasts();
    notify('success', 'Saved.');
    notify('error', 'Failed.');
    await wrapper.vm.$nextTick();

    const toasts = wrapper.findAll('.toast');
    expect(toasts).toHaveLength(2);
    expect(toasts[0]!.classes()).toContain('toast--success');
    expect(toasts[1]!.classes()).toContain('toast--error');
    expect(wrapper.text()).toContain('Saved.');
    expect(wrapper.text()).toContain('Failed.');

    await toasts[0]!.find('.toast__dismiss').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.toast')).toHaveLength(1);
  });
});

describe('Modal', () => {
  // The modal teleports into document.body, so assertions query the body directly.
  it('renders an accessible dialog only while open', () => {
    const closed = mount(Modal, { props: { open: false, title: 'Hidden' } });
    expect(document.body.querySelector('.modal-card')).toBeNull();
    closed.unmount();

    const open = mount(Modal, { props: { open: true, title: 'Confirm action' } });
    const dialog = document.body.querySelector('.modal-card');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('role')).toBe('dialog');
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(dialog!.textContent).toContain('Confirm action');
    open.unmount();
    expect(document.body.querySelector('.modal-card')).toBeNull();
  });

  it('emits close when Escape is pressed', async () => {
    const wrapper = mount(Modal, { props: { open: true, title: 'Escapable' } });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('moves focus inside and restores the previously focused control', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mount(Modal, { props: { open: true, title: 'Focused modal' } });
    await wrapper.vm.$nextTick();
    expect(document.activeElement).toBe(document.body.querySelector('.modal-card button'));
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });
});

describe('Drawer', () => {
  it('labels the dialog with its title', () => {
    const wrapper = mount(Drawer, { props: { open: true, title: 'Send records' } });
    const dialog = document.body.querySelector('.drawer');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('role')).toBe('dialog');
    expect(dialog!.getAttribute('aria-label')).toBe('Send records');
    wrapper.unmount();
  });

  it('moves focus inside and restores the previously focused control', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mount(Drawer, { props: { open: true, title: 'Focused drawer' } });
    await wrapper.vm.$nextTick();
    expect(document.activeElement).toBe(document.body.querySelector('.drawer button'));
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(trigger);
    wrapper.unmount();
  });
});

describe('FormField', () => {
  it('wires help text into the field description', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Account name', helpText: 'Shown in the account list.' },
      slots: {
        default: h('input', {
          type: 'text',
          id: 'ignored',
        }),
      },
    });
    const help = wrapper.find('.form-field__help');
    expect(help.text()).toBe('Shown in the account list.');
    expect(wrapper.find('.form-field__error').exists()).toBe(false);
  });

  it('shows the error with an alert role and prefers it over help text', () => {
    const wrapper = mount(FormField, {
      props: { label: 'Webhook URL', helpText: 'Help', error: 'URL is required.' },
    });
    expect(wrapper.text()).not.toContain('Help');
    const error = wrapper.find('.form-field__error');
    expect(error.text()).toBe('URL is required.');
    expect(error.attributes('role')).toBe('alert');
  });
});
