import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** No filesystem path from HTTP. All mutations are anchored native *at operations. */
export class ContactFiles {
  private readonly helper = fileURLToPath(
    new URL('../../dist/native/contact-files', import.meta.url),
  );
  constructor(readonly root: string) {
    this.call('init');
  }
  private call(op: string, name?: string, input?: Buffer) {
    const r = spawnSync(this.helper, [op, this.root, ...(name ? [name] : [])], {
      input,
      maxBuffer: 6 * 1024 * 1024,
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.error || ![0, 66, 67].includes(r.status ?? -1))
      throw new Error('Managed contact filesystem operation failed.');
    return r;
  }
  put(name: string, bytes: Buffer): boolean {
    const r = this.call('put', name, bytes);
    return r.status === 0;
  }
  get(name: string): Buffer | undefined {
    const r = this.call('get', name);
    return r.status === 67 ? undefined : r.stdout;
  }
  remove(name: string): void {
    this.call('remove', name);
  }
  modifiedAt(name: string): number | undefined {
    const r = this.call('stat', name);
    return r.status === 67 ? undefined : Number(r.stdout.toString('utf8').trim()) * 1000;
  }
  list(): string[] {
    return this.call('list').stdout.toString('utf8').split('\n').filter(Boolean);
  }
}
