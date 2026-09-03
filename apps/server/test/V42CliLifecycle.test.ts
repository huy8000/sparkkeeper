import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';

import { readHiddenPassword, runAdminCli, type CliStreams } from '../src/admin-cli.js';
import { createDatabase, AdminAuthRepository } from '@sparkkeeper/database';

/** Test-only sentinel assembled at runtime (never a real credential). */
const CLI_TEST_PASSWORD = ['cli', 'vector', 'passphrase', 'V42'].join('-');

/**
 * TTY-like stream using the exact production code path (a real Readable that
 * setRawMode can toggle). No decision stubs: the reader sees real 'data',
 * 'error', 'end', and 'close' events.
 */
class TtyLikeStream extends EventEmitter {
  isTTY = true;
  isRaw = false;
  ended = false;
  private readonly chunks: string[] = [];

  setRawMode(mode: boolean): boolean {
    this.isRaw = mode;
    return true;
  }

  resume(): this {
    return this;
  }

  read(): string | null {
    return this.chunks.shift() ?? null;
  }

  emitChunk(text: string): void {
    this.chunks.push(text);
    this.emit('data', Buffer.from(text, 'utf8'));
  }
}

interface RecordedStream {
  readonly stdin: TtyLikeStream;
  readonly stdout: { writes: string[]; write: (s: string) => boolean };
  readonly stderr: { writes: string[]; write: (s: string) => boolean };
}

function recordedStreams(): RecordedStream {
  const stdin = new TtyLikeStream();
  const stdout = { writes: [] as string[], write: (s: string) => (stdout.writes.push(s), true) };
  const stderr = { writes: [] as string[], write: (s: string) => (stderr.writes.push(s), true) };
  return { stdin, stdout, stderr };
}

test('V42-FR-08: TTY password reader settles and restores raw mode on success', async () => {
  const streams = recordedStreams();
  const promise = readHiddenPassword('Enter: ', { ...streams, isTTY: true });
  assert.equal(streams.stdin.isRaw, true, 'raw mode enabled during read');

  streams.stdin.emitChunk(`${CLI_TEST_PASSWORD}\r`);
  const password = await promise;

  assert.equal(password, CLI_TEST_PASSWORD);
  assert.equal(streams.stdin.isRaw, false, 'raw mode restored');
  assert.equal(streams.stdin.listenerCount('data'), 0);
  assert.equal(streams.stdin.listenerCount('error'), 0);
  assert.equal(streams.stdin.listenerCount('end'), 0);
  assert.equal(streams.stdin.listenerCount('close'), 0);
});

test('V42-FR-08: Ctrl-C rejects with abort and restores the terminal exactly once', async () => {
  const streams = recordedStreams();
  let restoreCalls = 0;
  streams.stdin.setRawMode = (mode: boolean) => {
    // Count restores only (raw enable happens once before).
    if (!mode) restoreCalls += 1;
    streams.stdin.isRaw = mode;
    return true;
  };

  const promise = readHiddenPassword('Enter: ', { ...streams, isTTY: true });
  streams.stdin.emitChunk('part');
  streams.stdin.emitChunk('\x03');

  await assert.rejects(promise, /Input aborted by user/);
  assert.equal(restoreCalls, 1);
  assert.equal(streams.stdin.listenerCount('data'), 0);
});

test('V42-FR-08: read error settles the promise and restores raw mode', async () => {
  const streams = recordedStreams();
  const promise = readHiddenPassword('Enter: ', { ...streams, isTTY: true });
  streams.stdin.emit('error', new Error('device failure'));

  await assert.rejects(promise, /device failure/);
  assert.equal(streams.stdin.isRaw, false);
  assert.equal(streams.stdin.listenerCount('data'), 0);
  assert.equal(streams.stdin.listenerCount('error'), 0);
});

