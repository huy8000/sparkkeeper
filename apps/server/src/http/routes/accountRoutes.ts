import type { FastifyInstance } from 'fastify';

import {
  accountSchema,
  friendSchema,
  idParamsSchema,
  scheduleSchema,
  standardErrorResponses,
  successEnvelopeSchema,
} from '../schemas/contracts.js';
import { success } from '../serializers/envelope.js';
import type { ApiServices } from '../services/ApiServices.js';

interface AccountParams {
  readonly accountId: string;
}

interface FriendParams {
  readonly friendId: string;
}

interface ScheduleParams {
  readonly scheduleId: string;
}

export function registerAccountRoutes(server: FastifyInstance, services: ApiServices): void {
  server.get(
    '/api/accounts',
    {
      config: { auth: 'S' },
      schema: {
        response: {
          200: successEnvelopeSchema({ type: 'array', items: accountSchema }),
          ...standardErrorResponses,
        },
      },
    },
    async () => success(services.read.listAccounts()),
  );

  server.get<{ Params: AccountParams }>(
    '/api/accounts/:accountId',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('accountId'),
        response: {
          200: successEnvelopeSchema(accountSchema),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.getAccount(request.params.accountId)),
  );

  server.get<{ Params: AccountParams }>(
    '/api/accounts/:accountId/friends',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('accountId'),
        response: {
          200: successEnvelopeSchema({ type: 'array', items: friendSchema }),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.listFriends(request.params.accountId)),
  );

  server.get<{ Params: FriendParams }>(
    '/api/friends/:friendId',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('friendId'),
        response: {
          200: successEnvelopeSchema(friendSchema),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.getFriend(request.params.friendId)),
  );

  server.get<{ Params: AccountParams }>(
    '/api/accounts/:accountId/schedules',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('accountId'),
        response: {
          200: successEnvelopeSchema({ type: 'array', items: scheduleSchema }),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.listSchedules(request.params.accountId)),
  );

  server.get<{ Params: ScheduleParams }>(
    '/api/schedules/:scheduleId',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('scheduleId'),
        response: {
          200: successEnvelopeSchema(scheduleSchema),
          ...standardErrorResponses,
        },
      },
    },
    async (request) => success(services.read.getSchedule(request.params.scheduleId)),
  );
}
