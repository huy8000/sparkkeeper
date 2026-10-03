import type { FastifyInstance } from 'fastify';
import type { HttpConfig } from '../config/HttpConfig.js';
import { loginSchema, logoutSchema } from '../schemas/authContracts.js';
import { success } from '../serializers/envelope.js';
import type { ApiServices } from '../services/ApiServices.js';
import { setClearingCookie } from '../plugins/AdminAuthGuards.js';

export function registerAuthRoutes(
  server: FastifyInstance,
  services: ApiServices,
  config: HttpConfig,
  onAdminSessionInvalidated?: () => void,
): void {
  const security = services.security;
  if (security) {
    const password = { type: 'string', minLength: 14, maxLength: 1024 };
    server.post<{ Body: { password: string } }>(
      '/api/auth/reauth',
      {
        config: { auth: 'M' },
        bodyLimit: 4096,
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['password'],
            properties: { password },
          },
        },
      },
      async (req, reply) => {
        reply.header('Cache-Control', 'no-store');
        return success(
          await security.reauth(
            req.authContext!.adminUserId,
            req.authContext!.sessionId,
            req.body.password,
            req.ip,
          ),
        );
      },
    );
    server.post<{ Body: { currentPassword: string; newPassword: string } }>(
      '/api/auth/change-password',
      {
        config: { auth: 'R' },
        bodyLimit: 8192,
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['currentPassword', 'newPassword'],
            properties: { currentPassword: password, newPassword: password },
          },
        },
      },
      async (req, reply) => {
        await security.changePassword(
          req.authContext!.adminUserId,
          req.authContext!.sessionId,
          req.body.currentPassword,
          req.body.newPassword,
          req.ip,
        );
        onAdminSessionInvalidated?.();
        setClearingCookie(reply, config);
        return reply.header('Cache-Control', 'no-store').code(204).send();
      },
    );
    server.get('/api/auth/sessions', { config: { auth: 'S' } }, async (req, reply) => {
      reply.header('Cache-Control', 'no-store');
      return success(security.sessions(req.authContext!.adminUserId, req.authContext!.sessionId));
    });
    server.post<{ Params: { sessionId: string }; Body: { expectedSessionVersion: number } }>(
      '/api/auth/sessions/:sessionId/revoke',
      {
        config: { auth: 'R' },
        bodyLimit: 1024,
        schema: {
          params: {
            type: 'object',
            required: ['sessionId'],
            additionalProperties: false,
            properties: { sessionId: { type: 'string', format: 'uuid' } },
          },
          body: {
            type: 'object',
            required: ['expectedSessionVersion'],
            additionalProperties: false,
            properties: { expectedSessionVersion: { type: 'integer', minimum: 1 } },
          },
        },
      },
      async (req, reply) => {
        security.revoke(
          req.authContext!.adminUserId,
          req.authContext!.sessionId,
          req.params.sessionId,
          req.body.expectedSessionVersion,
        );
        onAdminSessionInvalidated?.();
        if (req.params.sessionId === req.authContext!.sessionId) setClearingCookie(reply, config);
        return reply.header('Cache-Control', 'no-store').code(204).send();
      },
    );
  }
  // POST /api/auth/login (Class L)
  server.post(
    '/api/auth/login',
    {
      config: { auth: 'L' },
      bodyLimit: 4096,
      schema: loginSchema,
    },
    async (request, reply) => {
      const { username, password } = request.body as {
        username: unknown;
        password: unknown;
      };

      const currentSessionToken = request.cookies[config.cookie.name];
      const clientIp = request.ip;
      const now = request.requestSampledNow ?? new Date();

      const result = await services.auth.login({
        username,
        password,
        clientIp,
        currentSessionToken,
        now,
      });

      reply.setCookie(config.cookie.name, result.rawSessionToken, {
        secure: config.cookie.secure,
        httpOnly: config.cookie.httpOnly,
        sameSite: config.cookie.sameSite,
        path: config.cookie.path,
        maxAge: config.cookie.maxAge,
        expires: result.absoluteExpiresAt,
      });

      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');

      return reply.code(200).send(
        success({
          admin: result.admin,
          csrfToken: result.rawCsrfToken,
          idleExpiresAt: result.idleExpiresAt.toISOString(),
          absoluteExpiresAt: result.absoluteExpiresAt.toISOString(),
          recentlyReauthenticated: result.recentlyReauthenticated,
        }),
      );
    },
  );

  // GET /api/auth/me (Class S)
  server.get(
    '/api/auth/me',
    {
      config: { auth: 'S' },
    },
    async (request, reply) => {
      const auth = request.authContext!;
      const token = request.cookies[config.cookie.name];
      const csrfToken = token ? services.sessions.rederiveCsrf(token) : null;
      const now = auth.now;
      const reauthenticatedAtMs = auth.reauthenticatedAt?.getTime() ?? 0;
      const recentlyReauthenticated = now.getTime() - reauthenticatedAtMs <= 5 * 60 * 1000;

      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');

      return reply.code(200).send(
        success({
          admin: {
            id: auth.adminUserId,
            username: auth.username,
          },
          csrfToken: csrfToken ?? '',
          idleExpiresAt: auth.idleExpiresAt.toISOString(),
          absoluteExpiresAt: auth.absoluteExpiresAt.toISOString(),
          recentlyReauthenticated,
        }),
      );
    },
  );

  // POST /api/auth/logout (Class M)
  server.post(
    '/api/auth/logout',
    {
      config: { auth: 'M' },
      schema: logoutSchema,
    },
    async (request, reply) => {
      const token = request.cookies[config.cookie.name];
      const now = request.authContext?.now ?? new Date();

      if (token) {
        const result = services.sessions.logout(token, now);
        if (result.outcome === 'SUCCESS') onAdminSessionInvalidated?.();
      }

      reply.setCookie(config.cookie.name, '', {
        secure: config.cookie.secure,
        httpOnly: config.cookie.httpOnly,
        sameSite: config.cookie.sameSite,
        path: config.cookie.path,
        maxAge: 0,
        expires: new Date(0),
      });

      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');

      return reply.code(204).send();
    },
  );
}
