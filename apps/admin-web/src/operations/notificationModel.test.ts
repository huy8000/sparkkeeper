import { describe, expect, it } from 'vitest';

import { notificationConfigurationFixture } from '../test/fixtures';
import {
  isNotificationConfigured,
  notificationDraftFrom,
  notificationDraftMatches,
  notificationInputFrom,
  validateNotificationDraft,
} from './notificationModel';

describe('notification form model', () => {
  it('creates a local draft without changing persisted semantics', () => {
    const draft = notificationDraftFrom(notificationConfigurationFixture);
    expect(draft).toMatchObject({
      enabled: true,
      provider: 'WEBHOOK',
      webhookUrl: 'https://example.invalid/webhook',
      notifyDeliveryUnknown: true,
    });
    expect(notificationDraftMatches(draft, notificationConfigurationFixture)).toBe(true);
  });

  it('uses trim for validation and outbound URL normalization', () => {
    const draft = notificationDraftFrom(notificationConfigurationFixture);
    draft.webhookUrl = '   ';
    expect(validateNotificationDraft(draft)).toBe('notificationsPage.validation.webhookRequired');
    draft.enabled = false;
    expect(validateNotificationDraft(draft)).toBe('');
    expect(notificationInputFrom(draft).webhookUrl).toBeNull();
  });

  it('detects exact local edits and recognizes configured state from the saved URL', () => {
    const draft = notificationDraftFrom(notificationConfigurationFixture);
    draft.webhookUrl = ` ${draft.webhookUrl}`;
    expect(notificationDraftMatches(draft, notificationConfigurationFixture)).toBe(false);
    expect(isNotificationConfigured(notificationConfigurationFixture)).toBe(true);
    expect(
      isNotificationConfigured({
        ...notificationConfigurationFixture,
        enabled: false,
        webhookUrl: null,
        createdAt: null,
        updatedAt: null,
      }),
    ).toBe(false);
  });
});
