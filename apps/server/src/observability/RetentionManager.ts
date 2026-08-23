import { lstatSync, readdirSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { assertEvidencePathHasNoSymlink } from './EvidencePath.js';

const DAY_MS = 86_400_000;

export interface RetentionResult {
  readonly removedFiles: readonly string[];
  readonly errorCount: number;
}

export interface RetentionManagerOptions {
  readonly screenshotRoot: string;
  readonly traceRoot: string;
  readonly screenshotRetentionDays: number;
  readonly traceRetentionDays: number;
  readonly onError?: (errorCode: 'RETENTION_CLEANUP_FAILED') => void;
  readonly removeFile?: (absolutePath: string) => void;
}

export class RetentionManager {
  private readonly removeFile: (absolutePath: string) => void;

  constructor(private readonly options: RetentionManagerOptions) {
    validateDays(options.screenshotRetentionDays);
    validateDays(options.traceRetentionDays);
    this.removeFile = options.removeFile ?? ((absolutePath) => unlinkSync(absolutePath));
  }

  cleanup(now = new Date()): RetentionResult {
    const removedFiles: string[] = [];
    let errorCount = 0;
    const cleanupRoot = (root: string, retentionDays: number, extension: string): void => {
      try {
        const resolvedRoot = path.resolve(root);
        assertEvidencePathHasNoSymlink(resolvedRoot, resolvedRoot);
        if (lstatSync(resolvedRoot).isSymbolicLink())
          throw new Error('Retention root must not be a symbolic link.');
        this.cleanupDirectory(
          resolvedRoot,
          resolvedRoot,
          now.getTime() - retentionDays * DAY_MS,
          extension,
          removedFiles,
          () => {
            errorCount += 1;
            this.options.onError?.('RETENTION_CLEANUP_FAILED');
          },
        );
      } catch {
        if (!existsRoot(root)) return;
        errorCount += 1;
        this.options.onError?.('RETENTION_CLEANUP_FAILED');
      }
    };
    cleanupRoot(this.options.screenshotRoot, this.options.screenshotRetentionDays, '.png');
    cleanupRoot(this.options.traceRoot, this.options.traceRetentionDays, '.zip');
    return { removedFiles, errorCount };
  }

  private cleanupDirectory(
    root: string,
    directory: string,
    cutoffMs: number,
    extension: string,
    removedFiles: string[],
    recordError: () => void,
  ): void {
    const relative = path.relative(root, directory);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error('Retention path escaped its configured root.');
    }
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const state = lstatSync(candidate);
      if (state.isSymbolicLink()) continue;
      if (state.isDirectory()) {
        this.cleanupDirectory(root, candidate, cutoffMs, extension, removedFiles, recordError);
        try {
          if (readdirSync(candidate).length === 0) rmdirSync(candidate);
        } catch {
          // A concurrent writer may have repopulated the directory.
        }
        continue;
      }
      if (!state.isFile() || path.extname(entry.name) !== extension) continue;
      if (statSync(candidate).mtimeMs >= cutoffMs) continue;
      try {
        this.removeFile(candidate);
        removedFiles.push(candidate);
      } catch {
        recordError();
      }
    }
  }
}

function existsRoot(root: string): boolean {
  try {
    lstatSync(path.resolve(root));
    return true;
  } catch {
    return false;
  }
}

function validateDays(days: number): void {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error('Evidence retention days must be a positive integer.');
  }
}
