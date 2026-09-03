import type { FastifyInstance } from 'fastify';

import {
  mutationErrorResponses,
  notificationConfigurationBodySchema,
  notificationConfigurationSchema,
  notificationDeliveryResultSchema,
  standardErrorResponses,
  successEnvelopeSchema,
} from '../schemas/contracts.js';
import { success } from '../serializers/envelope.js';
import type { NotificationConfigurationInput } from '../services/NotificationConfigurationService.js';
import type { ApiServices } from '../services/ApiServices.js';

export function registerNotificationRoutes(server: FastifyInstance, services: ApiServices): void {
  if (services.notifications === undefined) return;
  const notifications = services.notifications;

  server.get(
    '/api/notification-config',
    {
      config: { auth: 'S' },
      schema: {
        response: {
          200: successEnvelopeSchema(notificationConfigurationSchema),
          ...standardErrorResponses,
        },
      },
    },
    async () => success(notifications.get()),
  );

  server.put<{ Body: NotificationConfigurationInput }>(
    '/api/notification-config',
    {
      config: { auth: 'M' },
      schema: {
        body: notificationConfigurationBodySchema,
        response: {
          200: successEnvelopeSchema(notificationConfigurationSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request) => success(await notifications.update(request.body)),
  );

  server.post<{ Body: Record<string, never> }>(
    '/api/notification-config/test',
    {
      config: { auth: 'M' },
      schema: {
        body: { type: 'object', additionalProperties: false },
        response: {
          200: successEnvelopeSchema(notificationDeliveryResultSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async () => success(await notifications.sendTest()),
  );
}
