import type { DailyRun, SendRecord } from '../types/api';

export type RunDetailState =
  'SUCCESS' | 'RUNNING' | 'FAILED' | 'AUTH_EXPIRED' | 'DELIVERY_UNKNOWN' | 'READY';

/**
 * Derives the Run Detail primary product state from the persisted run and its
 * send records.
 *
 * DELIVERY_UNKNOWN is a SendRecord status, never a DailyRun status. When a run
 * has already finished and any send record reports an unverified delivery, that
 * uncertainty dominates the page: it outranks the generic FAILED presentation
 * because automatic retries are forbidden for uncertain deliveries.
 *
 * Live runs (READY / RUNNING) keep their live status: their records are still
 * in flux, and a mid-run uncertain record surfaces in the delivery list while
 * the run outcome remains open.
 */
export function deriveRunDetailState(
  run: Pick<DailyRun, 'status'>,
  sendRecords: readonly Pick<SendRecord, 'status'>[],
): RunDetailState {
  const live = run.status === 'READY' || run.status === 'RUNNING';
  const hasUncertainDelivery = sendRecords.some((record) => record.status === 'DELIVERY_UNKNOWN');
  if (!live && hasUncertainDelivery) return 'DELIVERY_UNKNOWN';
  return run.status;
}
