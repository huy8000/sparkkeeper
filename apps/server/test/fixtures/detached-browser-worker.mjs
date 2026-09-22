import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let started = false;

process.on('SIGTERM', () => undefined);
process.on('message', (message) => {
  if (started || message?.type !== 'START') return;
  started = true;
  const display = Number(process.env.SPARKKEEPER_TEST_DISPLAY);
  mkdirSync(path.join(os.tmpdir(), 'sparkkeeper-display-locks', `display-${display}`), {
    recursive: true,
    mode: 0o700,
  });
  process.send?.({ type: 'WORKER_STARTED', sessionId: message.sessionId, display });
  process.send?.({ type: 'BROWSER_LAUNCHING', sessionId: message.sessionId });

  const browser = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { detached: true, stdio: 'ignore' },
  );
  if (browser.pid === undefined) process.exit(2);
  process.send?.({
    type: 'BROWSER_STARTED',
    sessionId: message.sessionId,
    browserPid: browser.pid,
    browserPgid: browser.pid,
  });
});

setInterval(() => undefined, 1_000);
