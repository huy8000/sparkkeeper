import type { FastifyInstance } from 'fastify';
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  DELIVERY_RESOLUTION_VALUES,
  type DeliveryResolutionValue,
} from '@sparkkeeper/shared';
import { success } from '../serializers/envelope.js';
import { migrationSafe, type MigrationApiService } from '../services/MigrationApiService.js';
const uuid = { type: 'string', format: 'uuid' };
const stamp = { type: 'string', format: 'date-time' };
const pagination = {
  cursor: { type: 'string', maxLength: 24 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
};
const params = (id: string) => ({
  type: 'object',
  additionalProperties: false,
  required: [id],
  properties: { [id]: uuid },
});
type PageQuery = { cursor?: string; limit?: number; accountId?: string };
export function registerMigrationRoutes(server: FastifyInstance, service: MigrationApiService) {
  server.get('/api/system/migration-status', { config: { auth: 'S' } }, async () =>
    success(service.repository.status()),
  );
  server.get<{ Params: { accountId: string }; Querystring: PageQuery }>(
    '/api/accounts/:accountId/legacy-friend-bindings',
    {
      config: { auth: 'S' },
      schema: {
        params: params('accountId'),
        querystring: { type: 'object', additionalProperties: false, properties: pagination },
      },
    },
    async (req) =>
      success(
        migrationSafe(() =>
          service.repository.friendBindings(
            req.params.accountId,
            req.query.cursor,
            req.query.limit,
          ),
        ),
      ),
  );
  server.get<{ Querystring: PageQuery }>(
    '/api/legacy-schedule-imports',
    {
      config: { auth: 'S' },
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { ...pagination, accountId: uuid },
        },
      },
    },
    async (req) =>
      success(
        migrationSafe(() =>
          service.repository.scheduleImports(
            req.query.accountId,
            req.query.cursor,
            req.query.limit,
          ),
        ),
      ),
  );
  for (const operation of ['bind', 'dismiss'] as const)
    server.post<{
      Params: { bindingId: string };
      Body: { expectedUpdatedAt: string; contactId?: string; confirmationText: string };
    }>(
      `/api/legacy-friend-bindings/:bindingId/${operation}`,
      {
        config: { auth: 'R' },
        schema: {
          params: params('bindingId'),
          body: {
            type: 'object',
            additionalProperties: false,
            required: [
              'expectedUpdatedAt',
              'confirmationText',
              ...(operation === 'bind' ? ['contactId'] : []),
            ],
            properties: {
              expectedUpdatedAt: stamp,
              confirmationText: {
                type: 'string',
                const: operation === 'bind' ? 'BIND' : 'DISMISS',
              },
              ...(operation === 'bind' ? { contactId: uuid } : {}),
            },
          },
        },
      },
      async (req) => {
        const r = migrationSafe(() =>
          service.repository.bindFriend(
            req.params.bindingId,
            req.body.expectedUpdatedAt,
            req.body.contactId ?? null,
            req.authContext!.adminUserId,
            service.clock(),
          ),
        );
        service.changed('MIGRATION', req.params.bindingId);
        return success(r);
      },
    );
  for (const operation of ['convert', 'dismiss'] as const)
    server.post<{
      Params: { importId: string };
      Body: {
        name?: string;
        templateId?: string;
        contactIds?: string[];
        expectedUpdatedAt: string;
        confirmationText: string;
      };
    }>(
      `/api/legacy-schedule-imports/:importId/${operation}`,
      {
        config: { auth: 'R' },
        bodyLimit: 16384,
        schema: {
          params: params('importId'),
          body: {
            type: 'object',
            additionalProperties: false,
            required: [
              'expectedUpdatedAt',
              'confirmationText',
              ...(operation === 'convert' ? ['name', 'templateId', 'contactIds'] : []),
            ],
            properties: {
              expectedUpdatedAt: stamp,
              confirmationText: {
                type: 'string',
                const: operation === 'convert' ? 'IMPORT DISABLED' : 'DISMISS',
              },
              ...(operation === 'convert'
                ? {
                    name: { type: 'string', minLength: 1, maxLength: 120 },
                    templateId: uuid,
                    contactIds: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 100,
                      uniqueItems: true,
                      items: uuid,
                    },
                  }
                : {}),
            },
          },
        },
      },
      async (req, reply) => {
        const r = migrationSafe(() =>
          service.repository.convertSchedule(
            req.params.importId,
            req.body.expectedUpdatedAt,
            operation === 'convert'
              ? {
                  name: req.body.name!,
                  templateId: req.body.templateId!,
                  contactIds: req.body.contactIds!,
                }
              : null,
            req.authContext!.adminUserId,
            service.clock(),
          ),
        );
        service.changed('MIGRATION', req.params.importId);
        return reply.code(operation === 'convert' ? 201 : 200).send(success(r));
      },
    );
  server.get<{ Params: { recordId: string } }>(
    '/api/send-records/:recordId',
    { config: { auth: 'S' }, schema: { params: params('recordId') } },
    async (req) => success(migrationSafe(() => service.runs.record(req.params.recordId))),
  );
  server.get<{ Params: { recordId: string }; Querystring: PageQuery }>(
    '/api/send-records/:recordId/resolutions',
    {
      config: { auth: 'S' },
      schema: {
        params: params('recordId'),
        querystring: { type: 'object', additionalProperties: false, properties: pagination },
      },
    },
    async (req) =>
      success(
        migrationSafe(() =>
          service.runs.resolutions(req.params.recordId, req.query.cursor, req.query.limit),
        ),
      ),
  );
  server.post<{
    Params: { recordId: string };
    Body: {
      resolution: DeliveryResolutionValue;
      note?: string;
      expectedLatestResolutionId: string | null;
      confirmationText: string;
    };
  }>(
    '/api/send-records/:recordId/resolutions',
    {
      config: { auth: 'R' },
      bodyLimit: 4096,
      schema: {
        params: params('recordId'),
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['resolution', 'expectedLatestResolutionId', 'confirmationText'],
          properties: {
            resolution: { type: 'string', enum: [...DELIVERY_RESOLUTION_VALUES] },
            note: { type: 'string', minLength: 1, maxLength: 500 },
            expectedLatestResolutionId: { anyOf: [uuid, { type: 'null' }] },
            confirmationText: { type: 'string', const: 'RESOLVE WITHOUT RESEND' },
          },
        },
      },
    },
    async (req, reply) => {
      const r = migrationSafe(() =>
        service.repository.resolve(
          req.params.recordId,
          req.body.expectedLatestResolutionId,
          req.body.resolution,
          req.body.note,
          req.authContext!.adminUserId,
          service.clock(),
        ),
      );
      service.changed('DELIVERY_RESOLUTION', req.params.recordId);
      return reply.code(201).send(success(r));
    },
  );
  server.get<{ Querystring: PageQuery & { action?: string; outcome?: string } }>(
    '/api/system/audit-events',
    {
      config: { auth: 'S' },
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ...pagination,
            action: { type: 'string', enum: [...AUDIT_ACTIONS] },
            outcome: { type: 'string', enum: [...AUDIT_OUTCOMES] },
          },
        },
      },
    },
    async (req) => success(migrationSafe(() => service.runs.audits(req.query))),
  );
}
