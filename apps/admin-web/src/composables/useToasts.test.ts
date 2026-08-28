import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToasts } from './useToasts';

describe('useToasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('notifies with a tone and message and shares one queue', () => {
    const host = useToasts();
    host.notify('success', 'Saved template.');
    const viewer = useToasts();
    expect(viewer.toasts.value).toHaveLength(1);
    expect(viewer.toasts.value[0]).toMatchObject({ tone: 'success', message: 'Saved template.' });
  });

  it('auto-dismisses after the default duration', () => {
    const { toasts, notify } = useToasts();
    notify('info', 'Refreshing data.');
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(toasts.value).toHaveLength(0);
  });

  it('dismisses manually and cancels the pending timer', () => {
    const { toasts, notify, dismiss } = useToasts();
    const id = notify('error', 'Request failed.', 60000);
    expect(toasts.value).toHaveLength(1);
    dismiss(id);
    expect(toasts.value).toHaveLength(0);
    vi.advanceTimersByTime(60000);
    expect(toasts.value).toHaveLength(0);
  });

  it('supports custom durations and independent toasts', () => {
    const { toasts, notify } = useToasts();
    notify('warning', 'Real send enabled.', 1000);
    notify('info', 'Another note.', 5000);
    vi.advanceTimersByTime(1500);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]?.message).toBe('Another note.');
  });
});
