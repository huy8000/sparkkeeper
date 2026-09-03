import type { FastifyInstance } from 'fastify';
import type { HttpConfig } from '../config/HttpConfig.js';
import { loginSchema, logoutSchema } from '../schemas/authContracts.js';
import { success } from '../serializers/envelope.js';
import type { ApiServices } from '../services/ApiServices.js';

export function registerAuthRoutes(
  server: FastifyInstance,
  services: ApiServices,
  config: HttpConfig,
): void {
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
        services.sessions.logout(token, now);
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
