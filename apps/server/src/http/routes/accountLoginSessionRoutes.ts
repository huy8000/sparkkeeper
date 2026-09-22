import type { FastifyInstance } from 'fastify';
import type { AccountLoginSessionSummary } from '@sparkkeeper/shared';

import { AccountOnboardingManager } from '../../onboarding/AccountOnboardingManager.js';
import { ApiError } from '../errors/ApiError.js';
import {
  errorEnvelopeSchema,
  idParamsSchema,
  successEnvelopeSchema,
} from '../schemas/contracts.js';
import { success } from '../serializers/envelope.js';

interface SessionParams {
  readonly sessionId: string;
}

interface StartBody {
  readonly purpose: 'ADD_ACCOUNT' | 'RELOGIN';
  readonly accountId?: string;
}

interface CancelBody {
  readonly expectedUpdatedAt: string;
}

const summarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'purpose',
    'accountId',
    'status',
    'expiresAt',
    'startedAt',
    'readyDetectedAt',
    'completedAt',
    'updatedAt',
    'consoleAvailable',
    'cancellable',
    'failureCode',
    'resultAccountId',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    purpose: { type: 'string', enum: ['ADD_ACCOUNT', 'RELOGIN'] },
    accountId: { type: 'string', format: 'uuid', nullable: true },
    status: {
      type: 'string',
      enum: [
        'PENDING',
        'STARTING',
        'AWAITING_USER',
        'READY_DETECTED',
        'COMPLETING',
        'COMPLETED',
        'EXPIRED',
        'CANCELLED',
        'FAILED',
      ],
    },
    expiresAt: { type: 'string', format: 'date-time' },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    readyDetectedAt: { type: 'string', format: 'date-time', nullable: true },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    updatedAt: { type: 'string', format: 'date-time' },
    consoleAvailable: { type: 'boolean' },
    cancellable: { type: 'boolean' },
    failureCode: { type: 'string', nullable: true },
    resultAccountId: { type: 'string', format: 'uuid', nullable: true },
  },
} as const;

const startBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['purpose'],
  properties: {
    purpose: { type: 'string', enum: ['ADD_ACCOUNT', 'RELOGIN'] },
    accountId: { type: 'string', format: 'uuid' },
  },
} as const;

const cancelBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['expectedUpdatedAt'],
  properties: {
    expectedUpdatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const errors = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  410: errorEnvelopeSchema,
  500: errorEnvelopeSchema,
  503: errorEnvelopeSchema,
} as const;

