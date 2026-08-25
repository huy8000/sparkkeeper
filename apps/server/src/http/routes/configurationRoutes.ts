import type { FastifyInstance } from 'fastify';

import {
  accountSchema,
  configureScheduleBodySchema,
  createAccountBodySchema,
  createFriendBodySchema,
  createTemplateBodySchema,
  friendSchema,
  idParamsSchema,
  mutationErrorResponses,
  scheduleSchema,
  successEnvelopeSchema,
  templateDetailSchema,
  templateSummarySchema,
  updateAccountBodySchema,
  updateFriendBodySchema,
  updateTemplateBodySchema,
} from '../schemas/contracts.js';
import { success } from '../serializers/envelope.js';
import type {
  ConfigureScheduleInput,
  CreateAccountConfigInput,
  FriendConfigInput,
  TemplateConfigInput,
  UpdateAccountConfigInput,
  UpdateFriendConfigInput,
  UpdateTemplateConfigInput,
} from '../services/ApiConfigurationService.js';
import type { ApiServices } from '../services/ApiServices.js';

interface AccountParams {
  readonly accountId: string;
}
interface FriendParams {
  readonly friendId: string;
}
interface TemplateParams {
  readonly templateId: string;
}

export function registerConfigurationRoutes(server: FastifyInstance, services: ApiServices): void {
  server.post<{ Body: CreateAccountConfigInput }>(
    '/api/accounts',
    {
      schema: {
        body: createAccountBodySchema,
        response: {
          201: successEnvelopeSchema(accountSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(success(services.configuration.createAccount(request.body))),
  );

  server.patch<{ Params: AccountParams; Body: UpdateAccountConfigInput }>(
    '/api/accounts/:accountId',
    {
      schema: {
        params: idParamsSchema('accountId'),
        body: updateAccountBodySchema,
        response: {
          200: successEnvelopeSchema(accountSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request) =>
      success(services.configuration.updateAccount(request.params.accountId, request.body)),
  );

  server.post<{ Params: AccountParams; Body: FriendConfigInput }>(
    '/api/accounts/:accountId/friends',
    {
      schema: {
        params: idParamsSchema('accountId'),
        body: createFriendBodySchema,
        response: {
          201: successEnvelopeSchema(friendSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(success(services.configuration.createFriend(request.params.accountId, request.body))),
  );

  server.patch<{ Params: FriendParams; Body: UpdateFriendConfigInput }>(
    '/api/friends/:friendId',
    {
      schema: {
        params: idParamsSchema('friendId'),
        body: updateFriendBodySchema,
        response: {
          200: successEnvelopeSchema(friendSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request) =>
      success(services.configuration.updateFriend(request.params.friendId, request.body)),
  );

  server.get(
    '/api/templates',
    {
      schema: {
        response: {
          200: successEnvelopeSchema({ type: 'array', items: templateSummarySchema }),
          ...mutationErrorResponses,
        },
      },
    },
    async () => success(services.configuration.listTemplates()),
  );

  server.get<{ Params: TemplateParams }>(
    '/api/templates/:templateId',
    {
      schema: {
        params: idParamsSchema('templateId'),
        response: {
          200: successEnvelopeSchema(templateDetailSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request) => success(services.configuration.getTemplate(request.params.templateId)),
  );

  server.post<{ Body: TemplateConfigInput }>(
    '/api/templates',
    {
      schema: {
        body: createTemplateBodySchema,
        response: {
          201: successEnvelopeSchema(templateDetailSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(success(services.configuration.createTemplate(request.body))),
  );

  server.patch<{ Params: TemplateParams; Body: UpdateTemplateConfigInput }>(
    '/api/templates/:templateId',
    {
      schema: {
        params: idParamsSchema('templateId'),
        body: updateTemplateBodySchema,
        response: {
          200: successEnvelopeSchema(templateDetailSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request) =>
      success(services.configuration.updateTemplate(request.params.templateId, request.body)),
  );

  server.put<{ Params: AccountParams; Body: ConfigureScheduleInput }>(
    '/api/accounts/:accountId/schedule',
    {
      schema: {
        params: idParamsSchema('accountId'),
        body: configureScheduleBodySchema,
        response: {
          200: successEnvelopeSchema(scheduleSchema),
          ...mutationErrorResponses,
        },
      },
    },
    async (request) =>
      success(services.configuration.configureSchedule(request.params.accountId, request.body)),
  );
}
