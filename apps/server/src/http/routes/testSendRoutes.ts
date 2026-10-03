import type { FastifyInstance } from 'fastify';
import { TestSendError } from '@sparkkeeper/database';
import { TestSendManager, TestSendManagerError } from '../../test-send/TestSendManager.js';
import { ApiError } from '../errors/ApiError.js';
import { success } from '../serializers/envelope.js';
const uuid = { type: 'string', format: 'uuid' };
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['accountId'],
  properties: { accountId: uuid },
};
function key(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x20-\x7e]{1,128}$/u.test(value) || value.trim() !== value)
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid idempotency key.');
  return value;
}
async function safe<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TestSendError)
      throw new ApiError(
        e.code === 'INTENT_NOT_FOUND'
          ? 404
          : e.code === 'VALIDATION_ERROR'
            ? 400
            : e.code === 'TARGET_NOT_ELIGIBLE'
              ? 422
              : 409,
        e.code,
        'Test Send could not be admitted.',
      );
    if (e instanceof TestSendManagerError)
      throw new ApiError(
        e.code === 'PROFILE_BUSY' ? 409 : 503,
        e.code,
        'Test Send runtime unavailable.',
      );
    throw e;
  }
}
export function registerTestSendRoutes(server: FastifyInstance, manager: TestSendManager) {
  server.post<{
    Params: { accountId: string };
    Body: { templateId: string; contactIds: [string] };
  }>(
    '/api/accounts/:accountId/test-send-intents',
    {
      config: { auth: 'M' },
      bodyLimit: 2048,
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['templateId', 'contactIds'],
          properties: {
            templateId: uuid,
            contactIds: { type: 'array', minItems: 1, maxItems: 1, items: uuid },
          },
        },
      },
    },
    async (request, reply) => {
      const digestKey = key(request.headers['idempotency-key']);
      return reply
        .code(201)
        .send(
          success(
            await safe(() =>
              manager.preview(
                request.params.accountId,
                request.body.contactIds[0],
                request.body.templateId,
                request.authContext!.adminUserId,
                digestKey,
              ),
            ),
          ),
        );
    },
  );
  server.post<{
    Params: { accountId: string };
    Body: { intentId: string; confirm: true; payloadDigest: string };
  }>(
    '/api/accounts/:accountId/test-sends',
    {
      config: { auth: 'R' },
      bodyLimit: 2048,
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['intentId', 'confirm', 'payloadDigest'],
          properties: {
            intentId: uuid,
            confirm: { type: 'boolean', const: true },
            payloadDigest: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          },
        },
      },
    },
    async (request, reply) => {
      const digestKey = key(request.headers['idempotency-key']);
      return reply
        .code(202)
        .send(
          success(
            await safe(() =>
              manager.confirm(
                request.params.accountId,
                request.authContext!.adminUserId,
                request.body.intentId,
                request.body.payloadDigest,
                digestKey,
              ),
            ),
          ),
        );
    },
  );
  server.get<{ Params: { runId: string } }>(
    '/api/test-sends/:runId',
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
    async (request) => {
      const detail = manager.repository.detail(request.params.runId);
      if (!detail) throw new ApiError(404, 'TEST_SEND_NOT_FOUND', 'Test Send was not found.');
      return success(detail);
    },
  );
}
