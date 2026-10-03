import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ContactDiscoveryWorkerSupervisor } from '../src/contacts/ContactDiscoveryWorkerSupervisor.js';
import { BrowserOperationCoordinator } from '../src/onboarding/BrowserOperationCoordinator.js';
import {
  prepareBrowserIdentityFile,
  readBrowserProcessIdentity,
} from '../src/onboarding/BrowserProcessIdentity.js';

for (const mode of ['stop', 'recover'] as const)
  test(
    `Linux ${mode} adopts proof published after worker exit before releasing ownership`,
    { skip: process.platform !== 'linux', timeout: 10000 },
    async (t) => {
      const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-late-launch-')));
      const runId = randomUUID();
      const accountId = randomUUID();
      const ownershipModule = new URL(
        '../src/contacts/DiscoveryProcessOwnership.ts',
        import.meta.url,
      ).href;
      const filesModule = new URL('../src/contacts/ContactFiles.ts', import.meta.url).href;
      // A real separately detached browser-shaped process starts before worker
      // exit, but publishes its proof later. No Chromium or site is started.
      const browserCode = `import {DiscoveryProcessOwnership} from ${JSON.stringify(ownershipModule)};
        import {ContactFiles} from ${JSON.stringify(filesModule)};
        process.on('SIGTERM',()=>{});
        setTimeout(()=>new DiscoveryProcessOwnership(new ContactFiles(${JSON.stringify(root)})).write(${JSON.stringify(runId)},process.pid,'browser'),350);
        setInterval(()=>{},1000);`;
      const workerCode = `import {spawn} from 'node:child_process';
        import {ContactFiles} from ${JSON.stringify(filesModule)};
        let stopping=false;
        function stop(){if(stopping)return;stopping=true;
          new ContactFiles(${JSON.stringify(root)}).put(${JSON.stringify(`${runId}.launching`)},Buffer.from(${JSON.stringify(runId)}));
          const browser=spawn(process.execPath,['--import','tsx','--input-type=module','-e',${JSON.stringify(browserCode)}],{detached:true,stdio:'ignore'});
          process.stdout.write(JSON.stringify({pid:browser.pid})+'\\n',()=>process.exit(0));
        }
        process.on('message',m=>m.type==='STOP'?stop():process.stdout.write('ready\\n'));
        process.on('SIGTERM',stop);setInterval(()=>{},1000);`;
      const worker = spawn(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', workerCode],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
        },
      );
      const exited = once(worker, 'exit');
      const ready = once(worker.stdout!, 'data');
      let browserPid: number | undefined = undefined;
      t.after(async () => {
        for (const pid of [worker.pid, browserPid]) {
          if (!pid) continue;
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            /* already absent */
          }
        }
        await exited;
        rmSync(root, { recursive: true, force: true });
      });
      const supervisor = new ContactDiscoveryWorkerSupervisor(root, {
        spawn: () => worker,
        graceMs: 1500,
        killGraceMs: 1000,
      });
      let outcome: Promise<unknown> | undefined;
      if (mode === 'stop') {
        outcome = supervisor.start({
          type: 'START',
          runId,
          accountId,
          runtimeRoot: root,
          profilePath: root,
          deadline: Date.now() + 5000,
          expected: { secUid: null, uniqueId: null },
        });
      } else {
        supervisor.ownership.write(runId, worker.pid!, 'worker');
        worker.send({ type: 'START' });
      }
      await ready;
      assert.equal(supervisor.ownership.files.get(`${runId}.launching`), undefined);
      const coordinator = new BrowserOperationCoordinator();
      const lease = coordinator.acquire(runId, accountId)!;
      const launched = once(worker.stdout!, 'data');
      let released = false;
      const cleanup = (mode === 'stop' ? supervisor.stop(runId) : supervisor.recover(runId)).then(
        () => {
          lease.release();
          released = true;
        },
      );
      const [bytes] = await launched;
      browserPid = JSON.parse(String(bytes)).pid as number;
      assert.ok(browserPid > 1);
      await exited;
      assert.equal(released, false);
      assert.equal(coordinator.isHeldBy(runId), true);
      assert.ok(supervisor.ownership.files.get(`${runId}.launching`));
      const deadline = Date.now() + 3000;
      while (!supervisor.ownership.read(runId, 'browser') && Date.now() < deadline)
        await new Promise<void>((r) => setTimeout(r, 25));
      assert.equal(supervisor.ownership.read(runId, 'browser')?.pid, browserPid);
      assert.equal(released, false);
      assert.equal(coordinator.isHeldBy(runId), true);
      await cleanup;
      await outcome;
      assert.throws(
        () => process.kill(-browserPid!, 0),
        (e: unknown) => (e as NodeJS.ErrnoException).code === 'ESRCH',
      );
      assert.deepEqual(supervisor.inventory(), []);
      assert.equal(coordinator.isHeldBy(runId), false);
    },
  );

