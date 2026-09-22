import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AccountOnboardingSession } from '@sparkkeeper/database';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import WebSocket, { type RawData } from 'ws';

import type { HttpConfig } from '../http/config/HttpConfig.js';
import { ApiError } from '../http/errors/ApiError.js';
import { assertSameOriginRequest } from '../http/plugins/AdminAuthGuards.js';
import type { AdminSessionService } from '../security/AdminSessionService.js';
import type { AccountLoginWorkerSupervisor } from './AccountLoginWorkerSupervisor.js';
import type { LoopbackConsoleEndpoint } from './AccountLoginWorkerProtocol.js';

const CONSOLE_REVALIDATE_MS = 5_000;
const RFB_ROOT = path.dirname(fileURLToPath(import.meta.resolve('@novnc/novnc')));
const NOVNC_PACKAGE_ROOT = path.dirname(RFB_ROOT);
const ASSET_ROOTS = new Map([
  ['core', RFB_ROOT],
  ['vendor', path.join(NOVNC_PACKAGE_ROOT, 'vendor')],
]);

export interface ConsoleSessionSource {
  findByIdForAdmin(sessionId: string, adminUserId: string): AccountOnboardingSession | undefined;
}

export interface ConsoleRouteOptions {
  readonly config: HttpConfig;
  readonly sessions: AdminSessionService;
  readonly loginSessions: ConsoleSessionSource;
  readonly supervisor: Pick<AccountLoginWorkerSupervisor, 'owns' | 'getConsoleEndpoint'>;
  readonly leaseOwner: { ownsRuntimeLease(sessionId: string): boolean };
  readonly connections?: AccountConsoleConnections;
  readonly clock?: (() => Date) | undefined;
}

interface ConsoleParams {
  readonly sessionId: string;
  readonly '*': string;
}

interface ConsoleAccess {
  readonly endpoint: LoopbackConsoleEndpoint;
}

export function registerAuthenticatedConsoleRoutes(
  server: FastifyInstance,
  options: ConsoleRouteOptions,
): void {
  const connections = options.connections ?? new AccountConsoleConnections();
  const clock = options.clock ?? (() => new Date());

  server.get<{ Params: Pick<ConsoleParams, 'sessionId'> }>(
    '/api/account-login-sessions/:sessionId/console',
    { config: { auth: 'S' } },
    async (request, reply) => {
      assertConsoleDocumentRequest(request, options.config);
      authorizeConsole(request, options, clock());
      applyPrivateConsoleHeaders(reply);
      return reply.type('text/html; charset=utf-8').send(renderConsoleShell());
    },
  );

  server.get<{ Params: ConsoleParams }>(
    '/api/account-login-sessions/:sessionId/console/assets/*',
    { config: { auth: 'S' } },
    async (request, reply) => {
      assertConsoleDocumentRequest(request, options.config);
      authorizeConsole(request, options, clock());
      if (request.params['*'] === 'bootstrap.js') {
        applyPrivateConsoleHeaders(reply);
        return reply.type('text/javascript; charset=utf-8').send(CONSOLE_BOOTSTRAP);
      }
      const asset = resolveNoVncAsset(request.params['*']);
      if (asset === undefined) throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route was not found.');
      applyPrivateConsoleHeaders(reply);
      return reply.type('text/javascript; charset=utf-8').send(await readFile(asset, 'utf8'));
    },
  );

  server.get<{ Params: Pick<ConsoleParams, 'sessionId'> }>(
    '/api/account-login-sessions/:sessionId/console/ws',
    { config: { auth: 'S' }, websocket: true },
    (socket, request) => {
      let access: ConsoleAccess;
      try {
        assertSameOriginRequest(request, options.config);
        assertWebSocketProtocol(request);
        access = authorizeConsole(request, options, clock());
      } catch {
        socket.close(1008, 'Console access denied.');
        return;
      }

      const sessionId = request.params.sessionId;
      connections.replace(sessionId, socket);
      const upstream = new WebSocket(
        `ws://${access.endpoint.host}:${access.endpoint.port}`,
        'binary',
      );
      const rawSessionToken = request.cookies[options.config.cookie.name];
      const pending: Array<{ data: Buffer; isBinary: boolean }> = [];
      let pendingBytes = 0;

      socket.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        } else if (upstream.readyState === WebSocket.CONNECTING) {
          const buffered = Array.isArray(data)
            ? Buffer.concat(data)
            : data instanceof ArrayBuffer
              ? Buffer.from(data)
              : Buffer.from(data);
          pendingBytes += buffered.length;
          if (pendingBytes > 1_048_576) {
            socket.close(1009, 'Console frame backlog exceeded.');
          } else {
            pending.push({ data: buffered, isBinary });
          }
        }
      });
      upstream.once('open', () => {
        for (const frame of pending) upstream.send(frame.data, { binary: frame.isBinary });
        pending.length = 0;
        pendingBytes = 0;
      });
      upstream.on('message', (data: RawData, isBinary: boolean) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary: isBinary });
      });
      upstream.once('error', () => socket.close(1011, 'Console unavailable.'));
      upstream.once('close', () => socket.close(1000));

      const revalidate = setInterval(() => {
        try {
          const admin = options.sessions.validateSession(rawSessionToken, clock());
          if (admin.outcome !== 'VALID') throw new Error('Admin session invalid.');
          const latest = authorizeConsoleForAdmin(sessionId, admin.adminUser.id, options, clock());
          if (
            latest.endpoint.host !== access.endpoint.host ||
            latest.endpoint.port !== access.endpoint.port
          ) {
            throw new Error('Console lease changed.');
          }
        } catch {
          socket.close(1008, 'Console access expired.');
        }
      }, CONSOLE_REVALIDATE_MS);
      revalidate.unref();

      socket.once('close', () => {
        clearInterval(revalidate);
        connections.remove(sessionId, socket);
        upstream.close();
      });
    },
  );
}

