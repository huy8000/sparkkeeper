import { readFileSync } from 'node:fs';
import { ContactFiles } from './ContactFiles.js';

export interface DiscoveryProcessProof {
  runId: string;
  pid: number;
  pgid: number;
  start: string;
  boot: string;
}
export function processProof(runId: string, pid: number): DiscoveryProcessProof {
  if (process.platform !== 'linux' || !Number.isSafeInteger(pid) || pid <= 1)
    throw new Error('Discovery process isolation unavailable.');
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/u);
  const pgid = Number(fields[2]);
  const start = fields[19];
  if (pgid !== pid || !start || !/^\d+$/u.test(start))
    throw new Error('Discovery process proof unavailable.');
  return {
    runId,
    pid,
    pgid,
    start,
    boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
  };
}
export class DiscoveryProcessOwnership {
  constructor(readonly files: ContactFiles) {}
  write(runId: string, pid: number, kind: 'worker' | 'browser') {
    const proof = processProof(runId, pid);
    if (!this.files.put(`${runId}.${kind}`, Buffer.from(JSON.stringify(proof))))
      throw new Error('Discovery process identity exists.');
    return proof;
  }
  read(runId: string, kind: 'worker' | 'browser'): DiscoveryProcessProof | undefined {
    const bytes = this.files.get(`${runId}.${kind}`);
    if (!bytes) return undefined;
    if (bytes.length > 1024) throw new Error('Invalid discovery ownership.');
    const p = JSON.parse(bytes.toString('utf8')) as DiscoveryProcessProof;
    if (
      p.runId !== runId ||
      !Number.isSafeInteger(p.pid) ||
      p.pid <= 1 ||
      p.pgid !== p.pid ||
      typeof p.start !== 'string' ||
      !/^\d+$/u.test(p.start) ||
      typeof p.boot !== 'string' ||
      !/^[0-9a-f-]{36}$/u.test(p.boot)
    )
      throw new Error('Invalid discovery ownership.');
    return p;
  }
  alive(proof: DiscoveryProcessProof): boolean {
    if (process.platform !== 'linux') throw new Error('Discovery process isolation unavailable.');
    if (readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() !== proof.boot) return false;
    try {
      process.kill(-proof.pgid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ESRCH') return false;
      // eslint-disable-next-line preserve-caught-error -- Do not expose raw process diagnostics.
      throw new Error('Unresolved discovery process group.');
    }
    const current = processProof(proof.runId, proof.pid);
    if (current.start !== proof.start || current.boot !== proof.boot)
      throw new Error('Unresolved discovery process ownership.');
    return true;
  }
  signal(proof: DiscoveryProcessProof, signal: NodeJS.Signals) {
    if (this.alive(proof)) {
      try {
        process.kill(-proof.pgid, signal);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
    }
  }
  remove(runId: string, kind: 'worker' | 'browser') {
    const p = this.read(runId, kind);
    if (p && this.alive(p)) throw new Error('Discovery group still alive.');
    this.files.remove(`${runId}.${kind}`);
  }
  inventory(): string[] {
    const ids = new Set<string>();
    for (const name of this.files.list()) {
      const match = /^([0-9a-f-]{36})\.(worker|browser|launching)$/u.exec(name);
      if (!match) throw new Error('Unassociated discovery ownership.');
      ids.add(match[1]!);
    }
    return [...ids];
  }
}
