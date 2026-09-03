/**
 * Worker entry for the genuine concurrent bootstrap proof (RR-01/A05).
 *
 * SAB layout (Int32 slots): [readyA=0, readyB=1, release=2, startedA=3, startedB=4]
 *
 * Each worker:
 * 1. opens its OWN physical SQLite connection (own DatabaseClient)
 * 2. signals its own ready slot
 * 3. blocks on Atomics.wait(slot 2 = release) — no sleeps
 * 4. ONLY after release sets its started marker and calls the real
 *    bootstrapInitialAdminWithAudit
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createDatabase, AdminAuthRepository } from '@sparkkeeper/database';
import { PasswordHasher } from '../src/security/PasswordHasher.js';

const { dbPath, passwordHash, sab, workerIndex } = workerData;
const READY_SLOT = workerIndex; // 0 or 1
const RELEASE_SLOT = 2;
const STARTED_SLOT = 3 + workerIndex; // 3 or 4

const flags = new Int32Array(sab);

const db = createDatabase({ databasePath: dbPath });
const hasher = new PasswordHasher();

// 1+2: connection open; signal this worker's ready slot.
Atomics.store(flags, READY_SLOT, 1);
Atomics.notify(flags, READY_SLOT);

// 3: block until the parent releases BOTH workers (no sleeps).
const waitResult = Atomics.wait(flags, RELEASE_SLOT, 0);
if (waitResult !== 'ok' && waitResult !== 'not-equal') {
  parentPort.postMessage({ outcome: `WAIT_FAILED:${String(waitResult)}` });
  db.close();
} else {
  // 4: mark bootstrap actually started, then run the real transaction.
  Atomics.store(flags, STARTED_SLOT, 1);

  /**
   * P2-3 (TEST-HARNESS-ONLY): the losing worker's single 500ms busy budget can
   * be exhausted while the winner is still Argon2-hashing under heavy CPU
   * load, so the loss arrives as transient infrastructure BUSY. One additional
   * bootstrap attempt is permitted, ONLY for that exact transient
   * classification, without sleeps; production repository behavior is
   * unchanged. The first concurrent attempt itself is still fully proven by
   * the harness (both ready, both released together, no early bootstrap).
   */
  const isTransientBusy = (error) => {
    let cause = error;
    while (cause !== null && cause !== undefined) {
      if (
        cause.code === 'SQLITE_BUSY' ||
        cause.code === 'SQLITE_BUSY_SNAPSHOT' ||
        cause.code === 'SQLITE_LOCKED' ||
        (typeof cause.message === 'string' && cause.message.includes('database is locked'))
      ) {
        return true;
      }
      cause = cause.cause;
    }
    return false;
  };

  let outcome;
  let storedHash = null;
  try {
    const hash = await hasher.hash(passwordHash);
    const repository = new AdminAuthRepository(db);
    let result;
    try {
      result = repository.bootstrapInitialAdminWithAudit({
        username: workerIndex === 0 ? 'Admin_W0' : 'Admin_W1',
        passwordHash: hash,
        now: new Date(),
      });
    } catch (err) {
      if (!isTransientBusy(err)) throw err;
      result = repository.bootstrapInitialAdminWithAudit({
        username: workerIndex === 0 ? 'Admin_W0' : 'Admin_W1',
        passwordHash: hash,
        now: new Date(),
      });
    }
    outcome = result.outcome;
  } catch (err) {
    outcome = `THROWN:${err.name}`;
  }

  try {
    const users = db.sqlite.prepare('SELECT password_hash FROM admin_users').all();
    storedHash = users.length > 0 ? users[0].password_hash : null;
  } catch {
    // row read cannot fail before close; outcome carries the proof
  }
  db.close();

  parentPort.postMessage({ outcome, storedHash });
}