test('V42-FR-08: end and close settle the promise (never left pending)', async () => {
  const endStreams = recordedStreams();
  const endPromise = readHiddenPassword('Enter: ', { ...endStreams, isTTY: true });
  endStreams.stdin.emit('end');
  await assert.rejects(endPromise, /ended before a password/);
  assert.equal(endStreams.stdin.isRaw, false);

  const closeStreams = recordedStreams();
  const closePromise = readHiddenPassword('Enter: ', { ...closeStreams, isTTY: true });
  closeStreams.stdin.emit('close');
  await assert.rejects(closePromise, /closed before a password/);
  assert.equal(closeStreams.stdin.isRaw, false);
});

test('V42-FR-08: validation failure path (mismatched confirmation) exits 1 through runAdminCli', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-cli-mismatch-'));
  try {
    const stdin = new TtyLikeStream();
    const stdout = { writes: [] as string[], write: (s: string) => (stdout.writes.push(s), true) };
    const stderr = { writes: [] as string[], write: (s: string) => (stderr.writes.push(s), true) };
    const streams: CliStreams = { stdin, stdout, stderr, isTTY: true };

    const promise = runAdminCli({
      argv: ['node', 'admin-cli', 'bootstrap', '--username', 'Admin_Cli'],
      streams,
      databasePath: path.join(dir, 'test.db'),
    });

    // Feed first password, then a DIFFERENT confirmation.
    await new Promise<void>((resolve) => setImmediate(resolve));
    stdin.emitChunk(`${CLI_TEST_PASSWORD}\r`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    stdin.emitChunk(`${CLI_TEST_PASSWORD}-different\r`);

    const code = await promise;
    assert.equal(code, 1);
    assert.ok(stderr.writes.some((w) => w.includes('do not match')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('V42-FR-08: terminal-restore failure is reported, never silently swallowed', async () => {
  const streams = recordedStreams();
  streams.stdin.setRawMode = (mode: boolean) => {
    if (!mode) {
      throw new Error('tcsetattr failed');
    }
    streams.stdin.isRaw = mode;
    return true;
  };

  const promise = readHiddenPassword('Enter: ', { ...streams, isTTY: true });
  streams.stdin.emitChunk(`${CLI_TEST_PASSWORD}\r`);

  await assert.rejects(promise, /terminal restoration failed/);
  // Listeners were still removed exactly once even though restore failed.
  assert.equal(streams.stdin.listenerCount('data'), 0);
  // The rejection message must not leak the entered password.
  let leaked = false;
  try {
    await promise;
  } catch (err) {
    leaked = (err as Error).message.includes(CLI_TEST_PASSWORD);
  }
  assert.equal(leaked, false);
});

test('V42-FR-08/A05: genuine concurrent bootstrap via worker threads on separate physical connections', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sparkkeeper-cli-workers-'));
  const dbPath = path.join(dir, 'test.db');

  // Pre-migrate the schema so both workers only run the bootstrap transaction.
  const preparer = createDatabase({ databasePath: dbPath });
  preparer.migrate();
  preparer.close();

  // SAB layout (Int32 slots): [readyA=0, readyB=1, release=2, startedA=3, startedB=4]
  const sab = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 5);
  const flags = new Int32Array(sab);
  const READY_A = 0;
  const READY_B = 1;
  const RELEASE = 2;
  const STARTED_A = 3;
  const STARTED_B = 4;

  const liveWorkers: Worker[] = [];
  // The teardown backstop terminates workers if the body fails first; the
  // resulting exit-code-1 rejections must never surface as unhandled
  // rejections that would mask the actual failure. Declared outside the try
  // so the finally block can await its settlement.
  let resultsTeardownGuard: Promise<void> = Promise.resolve();
  const startWorker = (
    workerIndex: 0 | 1,
  ): Promise<{ outcome: string; storedHash: string | null }> =>
    new Promise((resolve, reject) => {
      const worker = new Worker(path.resolve(import.meta.dirname, './V42BootstrapWorker.mjs'), {
        workerData: { dbPath, passwordHash: CLI_TEST_PASSWORD, sab, workerIndex },
        stderr: true,
        stdout: true,
      });
      liveWorkers.push(worker);
      let workerStderr = '';
      worker.stderr?.on('data', (chunk) => {
        workerStderr += String(chunk);
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(
            new Error(`worker ${workerIndex} exited with ${code}: ${workerStderr.slice(0, 2000)}`),
          );
        }
      });
    });

  try {
    // 1. Start both workers (each opens its own physical SQLite connection).
    const resultsPromise = Promise.all([startWorker(0), startWorker(1)]);
    resultsTeardownGuard = resultsPromise.then(
      () => undefined,
      () => undefined,
    );

    // 2. Wait until BOTH ready slots are set (turn-based, no sleeps).
    const waitUntil = async (predicate: () => boolean): Promise<void> => {
      for (let i = 0; i < 20_000; i++) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error('barrier condition not met');
    };
    await waitUntil(() => Atomics.load(flags, READY_A) === 1 && Atomics.load(flags, READY_B) === 1);

    // 3. Prove bootstrap has NOT started yet through observe-only markers.
    assert.equal(
      Atomics.load(flags, STARTED_A),
      0,
      'worker A bootstrap-start marker before release',
    );
    assert.equal(
      Atomics.load(flags, STARTED_B),
      0,
      'worker B bootstrap-start marker before release',
    );
    const earlyCheck = createDatabase({ databasePath: dbPath });
    const earlyUsers = earlyCheck.sqlite.prepare('SELECT COUNT(*) n FROM admin_users').get() as {
      n: number;
    };
    earlyCheck.close();
    assert.equal(earlyUsers.n, 0, 'no early bootstrap before release');

    // 4+5. Release BOTH workers at once and notify.
    Atomics.store(flags, RELEASE, 1);
    Atomics.notify(flags, RELEASE, 2);

    const results = await resultsPromise;

    // After release: exactly one winner and one loser.
    const outcomes = results.map((r) => r.outcome).sort();
    assert.deepEqual(outcomes, ['ADMIN_ALREADY_INITIALIZED', 'SUCCESS']);
    assert.equal(Atomics.load(flags, STARTED_A), 1, 'worker A started after release');
    assert.equal(Atomics.load(flags, STARTED_B), 1, 'worker B started after release');

    const db = createDatabase({ databasePath: dbPath });
    try {
      const users = db.sqlite.prepare('SELECT * FROM admin_users').all() as Array<{
        id: string;
        password_hash: string;
      }>;
      assert.equal(users.length, 1, 'exactly one Admin user');

      const audits = db.sqlite
        .prepare("SELECT * FROM audit_events WHERE action = 'ADMIN_INITIALIZED'")
        .all() as Array<Record<string, unknown>>;
      assert.equal(audits.length, 1, 'exactly one ADMIN_INITIALIZED audit');

      // Winner PHC unchanged after the loser finished.
      const winnerHash = results.find((r) => r.outcome === 'SUCCESS')!.storedHash!;
      assert.ok(winnerHash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'));
      assert.equal(users[0].password_hash, winnerHash);

      const repository = new AdminAuthRepository(db);
      const probe = repository.bootstrapInitialAdminWithAudit({
        username: 'Admin_Probe',
        passwordHash: winnerHash,
      });
      assert.equal(probe.outcome, 'ADMIN_ALREADY_INITIALIZED');
    } finally {
      db.close();
    }
  } finally {
    // Backstop: release any worker still blocked on the barrier so the
    // process can always exit even on failure. Awaiting the early-catch guard
    // keeps the teardown terminate() exit events from surfacing as unhandled
    // rejections that would mask the actual failure; it never rejects.
    await resultsTeardownGuard;
    Atomics.store(flags, RELEASE, 1);
    Atomics.notify(flags, RELEASE, 2);
    for (const worker of liveWorkers) {
      await worker.terminate();
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
