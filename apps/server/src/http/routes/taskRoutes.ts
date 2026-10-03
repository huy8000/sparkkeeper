import type { FastifyInstance } from 'fastify';
import { TaskError, TestSendError } from '@sparkkeeper/database';
import type { TaskConfiguration } from '@sparkkeeper/shared';
import type { SendTaskScheduler } from '../../scheduling/SendTaskScheduler.js';
import { ApiError } from '../errors/ApiError.js';
import { success } from '../serializers/envelope.js';
const uuid = { type: 'string', format: 'uuid' };
const properties = {
  name: { type: 'string', minLength: 1, maxLength: 120 },
  accountId: uuid,
  templateId: uuid,
  contactIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: uuid },
  schedule: {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'startTime', 'endTime', 'timezone', 'maxAttempts', 'retryIntervalSeconds'],
    properties: {
      type: { type: 'string', const: 'DAILY_WINDOW' },
      startTime: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
      endTime: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
      timezone: { type: 'string', minLength: 1, maxLength: 100 },
      maxAttempts: { type: 'integer', minimum: 1, maximum: 5 },
      retryIntervalSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
    },
  },
};
const expected = { type: 'string', format: 'date-time' };
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['taskId'],
  properties: { taskId: uuid },
};
function safe<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof TaskError || error instanceof TestSendError)
      throw new ApiError(
        error.code === 'TASK_NOT_FOUND'
          ? 404
          : error.code === 'RELEASE_GATE_CLOSED'
            ? 503
            : error.code === 'VALIDATION_ERROR'
              ? 400
              : error.code === 'TARGET_NOT_ELIGIBLE'
                ? 422
                : 409,
        error.code,
        'Task operation rejected.',
      );
    throw error;
  }
}
export function registerTaskRoutes(server: FastifyInstance, scheduler: SendTaskScheduler) {
  server.get<{
    Querystring: { accountId?: string; enabled?: boolean; offset?: number; limit?: number };
  }>(
    '/api/tasks',
    {
      config: { auth: 'S' },
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            accountId: uuid,
            enabled: { type: 'boolean' },
            offset: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    async (req) =>
      success(
        safe(() => ({
          items: scheduler.repository.tasks.list(req.query, scheduler.released()),
          masterOpen: scheduler.masterOpen(),
          released: scheduler.released(),
        })),
      ),
  );
  server.get<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId',
    { config: { auth: 'S' }, schema: { params } },
    async (req) =>
      success(
        safe(() => scheduler.repository.tasks.detail(req.params.taskId, scheduler.released())),
      ),
  );
  server.post<{ Body: TaskConfiguration }>(
    '/api/tasks',
    {
      config: { auth: 'M' },
      bodyLimit: 32768,
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(properties),
          properties,
        },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(success(safe(() => scheduler.create(req.body, req.authContext!.adminUserId)))),
  );
  server.patch<{
    Params: { taskId: string };
    Body: TaskConfiguration & { expectedUpdatedAt: string };
  }>(
    '/api/tasks/:taskId',
    {
      config: { auth: 'M' },
      bodyLimit: 32768,
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: [...Object.keys(properties), 'expectedUpdatedAt'],
          properties: { ...properties, expectedUpdatedAt: expected },
        },
      },
    },
    async (req) => {
      const { expectedUpdatedAt, ...input } = req.body;
      return success(
        safe(() =>
          scheduler.repository.tasks.mutate(
            req.params.taskId,
            expectedUpdatedAt,
            req.authContext!.adminUserId,
            'patch',
            input,
            scheduler.released(),
          ),
        ),
      );
    },
  );
  for (const operation of ['enable', 'disable', 'archive'] as const)
    server.post<{
      Params: { taskId: string };
      Body: { expectedUpdatedAt: string; acknowledgeOverlaps?: true; confirmationText?: 'ARCHIVE' };
    }>(
      `/api/tasks/:taskId/${operation}`,
      {
        config: { auth: operation === 'disable' ? 'M' : 'R' },
        schema: {
          params,
          body: {
            type: 'object',
            additionalProperties: false,
            required: [
              'expectedUpdatedAt',
              ...(operation === 'enable'
                ? ['acknowledgeOverlaps']
                : operation === 'archive'
                  ? ['confirmationText']
                  : []),
            ],
            properties: {
              expectedUpdatedAt: expected,
              ...(operation === 'enable'
                ? { acknowledgeOverlaps: { type: 'boolean', const: true } }
                : operation === 'archive'
                  ? { confirmationText: { type: 'string', const: 'ARCHIVE' } }
                  : {}),
            },
          },
        },
      },
      async (req) =>
        success(
          safe(() =>
            operation === 'enable'
              ? scheduler.enable(
                  req.params.taskId,
                  req.body.expectedUpdatedAt,
                  req.authContext!.adminUserId,
                )
              : scheduler.repository.tasks.mutate(
                  req.params.taskId,
                  req.body.expectedUpdatedAt,
                  req.authContext!.adminUserId,
                  operation,
                  undefined,
                  scheduler.released(),
                ),
          ),
        ),
    );
  server.get<{ Params: { runId: string } }>(
    '/api/scheduled-runs/:runId',
    {
      config: { auth: 'S' },
      schema: {
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['runId'],
          properties: { runId: uuid },
        },
      },
    },
    async (req) => success(safe(() => scheduler.repository.detail(req.params.runId))),
  );
}