test('unresolved late launch preserves marker and lease instead of permitting replacement', async (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-unresolved-launch-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const id = randomUUID();
  const supervisor = new ContactDiscoveryWorkerSupervisor(root, { graceMs: 25 });
  const coordinator = new BrowserOperationCoordinator();
  const lease = coordinator.acquire(id, randomUUID())!;
  supervisor.ownership.files.put(`${id}.launching`, Buffer.from(id));
  await assert.rejects(supervisor.recover(id).then(() => lease.release()));
  assert.equal(supervisor.ownership.files.get(`${id}.launching`)?.toString(), id);
  assert.equal(coordinator.isHeldBy(id), true);
  assert.equal(coordinator.acquire(randomUUID(), randomUUID()), undefined);
});

test(
  'real Linux detached worker + Chromium-shaped group recovery kills hung children before clearing ownership',
  { skip: process.platform !== 'linux', timeout: 15000 },
  async (t) => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-discovery-process-')));
    const runId = randomUUID();
    const supervisor = new ContactDiscoveryWorkerSupervisor(root, {
      graceMs: 25,
      killGraceMs: 2000,
    });
    // Each detached leader owns a real hung grandchild in the same PGID. The
    // leader reaps its child on TERM but itself requires the supervisor's KILL;
    // no test relies on an arbitrary host PID1 to reap orphan zombies.
    const code = `const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
      process.on('SIGTERM',()=>child.kill('SIGKILL'));
      process.stdout.write(String(child.pid)+'\\n');setInterval(()=>{},1000);`;
    const worker = spawn(process.execPath, ['-e', code], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const browser = spawn(
      fileURLToPath(new URL('../dist/native/chromium-launcher', import.meta.url)),
      ['-e', code],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          ...process.env,
          SPARKKEEPER_CHROMIUM_EXECUTABLE: process.execPath,
          SPARKKEEPER_CHROMIUM_IDENTITY_FILE: prepareBrowserIdentityFile(runId),
          SPARKKEEPER_DISCOVERY_PROOF_PATH: path.join(root, `${runId}.browser`),
          SPARKKEEPER_DISCOVERY_RUN_ID: runId,
        },
      },
    );
    const exits = [once(worker, 'exit'), once(browser, 'exit')];
    t.after(async () => {
      for (const child of [worker, browser]) {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          /* already absent */
        }
      }
      await Promise.all(exits);
      rmSync(root, { recursive: true, force: true });
    });
    const childPids = (
      await Promise.all([once(worker.stdout!, 'data'), once(browser.stdout!, 'data')])
    ).map(([bytes]) => Number(String(bytes).trim()));
    for (const pid of childPids) assert.ok(Number.isSafeInteger(pid) && pid > 1);
    supervisor.ownership.write(runId, worker.pid!, 'worker');
    assert.equal(supervisor.ownership.read(runId, 'browser')?.pid, browser.pid);
    assert.equal(readBrowserProcessIdentity(runId)?.pid, browser.pid);
    supervisor.ownership.files.put(`${runId}.launching`, Buffer.from(runId));
    assert.deepEqual(supervisor.inventory(), [runId]);
    // New supervisor instance is restart recovery, not a retained in-memory PGID.
    const restarted = new ContactDiscoveryWorkerSupervisor(root, {
      graceMs: 25,
      killGraceMs: 2000,
    });
    await restarted.recover(runId);
    await Promise.all(exits);
    for (const child of [worker, browser])
      assert.throws(
        () => process.kill(-child.pid!, 0),
        (e: unknown) => (e as NodeJS.ErrnoException).code === 'ESRCH',
      );
    for (const pid of childPids)
      assert.throws(
        () => process.kill(pid, 0),
        (e: unknown) => (e as NodeJS.ErrnoException).code === 'ESRCH',
      );
    assert.deepEqual(restarted.inventory(), []);
    assert.equal(readBrowserProcessIdentity(runId), undefined);
  },
);
test('non-Linux production discovery is explicitly fail closed', async (t) => {
  if (process.platform === 'linux') return;
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'sparkkeeper-discovery-platform-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const supervisor = new ContactDiscoveryWorkerSupervisor(root);
  assert.equal(supervisor.runtimeAvailable, false);
  await assert.rejects(
    supervisor.start({
      type: 'START',
      runId: randomUUID(),
      accountId: randomUUID(),
      runtimeRoot: root,
      profilePath: root,
      deadline: Date.now() + 1000,
      expected: { secUid: null, uniqueId: null },
    }),
  );
  assert.deepEqual(supervisor.inventory(), []);
});
