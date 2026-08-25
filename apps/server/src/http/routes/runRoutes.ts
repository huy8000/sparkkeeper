import type { DailyRunStatus } from '@sparkkeeper/shared';
import type { FastifyInstance } from 'fastify';

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
  readonly accountId?: string;
  readonly businessDate?: string;
  readonly status?: DailyRunStatus;
  readonly limit?: number;
}

export function registerRunRoutes(server: FastifyInstance, services: ApiServices): void {
  server.get<{ Querystring: RunQuery }>(
    '/api/runs',
    {
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
