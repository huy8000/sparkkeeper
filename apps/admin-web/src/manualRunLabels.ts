import type { ManualRunBlockedReason } from './types/api';

/** Single enum → translation key map; per-language text lives only in locale resources. */
const BLOCKED_REASON_KEYS: Record<ManualRunBlockedReason, string> = {
  MANUAL_RUN_DISABLED: 'manualRun.blocker.manualRunDisabled',
  REAL_SEND_NOT_AUTHORIZED: 'manualRun.blocker.realSendNotAuthorized',
  ACCOUNT_DISABLED: 'manualRun.blocker.accountDisabled',
  TEMPLATE_DISABLED: 'manualRun.blocker.templateDisabled',
  NO_ENABLED_FRIENDS: 'manualRun.blocker.noEnabledFriends',
  SCHEDULE_NOT_CONFIGURED: 'manualRun.blocker.scheduleNotConfigured',
  RUN_IN_PROGRESS: 'manualRun.blocker.runInProgress',
  RUN_ALREADY_COMPLETE: 'manualRun.blocker.runAlreadyComplete',
  RUN_TERMINAL: 'manualRun.blocker.runTerminal',
};

export function manualRunBlockedReasonKey(reason: ManualRunBlockedReason): string {
  return BLOCKED_REASON_KEYS[reason];
}
