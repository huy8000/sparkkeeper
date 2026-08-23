import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';

import { assertEvidencePathHasNoSymlink } from './EvidencePath.js';

const LOG_FILE_PATTERN = /^sparkkeeper-(\d{4}-\d{2}-\d{2})\.log$/;

export interface RotationClock {
  now(): Date;
}

export class DailyRotatingFileStream extends Writable {
  private currentFilePath: string | undefined;

  constructor(
    readonly root: string,
    readonly retentionDays: number,
    private readonly clock: RotationClock = { now: () => new Date() },
  ) {
    super({ decodeStrings: true });
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error('Log retention days must be a positive integer.');
    }
    assertEvidencePathHasNoSymlink(root, root);
    mkdirSync(root, { recursive: true });
    assertEvidencePathHasNoSymlink(root, root);
  }

  get activeFilePath(): string | undefined {
    return this.currentFilePath;
  }

  rotateAndCleanup(): string {
    const now = this.clock.now();
    if (!Number.isFinite(now.getTime()))
      throw new Error('Rotation clock returned an invalid Date.');
    const day = now.toISOString().slice(0, 10);
    const nextPath = path.join(this.root, `sparkkeeper-${day}.log`);
    assertEvidencePathHasNoSymlink(this.root, nextPath);
    if (this.currentFilePath !== nextPath) {
      this.currentFilePath = nextPath;
      this.cleanupExpired(now, nextPath);
    }
    return nextPath;
  }

  cleanupExpired(now = this.clock.now(), activePath = this.currentFilePath): readonly string[] {
    const cutoff = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - this.retentionDays,
    );
    const removed: string[] = [];
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const match = LOG_FILE_PATTERN.exec(entry.name);
      if (match?.[1] === undefined) continue;
      const candidatePath = path.join(this.root, entry.name);
      if (candidatePath === activePath) continue;
      const candidateDay = Date.parse(`${match[1]}T00:00:00.000Z`);
      if (!Number.isFinite(candidateDay) || candidateDay >= cutoff) continue;
      if (!statSync(candidatePath).isFile()) continue;
      unlinkSync(candidatePath);
      removed.push(candidatePath);
    }
    return removed;
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    try {
      appendFileSync(
        this.rotateAndCleanup(),
        chunk,
        typeof chunk === 'string' ? encoding : undefined,
      );
      callback();
    } catch (error) {
      callback(error instanceof Error ? error : new Error('Log destination write failed.'));
    }
  }
}
