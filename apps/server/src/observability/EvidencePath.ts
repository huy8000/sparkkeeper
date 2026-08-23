import path from 'node:path';
import { existsSync, lstatSync } from 'node:fs';

import type { BusinessDate, RuntimeEventType } from '@sparkkeeper/shared';

export interface EvidencePath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export class EvidencePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidencePathError';
  }
}

export function resolveEvidencePath(input: {
  readonly root: string;
  readonly category: 'screenshots' | 'traces';
  readonly businessDate: BusinessDate;
  readonly runId: string;
  readonly eventType: RuntimeEventType;
  readonly friendId?: string;
  readonly extension: 'png' | 'zip';
}): EvidencePath {
  const root = path.resolve(input.root);
  const runId = safeComponent(input.runId, 'runId');
  const friendId =
    input.friendId === undefined ? undefined : safeComponent(input.friendId, 'friendId');
  const eventSlug = input.eventType.toLowerCase().replaceAll('_', '-');
  const filename = `${eventSlug}${friendId === undefined ? '' : `-${friendId}`}.${input.extension}`;
  const relativeWithinRoot = path.join(input.businessDate, runId, filename);
  const absolutePath = path.resolve(root, relativeWithinRoot);
  const relativeFromRoot = path.relative(root, absolutePath);
  if (
    relativeFromRoot === '' ||
    relativeFromRoot.startsWith(`..${path.sep}`) ||
    relativeFromRoot === '..' ||
    path.isAbsolute(relativeFromRoot)
  ) {
    throw new EvidencePathError('Evidence path escaped its configured root.');
  }
  return {
    absolutePath,
    relativePath: path.posix.join(input.category, input.businessDate, runId, filename),
  };
}

export function assertEvidencePathHasNoSymlink(rootValue: string, absolutePath: string): void {
  const root = path.resolve(rootValue);
  const target = path.resolve(absolutePath);
  const relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new EvidencePathError('Evidence path escaped its configured root.');
  }
  const parts = relative.split(path.sep).filter(Boolean);
  let candidate = root;
  for (const part of ['', ...parts]) {
    if (part !== '') candidate = path.join(candidate, part);
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      throw new EvidencePathError('Evidence path must not traverse a symbolic link.');
    }
  }
}

function safeComponent(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new EvidencePathError(`${label} contains unsafe path characters.`);
  }
  return value;
}
