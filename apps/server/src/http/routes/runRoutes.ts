import type { DailyRunStatus } from '@sparkkeeper/shared';
import type { FastifyInstance } from 'fastify';
import { migrationSafe, type MigrationApiService } from '../services/MigrationApiService.js';
import { safeEventMessage, safeRuntimeErrorCode } from '../../observability/RuntimeLogger.js';
import type { RunSource } from '@sparkkeeper/shared';

import {
  dailyRunSchema,
  idParamsSchema,
  runQuerySchema,
  sendRecordSchema,
  standardErrorResponses,
  successEnvelopeSchema,
  systemEventSchema,
} from '../schemas/contracts.js';
import { success } from '../serializers/envelope.js';
import type { ApiServices } from '../services/ApiServices.js';

interface RunParams {
  readonly runId: string;
}

interface RunQuery {
  readonly source?: RunSource;
  readonly kind?: string;
  readonly taskId?: string;
  readonly cursor?: string;
  readonly accountId?: string;
  readonly businessDate?: string;
  readonly status?: DailyRunStatus;
  readonly limit?: number;
}

export function registerRunRoutes(
  server: FastifyInstance,
  services: ApiServices,
  migration?: MigrationApiService,
): void {
  if (migration) {
    const pageQuery = {
      type: 'object',
      additionalProperties: false,
      properties: {
        cursor: { type: 'string', maxLength: 24 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    };
    server.get<{ Querystring: RunQuery }>(
      '/api/runs',
      {
        config: { auth: 'S' },
        schema: {
          querystring: {
            ...pageQuery,
            properties: {
              ...pageQuery.properties,
              source: { type: 'string', enum: ['LEGACY_V3', 'V4'] },
              kind: { type: 'string', enum: ['LEGACY_DAILY', 'TEST_SEND', 'SCHEDULED_TASK'] },
              accountId: { type: 'string', format: 'uuid' },
              taskId: { type: 'string', format: 'uuid' },
              businessDate: { type: 'string', format: 'date' },
              status: {
                type: 'string',
                enum: [
                  'READY',
                  'PENDING',
                  'RUNNING',
                  'SUCCESS',
                  'PARTIAL_FAILED',
                  'FAILED',
                  'DELIVERY_UNKNOWN',
                  'AUTH_EXPIRED',
                  'CANCELLED',
                  'RETRY_WAIT',
                  'SKIPPED',
                ],
              },
            },
          },
        },
      },
      async (req, reply) => {
        const page = migrationSafe(() => migration.runs.list(req.query));
        if (page.nextCursor) reply.header('X-SparkKeeper-Next-Cursor', page.nextCursor);
        return success(page.items);
      },
    );
    server.get<{ Params: RunParams }>(
      '/api/runs/:runId',
      { config: { auth: 'S' }, schema: { params: idParamsSchema('runId') } },
      async (req) => success(migrationSafe(() => migration.runs.run(req.params.runId))),
    );
    for (const kind of ['send-records', 'events'] as const)
      server.get<{ Params: RunParams; Querystring: { cursor?: string; limit?: number } }>(
        `/api/runs/:runId/${kind}`,
        {
          config: { auth: 'S' },
          schema: { params: idParamsSchema('runId'), querystring: pageQuery },
        },
        async (req, reply) => {
          const page = migrationSafe(() =>
            kind === 'send-records'
              ? migration.runs.records(req.params.runId, req.query.cursor, req.query.limit)
              : migration.runs.events(req.params.runId, req.query.cursor, req.query.limit),
          );
          if (page.nextCursor) reply.header('X-SparkKeeper-Next-Cursor', page.nextCursor);
          return success(
            kind === 'send-records'
              ? page.items
              : page.items.map((e) => ({
                  ...e,
                  errorCode: safeRuntimeErrorCode((e as { errorCode: string | null }).errorCode),
                  message: safeEventMessage(
                    (e as { eventType: Parameters<typeof safeEventMessage>[0] }).eventType,
                  ),
                })),
          );
        },
      );
    return;
  }
  server.get<{ Querystring: RunQuery }>(
    '/api/runs',
    {
      config: { auth: 'S' },
      schema: {
        querystring: runQuerySchema,
        response: {
          200: successEnvelopeSchema({ type: 'array', items: dailyRunSchema }),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.listRuns(request.query)),
  );

  server.get<{ Params: RunParams }>(
    '/api/runs/:runId',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('runId'),
        response: {
          200: successEnvelopeSchema(dailyRunSchema),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.getRun(request.params.runId)),
  );

  server.get<{ Params: RunParams }>(
    '/api/runs/:runId/send-records',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('runId'),
        response: {
          200: successEnvelopeSchema({ type: 'array', items: sendRecordSchema }),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.listSendRecords(request.params.runId)),
  );

  server.get<{ Params: RunParams }>(
    '/api/runs/:runId/events',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('runId'),
        response: {
          200: successEnvelopeSchema({ type: 'array', items: systemEventSchema }),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.listSystemEvents(request.params.runId)),
  );
}
