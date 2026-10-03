import { fork, type ChildProcess } from 'node:child_process';
import type { DiscoveryPublication } from '@sparkkeeper/database';
import { ContactFiles } from './ContactFiles.js';
import {
  DiscoveryProcessOwnership,
  type DiscoveryProcessProof,
} from './DiscoveryProcessOwnership.js';
import {
  validateDiscoveryEvent,
  uuid,
  type DiscoveryWorkerStart,
} from './ContactDiscoveryWorkerProtocol.js';
import {
  readBrowserProcessIdentity,
  removeBrowserIdentityFile,
  browserProcessIdentityIds,
} from '../onboarding/BrowserProcessIdentity.js';

interface RecordState {
  runId: string;
  child: ChildProcess;
  worker: DiscoveryProcessProof;
  browser: DiscoveryProcessProof | undefined;
  launching: boolean;
  started: boolean;
  launchAborted: boolean;
  stopping: boolean;
  settled: boolean;
  sequence: number;
  observations: DiscoveryPublication['observations'][number][];
  resolve: (p: DiscoveryPublication) => void;
  timer: ReturnType<typeof setTimeout>;
  queue: Promise<void>;
}
export interface DiscoverySupervisor {
  readonly runtimeAvailable: boolean;
  inventory(): string[];
  recover(id: string): Promise<void>;
  start(input: DiscoveryWorkerStart): Promise<DiscoveryPublication>;
  stop(id: string): Promise<void>;
  stopAll(): Promise<void>;
}
const failure = (): DiscoveryPublication => ({
  status: 'FAILED',
  failureCode: 'BROWSER_FAILURE',
  observations: [],
  issueCount: 0,
  authChecked: false,
});
function groupAlive(pgid: number) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') return false;
    // eslint-disable-next-line preserve-caught-error -- Keep raw process diagnostics out of API/log errors.
    throw new Error('Unresolved discovery group.');
  }
}
function signal(pgid: number, sig: NodeJS.Signals) {
  try {
    process.kill(-pgid, sig);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH')
      // eslint-disable-next-line preserve-caught-error -- The public failure must be opaque.
      throw new Error('Discovery teardown failed.');
  }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
class PendingBrowserLaunchError extends Error {}

export class ContactDiscoveryWorkerSupervisor implements DiscoverySupervisor {
  readonly runtimeAvailable = process.platform === 'linux';
  private readonly records = new Map<string, RecordState>();
  private readonly stops = new Map<string, Promise<void>>();
  private readonly provisional = new Map<string, number>();
  readonly ownership: DiscoveryProcessOwnership;
  constructor(
    runtimeRoot: string,
    private readonly options: {
      spawn?: () => ChildProcess;
      graceMs?: number;
      killGraceMs?: number;
      isSyncId?: (id: string) => boolean;
    } = {},
  ) {
    this.ownership = new DiscoveryProcessOwnership(new ContactFiles(runtimeRoot));
  }
  inventory() {
    return [
      ...new Set([
        ...this.ownership.inventory(),
        ...browserProcessIdentityIds().filter((id) => this.options.isSyncId?.(id)),
      ]),
    ];
  }
  async start(input: DiscoveryWorkerStart): Promise<DiscoveryPublication> {
    if (!this.runtimeAvailable || !uuid(input.runId) || this.records.size || this.provisional.size)
      throw new Error('Discovery runtime unavailable.');
    await this.recover(input.runId);
    const allowedEnvironment = Object.fromEntries(
      ['PATH', 'HOME', 'LANG', 'LC_ALL', 'PLAYWRIGHT_BROWSERS_PATH', 'TMPDIR'].flatMap((k) =>
        process.env[k] === undefined ? [] : [[k, process.env[k]!]],
      ),
    );
    const child =
      this.options.spawn?.() ??
      fork(new URL('./contact-discovery-worker.js', import.meta.url), [], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: allowedEnvironment,
      });
    let worker: DiscoveryProcessProof;
    try {
      if (!child.pid) throw new Error('Worker PID unavailable.');
      this.provisional.set(input.runId, child.pid);
      worker = this.ownership.write(input.runId, child.pid, 'worker');
    } catch (e) {
      if (child.pid) signal(child.pid, 'SIGKILL');
      await this.clearProvisional(input.runId);
      throw e;
    }
    let resolve!: (p: DiscoveryPublication) => void;
    const outcome = new Promise<DiscoveryPublication>((r) => {
      resolve = r;
    });
    const record: RecordState = {
      runId: input.runId,
      child,
      worker,
      browser: undefined,
      launching: false,
      started: false,
      launchAborted: false,
      stopping: false,
      settled: false,
      sequence: 0,
      observations: [],
      resolve,
      timer: setTimeout(
        () => this.finish(record, failure()),
        Math.max(1, input.deadline - Date.now()),
      ),
      queue: Promise.resolve(),
    };
    this.records.set(input.runId, record);
    this.provisional.delete(input.runId);
    child.on('message', (message) => {
      record.queue = record.queue.then(async () => {
        if (record.settled || record.stopping) return;
        try {
          const e = validateDiscoveryEvent(message, input.runId);
          if (e.type === 'BROWSER_LAUNCHING') {
            if (record.launching) throw new Error('Duplicate launch');
            record.launching = true;
          } else if (e.type === 'BROWSER_LAUNCH_ABORTED') {
            if (!record.launching || record.started || record.launchAborted)
              throw new Error('Invalid abort');
            record.launchAborted = true;
            // An abort is phase evidence, not permission to discard unresolved
            // Chromium ownership. Normal checkedBrowser/teardown still applies.
          } else if (e.type === 'BROWSER_STARTED') {
            if (!record.launching || record.started || record.launchAborted)
              throw new Error('Invalid launch');
            const p = this.ownership.read(input.runId, 'browser');
            if (!p || !this.ownership.alive(p)) throw new Error('Browser ownership unavailable');
            record.browser = p;
            record.started = true;
          } else if (e.type === 'BATCH') {
            if (
              !record.started ||
              e.sequence !== record.sequence++ ||
              record.observations.length + e.observations.length > 500
            )
              throw new Error('Invalid batch');
            record.observations.push(...e.observations);
            child.send({ type: 'ACK', runId: input.runId, sequence: e.sequence });
          } else if (e.type === 'RESULT') {
            if (
              ((e.status === 'COMPLETE' || e.status === 'PARTIAL') && !record.started) ||
              record.observations.length + e.issueCount > 500
            )
              throw new Error('Invalid result');
            this.finish(record, {
              ...e,
              observations:
                e.status === 'FAILED' || e.status === 'AUTH_EXPIRED' ? [] : record.observations,
            });
          }
        } catch {
          this.finish(record, failure());
        }
      });
    });
    child.once('error', () => this.finish(record, failure()));
    child.once('exit', () => this.finish(record, failure()));
    try {
      if (!child.send(input)) this.finish(record, failure());
    } catch {
      this.finish(record, failure());
    }
    return outcome;
  }
  private finish(record: RecordState, p: DiscoveryPublication) {
    if (record.settled) return;
    record.settled = true;
    clearTimeout(record.timer);
    record.resolve(p);
  }
  stop(id: string): Promise<void> {
    const previous = this.stops.get(id);
    if (previous) return previous;
    const pending = this.stopOwned(id).finally(() => this.stops.delete(id));
    this.stops.set(id, pending);
    return pending;
  }
  private async stopOwned(id: string): Promise<void> {
    await this.clearProvisional(id);
    const r = this.records.get(id);
    if (!r) {
      await this.recover(id);
      return;
    }
    r.stopping = true;
    this.finish(r, failure());
    // Adopt the proof before sending STOP: close may remove the leader while
    // descendants remain in our already-verified, still-owned process group.
    r.browser ??= this.checkedBrowser(id, true);
    try {
      r.child.send({ type: 'STOP', runId: id });
    } catch {
      /* Closed IPC still needs group teardown. */
    }
    await this.teardown(id, [r.worker, ...(r.browser ? [r.browser] : [])], true);
    this.records.delete(id);
  }
  async stopAll() {
    for (const id of [...this.provisional.keys()]) await this.clearProvisional(id);
    for (const id of [...this.records.keys()]) await this.stop(id);
  }
  private async clearProvisional(id: string) {
    const pid = this.provisional.get(id);
    if (!pid) return;
    signal(pid, 'SIGKILL');
    const deadline = Date.now() + (this.options.killGraceMs ?? 2000);
    while (groupAlive(pid) && Date.now() < deadline) await sleep(25);
    if (groupAlive(pid)) throw new Error('Unregistered discovery worker survived teardown.');
    this.provisional.delete(id);
  }
  private checkedBrowser(id: string, allowPending = false): DiscoveryProcessProof | undefined {
    const browser = this.ownership.read(id, 'browser');
    const original = readBrowserProcessIdentity(id);
    if (browser) {
      const alive = this.ownership.alive(browser);
      if (original && (original.pid !== browser.pid || original.pgid !== browser.pgid))
        throw new Error('Browser ownership mismatch.');
      return alive ? browser : undefined;
    }
    if (original) {
      if (groupAlive(original.pgid)) {
        if (allowPending) return undefined;
        throw new PendingBrowserLaunchError('Browser recovery proof unavailable.');
      }
      return undefined;
    }
    if (this.ownership.files.get(`${id}.launching`)) {
      if (allowPending) return undefined;
      throw new PendingBrowserLaunchError('Browser launch ownership unresolved.');
    }
    return undefined;
  }
  async recover(id: string) {
    if (!uuid(id)) throw new Error('Invalid discovery ownership ID.');
    if (this.records.has(id)) {
      await this.stop(id);
      return;
    }
    const worker = this.ownership.read(id, 'worker');
    const workerAlive = worker && this.ownership.alive(worker);
    const browser = this.checkedBrowser(id, true);
    await this.teardown(
      id,
      [...(workerAlive ? [worker] : []), ...(browser ? [browser] : [])],
      false,
    );
  }
  private async teardown(id: string, proofs: DiscoveryProcessProof[], graceful: boolean) {
    // The worker may still be producing a detached launch when STOP is sent.
    // Quiesce all known groups first, then inventory late launcher evidence.
    await this.stopGroups(proofs, graceful);
    const deadline = Date.now() + (this.options.graceMs ?? 5000);
    let browser: DiscoveryProcessProof | undefined;
    for (;;) {
      try {
        browser = this.checkedBrowser(id);
        break;
      } catch (e) {
        if (!(e instanceof PendingBrowserLaunchError) || Date.now() >= deadline) throw e;
        await sleep(25);
      }
    }
    if (browser) await this.stopGroups([browser], false);
    if (proofs.some((p) => groupAlive(p.pgid)) || this.checkedBrowser(id))
      throw new Error('Discovery ownership unresolved.');
    // Keep every record/marker on unresolved launch or surviving group. Only a
    // stopped worker and proven absent browser permit the manager to release.
    this.ownership.remove(id, 'worker');
    this.ownership.remove(id, 'browser');
    this.ownership.files.remove(`${id}.launching`);
    removeBrowserIdentityFile(id);
  }
  private async stopGroups(proofs: DiscoveryProcessProof[], graceful: boolean) {
    // Proofs were validated on adoption; subsequent polls include descendants,
    // even when the original leader exits during our own teardown.
    const alive = () => proofs.some((p) => groupAlive(p.pgid));
    const wait = async (ms: number) => {
      const end = Date.now() + ms;
      while (alive() && Date.now() < end) await sleep(25);
      return !alive();
    };
    const grace = this.options.graceMs ?? 5000,
      forced = this.options.killGraceMs ?? 2000;
    if (!graceful || !(await wait(grace))) {
      for (const p of proofs) if (groupAlive(p.pgid)) signal(p.pgid, 'SIGTERM');
      if (!(await wait(forced))) {
        for (const p of proofs) if (groupAlive(p.pgid)) signal(p.pgid, 'SIGKILL');
        if (!(await wait(forced))) throw new Error('Discovery process group survived teardown.');
      }
    }
    if (alive()) throw new Error('Discovery ownership unresolved.');
  }
}
