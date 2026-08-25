import { pathToFileURL } from 'node:url';

import { SparkKeeperService } from './lifecycle/SparkKeeperService.js';

export async function runMain(): Promise<void> {
  const service = new SparkKeeperService();
  await service.start();

  let shutdownRequested = false;
  const shutdown = async (): Promise<void> => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    try {
      await service.stop();
    } catch {
      process.exitCode = 1;
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown();
    });
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  try {
    await runMain();
  } catch {
    process.stderr.write('SparkKeeper server failed to start.\n');
    process.exitCode = 1;
  }
}
