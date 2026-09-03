/**
 * Independent harness worker for F21 (short writer contention) and F23
 * (genuine overlap races). Runs on its OWN thread with its OWN physical SQLite
 * connection, so better-sqlite3's synchronous locking never blocks the main
 * thread's control plane.
 *
 * SharedArrayBuffer layout (Int32 slots):
 *   [writerAcquired=0, contentionObserved=1, releaseRequested=2,
 *    mutationCommitted=3, done=4]
 *
 * The worker never touches production classification. It only holds/commits a
 * real SQLite transaction and reacts to harness flags:
 *
 * mode "writer" (F21):
 *   1. acquires the real writer lock (BEGIN IMMEDIATE + real INSERT into a
 *      dedicated probe scratch table)
 *   2. acts as the harness control plane on this thread: polls the atomic
 *      contentionObserved slot (written by the internal probe on the main
 *      thread when the production path encounters a real SQLITE_BUSY) — this
 *      observation happens OUTSIDE the production retry call, on a separate
 *      execution context
 *   3. sets releaseRequested only after the observed signal and commits
 *   4. signals mutationCommitted + done
 *
 * mode "mutator" (F23):
 *   1. acquires the real writer lock and stages the exact mutation SQL inside
 *      the open transaction (uncommitted: MUTATOR_LOCK_ACQUIRED phase)
 *   2. commits when the main thread sets releaseRequested BEFORE starting the
 *      validator (the validator starts while the mutation phase is held:
 *      genuine overlap)
 *   3. signals mutationCommitted + done
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createDatabase } from '@sparkkeeper/database';

const { dbPath, mode, sab, mutationSql, mutationParams } = workerData;
const flags = new Int32Array(sab, 0, 5);
const probe = new Int32Array(sab, Int32Array.BYTES_PER_ELEMENT * 5, 1);
const SLOT_WRITER_ACQUIRED = 0;
const SLOT_CONTENTION_OBSERVED = 1;
const SLOT_RELEASE_REQUESTED = 2;
const SLOT_MUTATION_COMMITTED = 3;
const SLOT_DONE = 4;

const writer = createDatabase({ databasePath: dbPath });

let outcome;
try {
  // Phase 1: acquire the real writer lock.
  writer.sqlite.exec('BEGIN IMMEDIATE');
  if (mode === 'writer') {
    writer.sqlite.exec(
      'CREATE TABLE IF NOT EXISTS sparkkeeper_f21_contention_probe (id INTEGER PRIMARY KEY, note TEXT)',
    );
    writer.sqlite
      .prepare("INSERT INTO sparkkeeper_f21_contention_probe (note) VALUES ('writer-held')")
      .run();
  } else {
    writer.sqlite.prepare(mutationSql).run(...(mutationParams ?? []));
  }
  Atomics.store(flags, SLOT_WRITER_ACQUIRED, 1);
  Atomics.notify(flags, SLOT_WRITER_ACQUIRED, 1);

  // Phase 2: control plane on this worker thread (never inside the
  // production retry loop).
  // "writer" mode: poll the atomic contentionObserved slot (written by the
  // internal probe when the production path hits a real SQLITE_BUSY); once
  // observed, the worker itself sets releaseRequested and commits. This is
  // the harness control plane releasing the writer AFTER the observed signal.
  // "mutator" mode: commit as soon as the main thread sets releaseRequested
  // (set before the validator starts, so validation genuinely contends).
  for (;;) {
    if (mode === 'writer') {
      // Control-plane observation: the internal probe (main thread) atomically
      // increments the shared probe slot when the production path encounters a
      // real SQLITE_BUSY. The worker observes that atomic signal here —
      // outside the production retry loop — and only then releases.
      if (Atomics.load(probe, 0) >= 1) {
        Atomics.store(flags, SLOT_CONTENTION_OBSERVED, 1);
        Atomics.store(flags, SLOT_RELEASE_REQUESTED, 1);
        break;
      }
    } else if (Atomics.load(flags, SLOT_RELEASE_REQUESTED) === 1) {
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Phase 3: release only on harness request.
  writer.sqlite.exec('COMMIT');
  Atomics.store(flags, SLOT_MUTATION_COMMITTED, 1);
  Atomics.notify(flags, SLOT_MUTATION_COMMITTED, 1);

  outcome = { ok: true };
} catch (error) {
  outcome = {
    ok: false,
    name: error.name,
    code: error.code,
    message: String(error.message).slice(0, 120),
  };
} finally {
  try {
    writer.sqlite.exec('ROLLBACK');
  } catch {
    // not in a transaction
  }
  writer.close();
  Atomics.store(flags, SLOT_DONE, 1);
  Atomics.notify(flags, SLOT_DONE, 1);
}

parentPort.postMessage(outcome);
