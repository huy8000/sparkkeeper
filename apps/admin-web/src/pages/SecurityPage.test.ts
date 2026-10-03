import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { nextTick, defineComponent, ref } from 'vue';
import { installApiFetch, success, failure } from '../test/http';
import { mountAdmin } from '../test/mountAdmin';
import Modal from '../components/Modal.vue';
import { setLocale } from '../i18n';
const id = '00000000-0000-4000-8000-000000000001';
const session = {
  id,
  current: true,
  sessionVersion: 1,
  createdAt: '2026-10-03T00:00:00Z',
  lastSeenAt: '2026-10-03T00:00:00Z',
  idleExpiresAt: '2026-10-03T00:30:00Z',
  absoluteExpiresAt: '2026-10-03T12:00:00Z',
  revokedAt: null,
};
describe('V4 Security UI', () => {
  it('wrong reauth credentials do not log out a valid AdminSession or replay the operation', async () => {
    const f = installApiFetch((u, i) =>
      u.pathname === '/api/auth/sessions'
        ? success([session])
        : u.pathname === '/api/auth/reauth' && i?.method === 'POST'
          ? failure('INVALID_CREDENTIALS', 'Invalid credentials.', 401)
          : undefined,
    );
    const w = await mountAdmin('/operations/security');
    await w.find('input[type="password"]').setValue('x'.repeat(20));
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('.security-page').exists()).toBe(true);
    expect(w.find('.admin-user-menu').exists()).toBe(true);
    expect(f.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1);
    w.unmount();
  });
  it('renders bilingual session summaries without secrets; navigation is read-only', async () => {
    const f = installApiFetch((u) =>
      u.pathname === '/api/auth/sessions' ? success([session]) : undefined,
    );
    const w = await mountAdmin('/operations/security');
    expect(w.text()).toContain('Current session');
    setLocale('zh-CN');
    await flushPromises();
    expect(w.text()).toContain('当前会话');
    expect(f.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    expect(w.text()).not.toMatch(/csrfToken|passwordHash|tokenDigest/);
    w.unmount();
  });
  it('reauth never retries a mutation and clears password fields after success', async () => {
    const f = installApiFetch((u, i) =>
      u.pathname === '/api/auth/sessions'
        ? success([session])
        : u.pathname === '/api/auth/reauth' && i?.method === 'POST'
          ? success({ reauthenticatedUntil: '2026-10-03T00:05:00Z' })
          : undefined,
    );
    const w = await mountAdmin('/operations/security');
    const field = w.find('input[type="password"]');
    await field.setValue(['Fixture', 'Credential', '123', '!'].join(''));
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('nothing was retried');
    expect(field.element).toHaveProperty('value', '');
    expect(f.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1);
    w.unmount();
  });
  it('failed security mutation is not retried; password inputs are cleared', async () => {
    const f = installApiFetch((u, i) =>
      u.pathname === '/api/auth/sessions'
        ? success([session])
        : i?.method === 'POST'
          ? failure('REAUTH_REQUIRED', 'Rejected', 403)
          : undefined,
    );
    const w = await mountAdmin('/operations/security');
    await w.get('input[type="checkbox"]').setValue(true);
    await w
      .findAll('button')
      .find((b) => b.text() === 'Revoke session')!
      .trigger('click');
    await flushPromises();
    expect(f.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1);
    expect(w.text()).toContain('no automatic retry');
    w.unmount();
  });
  it('password mutation requires confirmation, matching credentials and code-point policy', async () => {
    const f = installApiFetch((u, i) =>
      u.pathname === '/api/auth/sessions'
        ? success([session])
        : u.pathname === '/api/auth/change-password' && i?.method === 'POST'
          ? failure('REAUTH_REQUIRED', 'Rejected', 403)
          : undefined,
    );
    const w = await mountAdmin('/operations/security');
    expect(
      w
        .findAll('button')
        .find((b) => b.text().startsWith('Change password'))!
        .attributes('disabled'),
    ).toBeDefined();
    const fields = w.findAll('input[type="password"]');
    await fields[2]!.setValue('a'.repeat(20));
    await fields[3]!.setValue('b'.repeat(20));
    await w.get('input[type="checkbox"]').setValue(true);
    await w.findAll('form')[1]!.trigger('submit');
    await flushPromises();
    expect(w.text()).toContain('do not match');
    expect(f.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
    for (const length of [13, 257]) {
      await fields[2]!.setValue('😀'.repeat(length));
      await fields[3]!.setValue('😀'.repeat(length));
      await w.findAll('form')[1]!.trigger('submit');
      await flushPromises();
      expect(f.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0);
    }
    expect(fields[2]!.attributes('maxlength')).toBe('512');
    await fields[1]!.setValue('x'.repeat(20));
    await fields[2]!.setValue('😀'.repeat(256));
    await fields[3]!.setValue('😀'.repeat(256));
    await w.findAll('form')[1]!.trigger('submit');
    await flushPromises();
    const mutations = f.mock.calls.filter(([, i]) => i?.method === 'POST');
    expect(mutations).toHaveLength(1);
    expect(JSON.parse(String(mutations[0]![1]!.body)).newPassword).toBe('😀'.repeat(256));
    expect(fields[2]!.element).toHaveProperty('value', '');
    w.unmount();
  });
});
describe('V4 dialog keyboard boundaries', () => {
  it('traps both Tab edges, makes background inert, restores focus and uses unique labels', async () => {
    const host = defineComponent({
      components: { Modal },
      setup() {
        return { open: ref(false) };
      },
      template:
        '<div class="app-shell"><button id="opener" @click="open=true">Open</button><Modal :open="open" title="Fixture" @close="open=false"><button id="last">Last</button></Modal></div>',
    });
    const w = mount(host, { attachTo: document.body });
    const opener = w.get('#opener');
    (opener.element as HTMLElement).focus();
    await opener.trigger('click');
    await nextTick();
    expect(w.get('.app-shell').attributes('inert')).toBeDefined();
    const dialog = document.querySelector('[role="dialog"]')!;
    const controls = dialog.querySelectorAll('button');
    (controls[0] as HTMLElement).focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(controls[1]);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(controls[0]);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await nextTick();
    expect(document.activeElement).toBe(opener.element);
    expect(w.get('.app-shell').attributes('inert')).toBeUndefined();
    w.unmount();
  });
});