export function registerAccountLoginSessionRoutes(
  server: FastifyInstance,
  manager: AccountOnboardingManager,
): void {
  server.post<{ Body: StartBody }>(
    '/api/account-login-sessions',
    {
      config: { auth: 'M' },
      bodyLimit: 512,
      schema: {
        body: startBodySchema,
        response: {
          202: successEnvelopeSchema({
            type: 'object',
            additionalProperties: false,
            required: ['session', 'consolePath'],
            properties: {
              session: summarySchema,
              consolePath: { type: 'string' },
            },
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      const adminUserId = requireAdmin(request.authContext?.adminUserId);
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length < 1 || key.length > 128) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'A valid Idempotency-Key header is required.');
      }
      if (
        (request.body.purpose === 'ADD_ACCOUNT' && request.body.accountId !== undefined) ||
        (request.body.purpose === 'RELOGIN' && request.body.accountId === undefined)
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid login-session request.');
      }
      const result = await manager.start({
        purpose: request.body.purpose,
        accountId: request.body.accountId ?? null,
        createdByAdminUserId: adminUserId,
        idempotencyKey: key,
        ...(request.authContext?.now === undefined ? {} : { now: request.authContext.now }),
      });
      if (result.outcome === 'RELEASE_GATE_CLOSED') {
        throw new ApiError(503, 'RELEASE_GATE_CLOSED', 'Account login release gate is closed.');
      }
      if (result.outcome === 'ACTIVE_CONFLICT') {
        throw new ApiError(409, 'LOGIN_SESSION_ACTIVE', 'A login flow is already active.');
      }
      if (result.outcome === 'IDEMPOTENCY_CONFLICT') {
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key conflicts with an earlier request.',
        );
      }
      if (result.outcome === 'ACCOUNT_NOT_FOUND') {
        throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
      }
      if (result.outcome === 'ACCOUNT_STATE_CONFLICT') {
        throw new ApiError(409, 'STATE_CONFLICT', 'Account is not ready for relogin.');
      }
      if (!('session' in result)) {
        throw new ApiError(503, 'RUNTIME_UNAVAILABLE', 'Account login is unavailable.');
      }
      const summary = result.summary ?? manager.summary(result.session);
      reply.header('Cache-Control', 'no-store');
      return reply.code(202).send(
        success({
          session: summary,
          consolePath: `/api/account-login-sessions/${encodeURIComponent(summary.id)}/console`,
        }),
      );
    },
  );

  server.get(
    '/api/account-login-sessions/active',
    {
      config: { auth: 'S' },
      schema: {
        response: {
          200: successEnvelopeSchema({
            type: 'object',
            additionalProperties: false,
            required: ['session'],
            properties: { session: { ...summarySchema, nullable: true } },
          }),
          ...errors,
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return success({
        session: manager.getActiveForAdmin(requireAdmin(request.authContext?.adminUserId)),
      });
    },
  );

  server.get<{ Params: SessionParams }>(
    '/api/account-login-sessions/:sessionId',
    {
      config: { auth: 'S' },
      schema: {
        params: idParamsSchema('sessionId'),
        response: { 200: successEnvelopeSchema(summarySchema), ...errors },
      },
    },
    async (request, reply) => {
      const summary = manager.getForAdmin(
        request.params.sessionId,
        requireAdmin(request.authContext?.adminUserId),
      );
      if (summary === undefined) {
        throw new ApiError(404, 'LOGIN_SESSION_NOT_FOUND', 'Login session was not found.');
      }
      reply.header('Cache-Control', 'no-store');
      return success(summary);
    },
  );

  server.post<{ Params: SessionParams; Body: CancelBody }>(
    '/api/account-login-sessions/:sessionId/cancel',
    {
      config: { auth: 'M' },
      bodyLimit: 256,
      schema: {
        params: idParamsSchema('sessionId'),
        body: cancelBodySchema,
        response: { 200: successEnvelopeSchema(summarySchema), ...errors },
      },
    },
    async (request, reply) => {
      const expected = new Date(request.body.expectedUpdatedAt);
      if (
        !Number.isFinite(expected.getTime()) ||
        expected.toISOString() !== request.body.expectedUpdatedAt
      ) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid expectedUpdatedAt timestamp.');
      }
      const result = await manager.cancel(
        request.params.sessionId,
        requireAdmin(request.authContext?.adminUserId),
        expected,
      );
      if (result.outcome === 'NOT_FOUND') {
        throw new ApiError(404, 'LOGIN_SESSION_NOT_FOUND', 'Login session was not found.');
      }
      if (result.outcome === 'STATE_CONFLICT') {
        throw new ApiError(409, 'STATE_CONFLICT', 'Login session can no longer be cancelled.');
      }
      if (result.outcome === 'VERSION_CONFLICT') {
        throw new ApiError(409, 'VERSION_CONFLICT', 'Login session changed before cancellation.');
      }
      if (!('session' in result)) {
        throw new ApiError(409, 'STATE_CONFLICT', 'Login session can no longer be cancelled.');
      }
      reply.header('Cache-Control', 'no-store');
      return success(manager.summary(result.session) satisfies AccountLoginSessionSummary);
    },
  );
}

function requireAdmin(adminUserId: string | undefined): string {
  if (adminUserId === undefined) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }
  return adminUserId;
}
