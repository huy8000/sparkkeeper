import type { FastifyInstance } from 'fastify';

import {
  idParamsSchema,
  manualRunAcceptedSchema,
  manualRunPreflightQuerySchema,
  manualRunPreflightSchema,
  manualRunRequestBodySchema,
  mutationErrorResponses,
  standardErrorResponses,
  successEnvelopeSchema,
} from '../schemas/contracts.js';
import { success } from '../serializers/envelope.js';
import type { ManualRunRequest } from '../services/ManualRunService.js';
import type { ApiServices } from '../services/ApiServices.js';

interface AccountParams {
  readonly accountId: string;
}

interface PreflightQuery {
  readonly templateId: string;
}

export function registerManualRunRoutes(server: FastifyInstance, services: ApiServices): void {
  if (services.manualRun === undefined) return;
  const manualRun = services.manualRun;

  server.get<{ Params: AccountParams; Querystring: PreflightQuery }>(
    '/api/accounts/:accountId/manual-run/preflight',
    {
      schema: {
        params: idParamsSchema('accountId'),
        querystring: manualRunPreflightQuerySchema,
        response: {
          200: successEnvelopeSchema(manualRunPreflightSchema),
          ...standardErrorResponses,
        },
      },
    },
    async (request) =>
      success(manualRun.preflight(request.params.accountId, request.query.templateId)),
  );

  server.post<{ Params: AccountParams; Body: ManualRunRequest }>(
    '/api/accounts/:accountId/manual-runs',
    {
      schema: {
        params: idParamsSchema('accountId'),
        body: manualRunRequestBodySchema,
        response: {
          202: successEnvelopeSchema(manualRunAcceptedSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) =>
      reply.code(202).send(success(manualRun.start(request.params.accountId, request.body))),
  );
}
