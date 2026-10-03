import type {
  ExecutionRunStatus,
  TargetSendMachineStatus,
  TargetSendFailureCode,
} from './Execution.js';

export interface TestSendPreview {
  readonly intentId: string;
  readonly expiresAt: string;
  readonly payloadDigest: string;
  readonly account: { readonly id: string; readonly name: string };
  readonly templateSummary: {
    readonly id: string;
    readonly name: string;
    readonly providerType: 'STATIC' | 'RANDOM';
  };
  readonly orderedTargets: readonly [
    { readonly id: string; readonly displayName: string; readonly type: 'PERSON' | 'GROUP' },
  ];
  readonly warnings: readonly string[];
}
export interface TestSendAccepted {
  readonly runId: string;
  readonly status: ExecutionRunStatus;
}
export interface TestSendDetail extends TestSendAccepted {
  readonly kind: 'TEST_SEND';
  readonly accountId: string;
  readonly confirmedAt: string;
  readonly finishedAt: string | null;
  readonly record: {
    readonly id: string;
    readonly contactId: string;
    readonly machineStatus: TargetSendMachineStatus;
    readonly failureCode: TargetSendFailureCode | null;
    readonly attemptCount: number;
    readonly sendActionStartedAt: string | null;
    readonly sentAt: string | null;
  };
}
