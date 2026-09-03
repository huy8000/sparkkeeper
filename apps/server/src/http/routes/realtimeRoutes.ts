import type { ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

import type { HttpConfig } from '../config/HttpConfig.js';
import type { AdminSessionService } from '../../security/AdminSessionService.js';
import type { RealtimeEvent, RealtimeEventSource } from '../../realtime/RealtimeEvent.js';

export const DEFAULT_SSE_HEARTBEAT_MS = 20_000;
export const DEFAULT_SSE_RETRY_MS = 3_000;
export const DEFAULT_SSE_SESSION_REVALIDATE_MS = 60_000; // 60 seconds

/** Registration options supplied by composition; session/config are added by createServer. */
export interface RealtimeRouteRegistrationOptions {
  readonly events: RealtimeEventSource;
  readonly clock?: (() => Date) | undefined;
  readonly heartbeatMs?: number | undefined;
  readonly retryMs?: number | undefined;
  /** Interval between continuous session revalidation passes (timing config only). */
  readonly sessionRevalidateMs?: number | undefined;
}

/** Full options required to actually register the SSE route. */
export interface RealtimeRouteOptions {
  readonly events: RealtimeEventSource;
  /** Mandatory: continuous session revalidation cannot be disabled. */
  readonly sessionService: AdminSessionService;
  /** Mandatory: cookie name and security attributes come from the canonical HTTP config. */
  readonly config: HttpConfig;
  readonly clock?: (() => Date) | undefined;
  readonly heartbeatMs?: number | undefined;
  readonly retryMs?: number | undefined;
  readonly sessionRevalidateMs?: number | undefined;
}

/**
 * Internal deterministic seam: controls only WHEN periodic session revalidation
 * fires. It can never decide the authentication outcome; the real
 * AdminSessionService/repository always decides validity. This type is
 * deliberately NOT exported from production composition: createServer and
 * ApiApplication expose no revalidation trigger, so a production consumer can
 * neither trigger nor replace auth timing. Only the internal test-composition
 * factory below may capture it.
 */
interface SseRevalidationSeam {
  /** Runs one revalidation pass for every active stream. */
  readonly triggerRevalidation: () => void;
  /** Number of currently active streams with a scheduled revalidation loop. */
  readonly activeRevalidationLoops: () => number;
}

interface ActiveStream {
  /** Re-runs real session validation for this stream; closes the stream on any non-VALID outcome. */
  readonly revalidate: () => void;
  readonly close: () => void;
}

/**
 * Production registration. Returns void: no revalidation seam is surfaced.
 */
export function registerRealtimeRoutes(
  server: FastifyInstance,
  options: RealtimeRouteOptions,
): void {
  registerRealtimeRoutesInternal(server, options);
}

/**
 * Internal composition factory (NOT exported from any production surface; used
 * only by the test module through this explicit internal boundary) that also
 * exposes the deterministic revalidation timing seam. The timing seam may only
 * control WHEN the revalidation callback runs; the real session service always
 * decides validity.
 */
export function registerRealtimeRoutesInternal(
  server: FastifyInstance,
  options: RealtimeRouteOptions,
): { seam: SseRevalidationSeam } {
  const heartbeatMs = positiveInteger(options.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS, 'heartbeat');
  const retryMs = positiveInteger(options.retryMs ?? DEFAULT_SSE_RETRY_MS, 'retry');
  const sessionRevalidateMs = positiveInteger(
    options.sessionRevalidateMs ?? DEFAULT_SSE_SESSION_REVALIDATE_MS,
    'sessionRevalidate',
  );
  const clock = options.clock ?? (() => new Date());
  const connections = new Set<() => void>();
  const activeStreams = new Set<ActiveStream>();

  server.addHook('preClose', async () => {
    for (const close of [...connections]) close();
    connections.clear();
  });

  const seam: SseRevalidationSeam = {
    triggerRevalidation: () => {
      for (const stream of [...activeStreams]) {
        stream.revalidate();
      }
    },
    activeRevalidationLoops: () => activeStreams.size,
  };

  server.get(
    '/api/events/stream',
    {
      config: { auth: 'S' },
    },
    async (request, reply) => {
      // The Class S guard already validated the cookie against the real session
      // service; the raw token is re-read only to allow continuous revalidation.
      const token = request.cookies[options.config.cookie.name];
      if (typeof token !== 'string' || token.length === 0) {
        // Unreachable through production registration: the guard rejects first.
        throw new Error('SSE stream requires a session token.');
      }

      reply.hijack();
      const response = reply.raw;
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();

      let active = true;
      let heartbeat: NodeJS.Timeout | undefined;
      let revalidationTimer: NodeJS.Timeout | undefined;
      let unsubscribe = (): void => undefined;

      const stream: ActiveStream = {
        revalidate: () => {
          if (!active) return;
          try {
            const val = options.sessionService.validateSession(token, clock());
            if (val.outcome !== 'VALID') {
              close();
            }
          } catch {
            // Validation infrastructure failure closes the stream fail-closed.
            close();
          }
        },
        close: () => {
          if (!active) return;
          active = false;
          if (heartbeat !== undefined) clearInterval(heartbeat);
          heartbeat = undefined;
          if (revalidationTimer !== undefined) clearTimeout(revalidationTimer);
          revalidationTimer = undefined;
          unsubscribe();
          activeStreams.delete(stream);
          connections.delete(close);
          response.removeListener('close', close);
          if (!response.writableEnded) response.end();
        },
      };

      const close = (): void => stream.close();

      connections.add(close);
      response.once('close', close);

      const write = (chunk: string): void => {
        if (!active || response.writableEnded || response.destroyed) return;
        try {
          if (!response.write(chunk)) closeSlowConnection(response, close);
        } catch {
          close();
        }
      };

      unsubscribe = options.events.subscribe((event) => {
        if (!active) return;
        write(formatSseEvent(event));
      });

      activeStreams.add(stream);

      write(`retry: ${retryMs}\n${formatSseEvent(options.events.createReadyEvent())}`);
      if (!active) return;

      heartbeat = setInterval(() => write(': heartbeat\n\n'), heartbeatMs);
      heartbeat.unref();

      // Continuous session revalidation loop. The scheduling interval is the only
      // seam; the real AdminSessionService always decides validity.
      const scheduleRevalidation = (): void => {
        if (!active) return;
        revalidationTimer = setTimeout(() => {
          if (!active) return;
          stream.revalidate();
          scheduleRevalidation();
        }, sessionRevalidateMs);
        revalidationTimer.unref();
      };
      scheduleRevalidation();
    },
  );

  return { seam };
}

export function formatSseEvent(event: RealtimeEvent): string {
  const name =
    event.type === 'READY'
      ? 'ready'
      : event.type === 'RUNTIME_EVENT'
        ? 'runtime'
        : 'config-changed';
  return `id: ${event.id}\nevent: ${name}\ndata: ${JSON.stringify(event)}\n\n`;
}

function closeSlowConnection(response: ServerResponse, close: () => void): void {
  close();
  if (!response.destroyed) response.destroy();
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Realtime SSE ${name} interval must be a positive integer.`);
  }
  return value;
}
