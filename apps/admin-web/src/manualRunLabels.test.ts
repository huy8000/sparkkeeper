import { describe, expect, it } from 'vitest';

import { manualRunBlockedReasonLabel } from './manualRunLabels';
import type { ManualRunBlockedReason } from './types/api';

describe('manualRunBlockedReasonLabel', () => {
  it.each<[ManualRunBlockedReason, string]>([
    ['MANUAL_RUN_DISABLED', 'Manual Run is disabled by the server operator.'],
    ['REAL_SEND_NOT_AUTHORIZED', 'Real sending is not authorized.'],
    ['ACCOUNT_DISABLED', 'This account is disabled.'],
    ['TEMPLATE_DISABLED', 'The selected template is disabled.'],
    ['NO_ENABLED_FRIENDS', 'There are no enabled friends.'],
    ['SCHEDULE_NOT_CONFIGURED', 'A schedule must be configured first.'],
    ['RUN_IN_PROGRESS', 'A run is already in progress.'],
    ['RUN_ALREADY_COMPLETE', "Today's run is already complete."],
    ['RUN_TERMINAL', "Today's run has already reached a terminal state."],
  ])('maps %s', (reason, label) => {
    expect(manualRunBlockedReasonLabel(reason)).toBe(label);
  });
});
