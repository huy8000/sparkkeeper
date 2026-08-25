import type { ServerResponse } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { ApiError } from '../errors/ApiError.js';
import { isAllowedLocalRequest, type MutationGuardOptions } from '../plugins/MutationGuard.js';
import type { RealtimeEvent, RealtimeEventSource } from '../../realtime/RealtimeEvent.js';

export const DEFAULT_SSE_HEARTBEAT_MS = 20_000;
export const DEFAULT_SSE_RETRY_MS = 3_000;

export interface RealtimeRouteOptions {
  readonly events: RealtimeEventSource;
  readonly access: MutationGuardOptions;
  readonly heartbeatMs?: number;
  readonly retryMs?: number;
}

export function registerRealtimeRoutes(
  server: FastifyInstance,
  options: RealtimeRouteOptions,
): void {
  const heartbeatMs = positiveInteger(options.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS, 'heartbeat');
  const retryMs = positiveInteger(options.retryMs ?? DEFAULT_SSE_RETRY_MS, 'retry');
  const connections = new Set<() => void>();

  server.addHook('preClose', async () => {
    for (const close of [...connections]) close();
    connections.clear();
  });

  server.get('/api/events/stream', async (request, reply) => {
    if (!isAllowedLocalRequest(request, options.access)) {
      throw new ApiError(
        403,
        'EVENT_STREAM_REJECTED',
        'The local event stream request was rejected.',
      );
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
    let unsubscribe = (): void => undefined;
    const close = (): void => {
      if (!active) return;
      active = false;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      heartbeat = undefined;
      unsubscribe();
      connections.delete(close);
      response.removeListener('close', close);
      if (!response.writableEnded) response.end();
    };
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

    unsubscribe = options.events.subscribe((event) => write(formatSseEvent(event)));
    write(`retry: ${retryMs}\n${formatSseEvent(options.events.createReadyEvent())}`);
    if (!active) return;

    heartbeat = setInterval(() => write(': heartbeat\n\n'), heartbeatMs);
    heartbeat.unref();
  });
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
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`SSE ${name} interval must be a positive integer.`);
  }
  return value;
}
