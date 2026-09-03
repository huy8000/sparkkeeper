import type { FastifyInstance } from 'fastify';

import {
  healthSchema,
  runtimeStatusSchema,
  standardErrorResponses,
  successEnvelopeSchema,
} from '../schemas/contracts.js';
import { success } from '../serializers/envelope.js';
import type { ApiServices } from '../services/ApiServices.js';

export function registerStatusRoutes(server: FastifyInstance, services: ApiServices): void {
  server.get(
    '/api/health',
    {
      config: { auth: 'P' },
      schema: {
        response: {
          200: successEnvelopeSchema(healthSchema),
          ...standardErrorResponses,
        },
      },
    },
    async () => success(services.status.health()),
  );

  server.get(
    '/api/runtime/status',
    {
      config: { auth: 'S' },
      schema: {
        response: {
          200: successEnvelopeSchema(runtimeStatusSchema),
          ...standardErrorResponses,
        },
      },
    },
    async () => success(services.status.runtime()),
  );
}
