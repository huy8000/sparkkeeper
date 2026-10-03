import { createHash } from 'node:crypto';
import { ContactDiscoveryError, type ContactListOptions } from '@sparkkeeper/database';
import {
  CONTACT_TYPES,
  CONTACT_AVAILABILITY_STATUSES,
  CONTACT_IDENTITY_STATUSES,
} from '@sparkkeeper/shared';
import type { FastifyInstance } from 'fastify';
import {
  ContactDiscoveryManager,
  DiscoveryManagerError,
} from '../../contacts/ContactDiscoveryManager.js';
import type { AvatarCacheStore } from '../../contacts/AvatarCacheStore.js';
import { uuid } from '../../contacts/ContactDiscoveryWorkerProtocol.js';
import { ApiError } from '../errors/ApiError.js';
import { success } from '../serializers/envelope.js';
import {
  serializeContact,
  serializeContactSync,
  serializeMaskedIdentity,
} from '../serializers/contacts.js';
const params = (name: string) => ({
  type: 'object',
  additionalProperties: false,
  required: [name],
  properties: { [name]: { type: 'string', format: 'uuid' } },
});
export function registerContactRoutes(
  server: FastifyInstance,
  manager: ContactDiscoveryManager,
  avatars: AvatarCacheStore,
  clock: () => Date = () => new Date(),
) {
  const repo = manager.repository;
  server.post<{ Params: { accountId: string } }>(
    '/api/accounts/:accountId/contact-syncs',
    {
      config: { auth: 'M' },
      bodyLimit: 1024,
      schema: {
        params: params('accountId'),
        body: { type: 'object', additionalProperties: false, maxProperties: 0 },
      },
    },
    async (request, reply) => {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[\x20-\x7e]{1,128}$/u.test(key) || key.trim() !== key)
        throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid idempotency key.');
      try {
        const run = manager.start(request.params.accountId, request.authContext!.adminUserId, key);
        return reply.code(202).send(success({ syncRunId: run.id, status: run.status }));
      } catch (e) {
        if (e instanceof ContactDiscoveryError) {
          const status =
            e.code === 'ACCOUNT_NOT_FOUND'
              ? 404
              : e.code === 'ACCOUNT_NOT_READY'
                ? 422
                : e.code === 'VALIDATION_ERROR'
                  ? 400
                  : 409;
          throw new ApiError(status, e.code, 'Contact sync could not be admitted.');
        }
        if (e instanceof DiscoveryManagerError)
          throw new ApiError(
            e.code === 'PROFILE_BUSY' ? 409 : 503,
            e.code,
            'Contact sync runtime unavailable.',
          );
        throw e;
      }
    },
  );
  server.get<{ Params: { syncRunId: string } }>(
    '/api/contact-syncs/:syncRunId',
    { config: { auth: 'S' }, schema: { params: params('syncRunId') } },
    async (request) => {
      const run = repo.find(request.params.syncRunId);
      if (!run || !repo.account(run.accountId))
        throw new ApiError(404, 'CONTACT_SYNC_NOT_FOUND', 'Contact sync was not found.');
      return success(serializeContactSync(run));
    },
  );
  server.get<{
    Params: { accountId: string };
    Querystring: {
      limit?: number;
      cursor?: string;
      query?: string;
      type?: ContactListOptions['type'];
      availability?: ContactListOptions['availability'];
      identityStatus?: ContactListOptions['identityStatus'];
    };
  }>(
    '/api/accounts/:accountId/contacts',
    {
      config: { auth: 'S' },
      schema: {
        params: params('accountId'),
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 200 },
            cursor: { type: 'string', maxLength: 1024 },
            query: { type: 'string', maxLength: 100 },
            type: { type: 'string', enum: [...CONTACT_TYPES] },
            availability: { type: 'string', enum: [...CONTACT_AVAILABILITY_STATUSES] },
            identityStatus: { type: 'string', enum: [...CONTACT_IDENTITY_STATUSES] },
          },
        },
      },
    },
    async (request) => {
      if (!repo.account(request.params.accountId))
        throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
      const q = request.query;
      const limit = q.limit ?? 50;
      const filterHash = createHash('sha256')
        .update(
          JSON.stringify([
            request.params.accountId,
            q.query ?? '',
            q.type ?? '',
            q.availability ?? '',
            q.identityStatus ?? '',
          ]),
        )
        .digest('hex');
      let after: ContactListOptions['after'];
      if (q.cursor) {
        try {
          if (!/^[A-Za-z0-9_-]+$/u.test(q.cursor)) throw new Error();
          const c = JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')) as {
            scope: unknown;
            createdAt: unknown;
            id: unknown;
          };
          if (
            Object.keys(c).length !== 3 ||
            c.scope !== filterHash ||
            !Number.isSafeInteger(c.createdAt) ||
            (c.createdAt as number) < 0 ||
            !uuid(c.id)
          )
            throw new Error();
          after = { createdAt: c.createdAt as number, id: c.id };
        } catch {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid contact cursor.');
        }
      }
      const rows = repo.list(request.params.accountId, {
        limit,
        ...(q.query === undefined ? {} : { query: q.query }),
        ...(q.type === undefined ? {} : { type: q.type }),
        ...(q.availability === undefined ? {} : { availability: q.availability }),
        ...(q.identityStatus === undefined ? {} : { identityStatus: q.identityStatus }),
        ...(after ? { after } : {}),
      });
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      const nextCursor =
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                scope: filterHash,
                createdAt: last.createdAt.getTime(),
                id: last.id,
              }),
            ).toString('base64url')
          : null;
      const latest = repo.latest(request.params.accountId);
      return success({
        items: items.map((c) => serializeContact(c, clock())),
        nextCursor,
        latestSync: latest ? serializeContactSync(latest) : null,
      });
    },
  );
  server.get<{ Params: { contactId: string } }>(
    '/api/contacts/:contactId',
    { config: { auth: 'S' }, schema: { params: params('contactId') } },
    async (request) => {
      const row = repo.contact(request.params.contactId);
      if (!row) throw new ApiError(404, 'CONTACT_NOT_FOUND', 'Contact was not found.');
      const identityReady =
        ['PERSON', 'GROUP'].includes(row.type) && row.identityStatus === 'READY';
      return success({
        ...serializeContact(row, clock()),
        identities: repo.identities(row.id).map(serializeMaskedIdentity),
        identityReady,
        discoveryEligibilityReason: !['PERSON', 'GROUP'].includes(row.type)
          ? 'UNSUPPORTED_TYPE'
          : row.identityStatus !== 'READY'
            ? 'IDENTITY_REVIEW_REQUIRED'
            : row.availabilityStatus !== 'AVAILABLE'
              ? 'CONTACT_UNAVAILABLE'
              : 'IDENTITY_READY',
      });
    },
  );
  server.get<{ Params: { assetId: string } }>(
    '/api/avatar-assets/:assetId',
    { config: { auth: 'S' }, schema: { params: params('assetId') } },
    async (request, reply) => {
      const asset = avatars.read(request.params.assetId, clock());
      if (!asset) throw new ApiError(404, 'AVATAR_NOT_FOUND', 'Avatar was not found.');
      return reply
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .type(asset.mime)
        .send(asset.bytes);
    },
  );
}
