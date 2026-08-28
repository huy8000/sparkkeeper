import { describe, expect, it } from 'vitest';

import { i18n } from './i18n';
import { manualRunBlockedReasonKey } from './manualRunLabels';
import type { ManualRunBlockedReason } from './types/api';

describe('manualRunBlockedReasonKey', () => {
  it.each<[ManualRunBlockedReason, string]>([
    ['MANUAL_RUN_DISABLED', 'manualRun.blocker.manualRunDisabled'],
    ['REAL_SEND_NOT_AUTHORIZED', 'manualRun.blocker.realSendNotAuthorized'],
    ['ACCOUNT_DISABLED', 'manualRun.blocker.accountDisabled'],
    ['TEMPLATE_DISABLED', 'manualRun.blocker.templateDisabled'],
    ['NO_ENABLED_FRIENDS', 'manualRun.blocker.noEnabledFriends'],
    ['SCHEDULE_NOT_CONFIGURED', 'manualRun.blocker.scheduleNotConfigured'],
    ['RUN_IN_PROGRESS', 'manualRun.blocker.runInProgress'],
    ['RUN_ALREADY_COMPLETE', 'manualRun.blocker.runAlreadyComplete'],
    ['RUN_TERMINAL', 'manualRun.blocker.runTerminal'],
  ])('maps %s', (reason, key) => {
    expect(manualRunBlockedReasonKey(reason)).toBe(key);
  });

  it('resolves every blocker to non-empty text in both locales', () => {
    const reasons: ManualRunBlockedReason[] = [
      'MANUAL_RUN_DISABLED',
      'REAL_SEND_NOT_AUTHORIZED',
      'ACCOUNT_DISABLED',
      'TEMPLATE_DISABLED',
      'NO_ENABLED_FRIENDS',
      'SCHEDULE_NOT_CONFIGURED',
      'RUN_IN_PROGRESS',
      'RUN_ALREADY_COMPLETE',
      'RUN_TERMINAL',
    ];
    const t = i18n.global.t;
    for (const locale of ['en-US', 'zh-CN'] as const) {
      i18n.global.locale.value = locale;
      for (const reason of reasons) {
        expect(t(manualRunBlockedReasonKey(reason))).not.toBe('');
      }
    }
  });
});
