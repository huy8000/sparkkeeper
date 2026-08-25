import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { BusinessDate, RuntimeEventType } from '@sparkkeeper/shared';

import { assertEvidencePathHasNoSymlink, resolveEvidencePath } from './EvidencePath.js';

export interface ScreenshotCapture {
  capture(absolutePath: string): Promise<void>;
}

export interface ScreenshotRequest {
  readonly businessDate: BusinessDate;
  readonly runId: string;
  readonly eventType: RuntimeEventType;
  readonly friendId?: string;
}

export type ScreenshotResult =
  | { readonly status: 'CAPTURED'; readonly relativePath: string }
  | { readonly status: 'FAILED'; readonly errorCode: 'SCREENSHOT_CAPTURE_FAILED' };

export class ScreenshotManager {
  constructor(
    private readonly root: string,
    private readonly captureAdapter: ScreenshotCapture,
  ) {}

  async capture(request: ScreenshotRequest): Promise<ScreenshotResult> {
    try {
      const evidence = resolveEvidencePath({
        root: this.root,
        category: 'screenshots',
        businessDate: request.businessDate,
        runId: request.runId,
        eventType: request.eventType,
        ...(request.friendId === undefined ? {} : { friendId: request.friendId }),
        extension: 'png',
      });
      assertEvidencePathHasNoSymlink(this.root, path.dirname(evidence.absolutePath));
      await mkdir(path.dirname(evidence.absolutePath), { recursive: true });
      assertEvidencePathHasNoSymlink(this.root, evidence.absolutePath);
      await this.captureAdapter.capture(evidence.absolutePath);
      return { status: 'CAPTURED', relativePath: evidence.relativePath };
    } catch {
      return { status: 'FAILED', errorCode: 'SCREENSHOT_CAPTURE_FAILED' };
    }
  }
}

export interface ScreenshotPage {
  screenshot(options: { readonly path: string; readonly fullPage: boolean }): Promise<unknown>;
}

export class PlaywrightScreenshotCapture implements ScreenshotCapture {
  constructor(private readonly page: () => ScreenshotPage) {}

  async capture(absolutePath: string): Promise<void> {
    await this.page().screenshot({ path: absolutePath, fullPage: true });
  }
}
