import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { BusinessDate, RuntimeEventType } from '@sparkkeeper/shared';

import type { TraceMode } from '../config/ObservabilityConfig.js';
import { assertEvidencePathHasNoSymlink, resolveEvidencePath } from './EvidencePath.js';

export interface TraceCapture {
  start(): Promise<void>;
  stop(absolutePath?: string): Promise<void>;
}

export interface TraceRequest {
  readonly businessDate: BusinessDate;
  readonly runId: string;
  readonly eventType: RuntimeEventType;
  readonly friendId?: string;
}

export type TraceStartResult =
  | { readonly status: 'STARTED' }
  | { readonly status: 'DISABLED' }
  | { readonly status: 'FAILED'; readonly errorCode: 'TRACE_START_FAILED' };

export type TraceFinishResult =
  | { readonly status: 'SAVED'; readonly relativePath: string }
  | { readonly status: 'DISCARDED' | 'NOT_STARTED' }
  | { readonly status: 'FAILED'; readonly errorCode: 'TRACE_SAVE_FAILED' };

export class TraceManager {
  private readonly activeRuns = new Set<string>();

  constructor(
    private readonly mode: TraceMode,
    private readonly root: string,
    private readonly captureAdapter: TraceCapture,
  ) {}

  async start(runId: string): Promise<TraceStartResult> {
    if (this.mode === 'off') return { status: 'DISABLED' };
    if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
      return { status: 'FAILED', errorCode: 'TRACE_START_FAILED' };
    }
    if (this.activeRuns.has(runId)) return { status: 'STARTED' };
    try {
      await this.captureAdapter.start();
      this.activeRuns.add(runId);
      return { status: 'STARTED' };
    } catch {
      return { status: 'FAILED', errorCode: 'TRACE_START_FAILED' };
    }
  }

  async finish(request: TraceRequest, failed: boolean): Promise<TraceFinishResult> {
    if (!this.activeRuns.delete(request.runId)) return { status: 'NOT_STARTED' };
    try {
      if (this.mode === 'on-failure' && !failed) {
        await this.captureAdapter.stop();
        return { status: 'DISCARDED' };
      }
      const evidence = resolveEvidencePath({
        root: this.root,
        category: 'traces',
        businessDate: request.businessDate,
        runId: request.runId,
        eventType: request.eventType,
        ...(request.friendId === undefined ? {} : { friendId: request.friendId }),
        extension: 'zip',
      });
      assertEvidencePathHasNoSymlink(this.root, path.dirname(evidence.absolutePath));
      await mkdir(path.dirname(evidence.absolutePath), { recursive: true });
      assertEvidencePathHasNoSymlink(this.root, evidence.absolutePath);
      await this.captureAdapter.stop(evidence.absolutePath);
      return { status: 'SAVED', relativePath: evidence.relativePath };
    } catch {
      return { status: 'FAILED', errorCode: 'TRACE_SAVE_FAILED' };
    }
  }
}

export interface TracingApi {
  start(options: { readonly screenshots: boolean; readonly snapshots: boolean }): Promise<void>;
  stop(options?: { readonly path: string }): Promise<void>;
}

export class PlaywrightTraceCapture implements TraceCapture {
  constructor(private readonly tracing: () => TracingApi) {}

  async start(): Promise<void> {
    await this.tracing().start({ screenshots: true, snapshots: true });
  }

  async stop(absolutePath?: string): Promise<void> {
    if (absolutePath === undefined) await this.tracing().stop();
    else await this.tracing().stop({ path: absolutePath });
  }
}
