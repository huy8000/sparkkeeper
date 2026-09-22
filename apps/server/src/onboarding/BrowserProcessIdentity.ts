import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IDENTITY_ROOT = path.join(os.tmpdir(), 'sparkkeeper-browser-processes');
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface BrowserProcessIdentity {
  readonly pid: number;
  readonly pgid: number;
}

export function prepareBrowserIdentityFile(sessionId: string): string {
  const identityFile = browserIdentityFile(sessionId);
  mkdirSync(IDENTITY_ROOT, { recursive: true, mode: 0o700 });
  const rootState = lstatSync(IDENTITY_ROOT);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) {
    throw new Error('Browser process identity root is unsafe.');
  }
  if (process.platform !== 'win32') chmodSync(IDENTITY_ROOT, 0o700);
  if (existsSync(identityFile)) {
    throw new Error('Browser process identity already exists.');
  }
  return identityFile;
}

export function browserIdentityFile(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error('Invalid browser process session id.');
  return path.join(IDENTITY_ROOT, `${sessionId.toLowerCase()}.identity`);
}

export function readBrowserProcessIdentity(sessionId: string): BrowserProcessIdentity | undefined {
  const identityFile = browserIdentityFile(sessionId);
  if (!existsSync(identityFile)) return undefined;
  const state = lstatSync(identityFile);
  if (state.isSymbolicLink() || !state.isFile() || state.size > 96) {
    throw new Error('Browser process identity file is unsafe.');
  }
  const match = /^(\d+) (\d+)\n$/u.exec(readFileSync(identityFile, 'utf8'));
  if (match === null) throw new Error('Browser process identity is invalid.');
  const pid = Number(match[1]);
  const pgid = Number(match[2]);
  if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(pgid) || pid <= 1 || pgid !== pid) {
    throw new Error('Browser process identity is invalid.');
  }
  return { pid, pgid };
}

export function removeBrowserIdentityFile(sessionId: string): void {
  rmSync(browserIdentityFile(sessionId), { force: true });
}
