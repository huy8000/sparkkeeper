import type { SafeRuntimeEventRepository } from '@sparkkeeper/database';
import type { NotificationService } from '@sparkkeeper/notifier';
import type { RealtimeEventPublisher } from '../realtime/RealtimeEvent.js';
import { safeEventMessage } from './RuntimeLogger.js';
/** Durable facts are authoritative; this process-local optional relay has no
 * replay/retry semantics and cannot reopen a runtime or send boundary. */
export class V4SafeEventRelay {
  private sequence: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly repository: Pick<SafeRuntimeEventRepository, 'highWater' | 'after'>,
    private readonly realtime: RealtimeEventPublisher,
    private readonly notifications: Pick<NotificationService, 'publish'>,
  ) {
    this.sequence = repository.highWater();
  }
  start() {
    if (!this.timer) {
      this.timer = setInterval(() => this.poll(), 1000);
      this.timer.unref();
    }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  poll() {
    try {
      for (const row of this.repository.after(this.sequence)) {
        this.sequence = row.sequence;
        const message = safeEventMessage(row.eventType),
          level =
            row.eventType === 'RUN_STARTED' || row.eventType === 'RUN_FINISHED' ? 'info' : 'warn';
        try {
          this.realtime.publish({
            type: 'RUNTIME_EVENT',
            data: {
              eventType: row.eventType,
              level,
              message,
              runId: row.runId,
              accountId: row.accountId,
            },
          });
        } catch {
          /* Best effort. */
        }
        if (['AUTH_EXPIRED', 'TASK_FAILED', 'DELIVERY_UNKNOWN'].includes(row.eventType))
          try {
            this.notifications.publish({
              eventType: row.eventType,
              severity: 'WARN',
              safeMessage: message,
              timestamp: row.createdAt.toISOString(),
              runId: row.runId,
              accountId: row.accountId,
            });
          } catch {
            /* No business failure/retry. */
          }
      }
    } catch {
      /* Read failure retains watermark, never changes runtime truth. */
    }
  }
}
