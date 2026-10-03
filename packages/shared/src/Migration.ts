export type RunSource = 'LEGACY_V3' | 'V4';
export interface UnifiedRun {
  id: string;
  source: RunSource;
  kind: 'LEGACY_DAILY' | 'TEST_SEND' | 'SCHEDULED_TASK';
  accountId: string;
  taskId: string | null;
  businessDate: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface UnifiedSendRecord {
  id: string;
  source: RunSource;
  runId: string;
  dailyRunId: string | null;
  friendId: string | null;
  contactId: string | null;
  businessDate: string | null;
  status: string;
  attempts: number;
  failureCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  sendActionStarted: boolean;
  latestResolution: ResolutionSummary | null;
}
export interface ResolutionSummary {
  id: string;
  resolution: 'CONFIRMED_DELIVERED' | 'CONFIRMED_NOT_DELIVERED' | 'INCONCLUSIVE';
  originalMachineStatus: 'DELIVERY_UNKNOWN';
  source: 'HUMAN';
  supersedesResolutionId: string | null;
  resolvedByAdminUserId: string;
  resolvedAt: string;
  note: string | null;
}
export interface LegacyFriendSummary {
  id: string;
  friendId: string;
  accountId: string;
  status: 'PENDING' | 'BOUND' | 'DISMISSED';
  contactId: string | null;
  updatedAt: string;
}
export interface LegacyScheduleSummary {
  id: string;
  scheduleId: string;
  accountId: string;
  status: 'PENDING' | 'CONVERTED' | 'DISMISSED';
  convertedTaskId: string | null;
  startTimeSnapshot: string;
  endTimeSnapshot: string;
  timezoneSnapshot: string;
  maxAttemptsSnapshot: number;
  retryIntervalSecondsSnapshot: number;
  legacyEnabledSnapshot: boolean;
  updatedAt: string;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
