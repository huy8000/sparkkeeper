import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type {
  Page,
  UnifiedRun,
  UnifiedSendRecord,
  ResolutionSummary,
  RunSource,
} from '@sparkkeeper/shared';
import type { DatabaseClient } from '../client/DatabaseClient.js';
import {
  dailyRuns,
  executionRuns,
  sendRecords,
  targetSendRecords,
  deliveryResolutions,
  systemEvents,
  v4SystemEvents,
  auditEvents,
} from '../schema/index.js';
import type { DeliveryResolutionRow } from '../schema/index.js';
import { MigrationError, offsetPage, pageOffset } from './MigrationRepository.js';

const iso = (d: Date | null) => d?.toISOString() ?? null;
export interface UnifiedRunFilter {
  source?: RunSource;
  kind?: string;
  accountId?: string;
  taskId?: string;
  businessDate?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}
export class UnifiedRunRepository {
  constructor(readonly client: DatabaseClient) {}
  list(input: UnifiedRunFilter = {}): Page<UnifiedRun> {
    const offset = pageOffset(input.cursor),
      limit = input.limit ?? 50;
    const predicates = [
      sql`1=1`,
      ...(input.source ? [sql`source=${input.source}`] : []),
      ...(input.kind ? [sql`kind=${input.kind}`] : []),
      ...(input.accountId ? [sql`accountId=${input.accountId}`] : []),
      ...(input.taskId ? [sql`taskId=${input.taskId}`] : []),
      ...(input.businessDate ? [sql`businessDate=${input.businessDate}`] : []),
      ...(input.status ? [sql`status=${input.status}`] : []),
    ];
    const rows = this.client.orm.all<
      Omit<UnifiedRun, 'startedAt' | 'finishedAt' | 'createdAt' | 'updatedAt'> & {
        startedAt: number | null;
        finishedAt: number | null;
        createdAt: number;
        updatedAt: number;
      }
    >(sql`
      SELECT * FROM (
      SELECT id,'LEGACY_V3' AS source,'LEGACY_DAILY' AS kind,account_id AS accountId,NULL AS taskId,business_date AS businessDate,status,started_at AS startedAt,finished_at AS finishedAt,created_at AS createdAt,updated_at AS updatedAt FROM daily_runs
      UNION ALL
      SELECT id,'V4',kind,account_id,task_id,business_date,status,started_at,finished_at,created_at,updated_at FROM execution_runs
      ) WHERE ${sql.join(predicates, sql` AND `)} ORDER BY createdAt DESC,source DESC,id DESC LIMIT ${limit + 1} OFFSET ${offset}`);
    return offsetPage(
      rows.map((r) => ({
        ...r,
        startedAt: r.startedAt === null ? null : new Date(r.startedAt).toISOString(),
        finishedAt: r.finishedAt === null ? null : new Date(r.finishedAt).toISOString(),
        createdAt: new Date(r.createdAt).toISOString(),
        updatedAt: new Date(r.updatedAt).toISOString(),
      })),
      offset,
      limit,
    );
  }
  run(id: string): UnifiedRun {
    const legacy = this.client.orm.select().from(dailyRuns).where(eq(dailyRuns.id, id)).get();
    const modern = this.client.orm
      .select()
      .from(executionRuns)
      .where(eq(executionRuns.id, id))
      .get();
    if (legacy && modern) throw new MigrationError('CONFLICT');
    const r = legacy ?? modern;
    if (!r) throw new MigrationError('NOT_FOUND');
    return {
      id: r.id,
      source: legacy ? 'LEGACY_V3' : 'V4',
      kind: modern?.kind ?? 'LEGACY_DAILY',
      accountId: r.accountId,
      taskId: modern?.taskId ?? null,
      businessDate: r.businessDate,
      status: r.status,
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
  record(id: string): UnifiedSendRecord {
    const legacy = this.client.orm.select().from(sendRecords).where(eq(sendRecords.id, id)).get();
    const modern = this.client.orm
      .select()
      .from(targetSendRecords)
      .where(eq(targetSendRecords.id, id))
      .get();
    if (legacy && modern) throw new MigrationError('CONFLICT');
    const r = legacy ?? modern;
    if (!r) throw new MigrationError('NOT_FOUND');
    const source: RunSource = legacy ? 'LEGACY_V3' : 'V4';
    return {
      id,
      source,
      runId: legacy?.dailyRunId ?? modern!.runId,
      dailyRunId: legacy?.dailyRunId ?? null,
      friendId: legacy?.friendId ?? null,
      contactId: modern?.contactId ?? null,
      businessDate: r.businessDate,
      status: legacy?.status ?? modern!.machineStatus,
      attempts: r.attemptCount,
      failureCode: legacy?.lastErrorCode ?? modern?.failureCode ?? null,
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
      sentAt: iso(r.sentAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      sendActionStarted: r.sendActionStartedAt !== null,
      latestResolution: this.latest(id, source),
    };
  }
  private latest(id: string, source: RunSource): ResolutionSummary | null {
    const rows = this.client.orm
      .select()
      .from(deliveryResolutions)
      .where(
        source === 'V4'
          ? eq(deliveryResolutions.targetSendRecordId, id)
          : eq(deliveryResolutions.legacySendRecordId, id),
      )
      .all();
    if (rows.length === 0) return null;
    const byParent = new Map<string | null, DeliveryResolutionRow>();
    for (const r of rows) {
      if (byParent.has(r.supersedesResolutionId)) throw new MigrationError('CONFLICT');
      byParent.set(r.supersedesResolutionId, r);
    }
    let r = byParent.get(null),
      count = 0;
    const visited = new Set<string>();
    while (r) {
      if (visited.has(r.id)) throw new MigrationError('CONFLICT');
      visited.add(r.id);
      count++;
      const next = byParent.get(r.id);
      if (!next) {
        if (count !== rows.length) throw new MigrationError('CONFLICT');
        return this.resolutionSummary(r);
      }
      r = next;
    }
    throw new MigrationError('CONFLICT');
  }
  resolutionSummary(r: DeliveryResolutionRow): ResolutionSummary {
    return {
      id: r.id,
      resolution: r.resolution,
      originalMachineStatus: 'DELIVERY_UNKNOWN',
      source: 'HUMAN',
      supersedesResolutionId: r.supersedesResolutionId,
      resolvedByAdminUserId: r.resolvedByAdminUserId,
      resolvedAt: r.resolvedAt.toISOString(),
      note: r.note,
    };
  }
  records(runId: string, cursor?: string, limit = 50): Page<UnifiedSendRecord> {
    const run = this.run(runId),
      offset = pageOffset(cursor);
    const ids =
      run.source === 'LEGACY_V3'
        ? this.client.orm
            .select({ id: sendRecords.id })
            .from(sendRecords)
            .where(eq(sendRecords.dailyRunId, runId))
            .orderBy(asc(sendRecords.createdAt), asc(sendRecords.id))
            .limit(limit + 1)
            .offset(offset)
            .all()
        : this.client.orm
            .select({ id: targetSendRecords.id })
            .from(targetSendRecords)
            .where(eq(targetSendRecords.runId, runId))
            .orderBy(asc(targetSendRecords.createdAt), asc(targetSendRecords.id))
            .limit(limit + 1)
            .offset(offset)
            .all();
    return offsetPage(
      ids.map((r) => {
        const row = this.record(r.id);
        return {
          ...row,
          latestResolution: row.latestResolution ? { ...row.latestResolution, note: null } : null,
        };
      }),
      offset,
      limit,
    );
  }
  resolutions(id: string, cursor?: string, limit = 50): Page<ResolutionSummary> {
    const record = this.record(id),
      offset = pageOffset(cursor);
    return offsetPage(
      this.client.orm
        .select()
        .from(deliveryResolutions)
        .where(
          record.source === 'V4'
            ? eq(deliveryResolutions.targetSendRecordId, id)
            : eq(deliveryResolutions.legacySendRecordId, id),
        )
        .orderBy(desc(deliveryResolutions.createdAt), desc(deliveryResolutions.id))
        .limit(limit + 1)
        .offset(offset)
        .all()
        .map((r) => this.resolutionSummary(r)),
      offset,
      limit,
    );
  }
  events(runId: string, cursor?: string, limit = 50) {
    const r = this.run(runId),
      offset = pageOffset(cursor);
    const rows =
      r.source === 'LEGACY_V3'
        ? this.client.orm
            .select()
            .from(systemEvents)
            .where(eq(systemEvents.runId, runId))
            .orderBy(asc(systemEvents.createdAt), asc(systemEvents.id))
            .limit(limit + 1)
            .offset(offset)
            .all()
            .map((e) => ({
              eventType: e.eventType,
              level: e.level,
              friendId: e.friendId,
              attempt: e.attempt,
              errorCode: e.errorCode,
              message: e.eventType,
              screenshotEvidenceAvailable: e.screenshotPath !== null,
              traceEvidenceAvailable: e.tracePath !== null,
              createdAt: e.createdAt.toISOString(),
            }))
        : this.client.orm
            .select()
            .from(v4SystemEvents)
            .where(eq(v4SystemEvents.runId, runId))
            .orderBy(asc(v4SystemEvents.sequence))
            .limit(limit + 1)
            .offset(offset)
            .all()
            .map((e) => ({
              eventType: e.eventType,
              level:
                e.eventType === 'RUN_STARTED' || e.eventType === 'RUN_FINISHED' ? 'INFO' : 'WARN',
              friendId: null,
              recordId: e.recordId,
              attempt: null,
              errorCode: null,
              message: e.eventType,
              screenshotEvidenceAvailable: false,
              traceEvidenceAvailable: false,
              createdAt: e.createdAt.toISOString(),
            }));
    return {
      items: rows.slice(0, limit),
      nextCursor:
        rows.length > limit ? Buffer.from(`v1:${offset + limit}`).toString('base64url') : null,
    };
  }
  audits(input: { cursor?: string; limit?: number; action?: string; outcome?: string } = {}) {
    const offset = pageOffset(input.cursor),
      limit = input.limit ?? 50;
    return offsetPage(
      this.client.orm
        .select()
        .from(auditEvents)
        .where(
          and(
            ...(input.action
              ? [eq(auditEvents.action, input.action as typeof auditEvents.$inferSelect.action)]
              : []),
            ...(input.outcome
              ? [eq(auditEvents.outcome, input.outcome as typeof auditEvents.$inferSelect.outcome)]
              : []),
          ),
        )
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(limit + 1)
        .offset(offset)
        .all()
        .map((r) => ({
          id: r.id,
          actorAdminUserId: r.actorAdminUserId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          outcome: r.outcome,
          createdAt: r.createdAt.toISOString(),
        })),
      offset,
      limit,
    );
  }
}
