/** Safe internal summary; never a send authorization or persisted evidence token. */
export const DELIVERY_VERIFICATION_REASONS = Object.freeze([
  'DELIVERY_VERIFIED',
  'MESSAGE_INVALID',
  'WITNESS_INVALID',
  'TARGET_CHANGED',
  'SELECTOR_CONTRACT_UNAVAILABLE',
  'PREPARED_INPUT_MISMATCH',
  'ALREADY_CONSUMED',
  'ACTION_BOUNDARY_UNCERTAIN',
  'ACTION_UNCERTAIN',
  'DELIVERY_TIMEOUT',
  'EVIDENCE_INSUFFICIENT',
  'EVIDENCE_AMBIGUOUS',
  'PAGE_UNAVAILABLE',
  'OBSERVATION_FAILED',
] as const);
export type DeliveryVerificationReason = (typeof DELIVERY_VERIFICATION_REASONS)[number];
export type DeliveryVerificationResult =
  | {
      readonly status: 'SUCCESS';
      readonly reason: 'DELIVERY_VERIFIED';
      readonly boundary: 'RECORDED';
      readonly actionInvocations: 1;
    }
  | {
      readonly status: 'FAILED';
      readonly reason: DeliveryVerificationReason;
      readonly boundary: 'NOT_STARTED';
      readonly actionInvocations: 0;
    }
  | {
      readonly status: 'DELIVERY_UNKNOWN';
      readonly reason: DeliveryVerificationReason;
      readonly boundary: 'UNCERTAIN' | 'RECORDED';
      readonly actionInvocations: 0 | 1;
    };
export function normalizeDeliveryText(value: string): string {
  return value.replaceAll('\r\n', '\n');
}
export function isDeliveryMessage(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= 1000 && !value.includes('\0')
  );
}