function authorizeConsole(
  request: FastifyRequest<{ Params: Pick<ConsoleParams, 'sessionId'> }>,
  options: ConsoleRouteOptions,
  now: Date,
): ConsoleAccess {
  const adminUserId = request.authContext?.adminUserId;
  if (adminUserId === undefined)
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required.');
  return authorizeConsoleForAdmin(request.params.sessionId, adminUserId, options, now);
}

function authorizeConsoleForAdmin(
  sessionId: string,
  adminUserId: string,
  options: ConsoleRouteOptions,
  now: Date,
): ConsoleAccess {
  const session = options.loginSessions.findByIdForAdmin(sessionId, adminUserId);
  const endpoint = options.supervisor.getConsoleEndpoint(sessionId);
  if (
    session === undefined ||
    (session.status !== 'STARTING' && session.status !== 'AWAITING_USER') ||
    now.getTime() >= session.expiresAt.getTime() ||
    !options.supervisor.owns(sessionId) ||
    !options.leaseOwner.ownsRuntimeLease(sessionId) ||
    endpoint === undefined
  ) {
    throw new ApiError(404, 'LOGIN_SESSION_NOT_FOUND', 'Console is not available.');
  }
  return { endpoint };
}

export class AccountConsoleConnections {
  private readonly sockets = new Map<string, WebSocket>();

  replace(sessionId: string, socket: WebSocket): void {
    this.close(sessionId, 1000, 'Console replaced.');
    this.sockets.set(sessionId, socket);
  }

  remove(sessionId: string, socket: WebSocket): void {
    if (this.sockets.get(sessionId) === socket) this.sockets.delete(sessionId);
  }

  close(sessionId: string, code = 1008, reason = 'Console session closed.'): void {
    const socket = this.sockets.get(sessionId);
    if (socket === undefined) return;
    this.sockets.delete(sessionId);
    socket.close(code, reason);
  }

  closeAll(): void {
    for (const sessionId of this.sockets.keys()) this.close(sessionId);
  }
}

function assertWebSocketProtocol(request: FastifyRequest): void {
  const protocols = request.headers['sec-websocket-protocol']
    ?.split(',')
    .map((value) => value.trim());
  if (!protocols?.includes('binary')) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Console WebSocket protocol is invalid.');
  }
}

/** Browsers omit Origin on same-origin GET navigation and module fetches. */
function assertConsoleDocumentRequest(request: FastifyRequest, config: HttpConfig): void {
  if (
    request.headers.host?.toLowerCase() !== config.canonicalAuthority.toLowerCase() ||
    `${request.protocol}:` !== config.canonicalProtocol ||
    request.headers['sec-fetch-site'] !== 'same-origin' ||
    (request.headers.origin !== undefined && request.headers.origin !== config.canonicalOrigin)
  ) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Console request origin was rejected.');
  }
}

function resolveNoVncAsset(rawAsset: string): string | undefined {
  if (!/^(?:core|vendor)\/[A-Za-z0-9_./-]+\.js$/u.test(rawAsset)) return undefined;
  const separator = rawAsset.indexOf('/');
  const namespace = rawAsset.slice(0, separator);
  const relative = rawAsset.slice(separator + 1);
  const root = ASSET_ROOTS.get(namespace);
  if (root === undefined) return undefined;
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(`${path.resolve(root)}${path.sep}`) ? resolved : undefined;
}

function renderConsoleShell(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account Login</title><style>html,body,#screen{width:100%;height:100%;margin:0;background:#202124;overflow:hidden}</style></head><body><main id="screen" aria-label="Douyin login console"></main><script type="module" src="./console/assets/bootstrap.js"></script></body></html>`;
}

const CONSOLE_BOOTSTRAP = `import RFB from './core/rfb.js';const scheme=location.protocol==='https:'?'wss':'ws';const rfb=new RFB(document.getElementById('screen'),scheme+'://'+location.host+location.pathname+'/ws',{wsProtocols:['binary'],shared:true});rfb.scaleViewport=true;rfb.resizeSession=false;`;

function applyPrivateConsoleHeaders(reply: { header(name: string, value: string): unknown }): void {
  reply.header('Cache-Control', 'no-store');
  reply.header(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Content-Type-Options', 'nosniff');
}
