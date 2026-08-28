import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AuthStatusBadge from './AuthStatusBadge.vue';
import RuntimeStatus from './RuntimeStatus.vue';
import RunStatusBadge from './RunStatusBadge.vue';
import SseStatus from './SseStatus.vue';
import StatusBadge from './StatusBadge.vue';

describe('StatusBadge', () => {
  it('uses the shared status mapping unless an explicit contextual label is provided', () => {
    expect(mount(StatusBadge, { props: { status: 'ENABLED' } }).text()).toBe('Enabled');
    expect(
      mount(StatusBadge, { props: { status: 'READY', label: 'Profile configured' } }).text(),
    ).toBe('Profile configured');
  });
});

describe('RunStatusBadge', () => {
  it('renders human text and a tone class per status enum', () => {
    const cases: Array<[string, string, string]> = [
      ['SUCCESS', 'Success', 'status-badge--positive'],
      ['RUNNING', 'Running', 'status-badge--warning'],
      ['FAILED', 'Failed', 'status-badge--danger'],
      ['AUTH_EXPIRED', 'Login expired', 'status-badge--danger'],
      ['RETRY_WAIT', 'Waiting to retry', 'status-badge--warning'],
      ['DELIVERY_UNKNOWN', 'Delivery uncertain', 'status-badge--warning'],
    ];
    for (const [status, label, className] of cases) {
      const wrapper = mount(RunStatusBadge, { props: { status } });
      expect(wrapper.text()).toBe(label);
      expect(wrapper.classes()).toContain(className);
    }
  });
});

describe('AuthStatusBadge', () => {
  it('renders human text for login statuses', () => {
    expect(mount(AuthStatusBadge, { props: { status: 'READY' } }).text()).toBe('Ready');
    expect(mount(AuthStatusBadge, { props: { status: 'AUTH_EXPIRED' } }).text()).toBe(
      'Login expired',
    );
    expect(mount(AuthStatusBadge, { props: { status: 'UNKNOWN' } }).text()).toBe('Unknown');
  });
});

describe('SseStatus', () => {
  it('shows Live when connected and Reconnecting during any reconnect phase', () => {
    expect(mount(SseStatus, { props: { state: 'CONNECTED' } }).text()).toBe('Live');
    expect(mount(SseStatus, { props: { state: 'CONNECTING' } }).text()).toBe('Reconnecting');
    expect(mount(SseStatus, { props: { state: 'RECONNECTING' } }).text()).toBe('Reconnecting');
    expect(mount(SseStatus, { props: { state: 'DISCONNECTED' } }).text()).toBe('Offline');
  });

  it('exposes its state through role="status"', () => {
    const wrapper = mount(SseStatus, { props: { state: 'CONNECTED' } });
    expect(wrapper.attributes('role')).toBe('status');
  });
});

describe('RuntimeStatus', () => {
  it('keeps system status wording separate from realtime wording', () => {
    expect(mount(RuntimeStatus, { props: { status: 'READY' } }).text()).toBe('System Ready');
    expect(mount(RuntimeStatus, { props: { status: 'DEGRADED' } }).text()).toBe('System Degraded');
    expect(mount(RuntimeStatus, { props: { status: 'UNAVAILABLE' } }).text()).toBe(
      'System Unavailable',
    );
    expect(mount(RuntimeStatus, { props: { status: 'LOADING' } }).text()).toBe('Checking system…');
  });
});
