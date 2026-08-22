import { createServer, type Server } from 'node:http';

import { BrowserSession, resolveBrowserSessionConfig } from '../src/index.js';

const STORAGE_KEY = 'sparkkeeper.m1.persistent-profile';
const TEST_PAGE = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>SparkKeeper M1 Smoke</title></head>
  <body><main>Persistent profile smoke test</main></body>
</html>`;

interface TestServer {
  readonly origin: string;
  close(): Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(TEST_PAGE);
  });

  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Smoke test server did not expose a TCP address.');
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };

    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}

async function main(): Promise<void> {
  const config = resolveBrowserSessionConfig();
  const testServer = await startTestServer();
  const stateValue = `verified-${Date.now()}`;
  let session: BrowserSession | undefined;

  try {
    console.info('First launch: starting persistent Chromium');
    session = new BrowserSession(config);
    const first = await session.start();
    await first.page.goto(testServer.origin);
    await first.page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: STORAGE_KEY,
      value: stateValue,
    });
    console.info('First launch: test state written');
    await session.close();
    session = undefined;
    console.info('First launch: closed');

    console.info('Second launch: starting with the same profile');
    session = new BrowserSession(config);
    const second = await session.start();
    await second.page.goto(testServer.origin);
    const restoredValue = await second.page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_KEY,
    );

    if (restoredValue !== stateValue) {
      throw new Error('Persistent profile state was not restored on the second launch.');
    }

    console.info('Second launch: previous state restored');
    await session.close();
    session = undefined;
    console.info('Second launch: closed');
    console.info('Persistent profile verified');
  } finally {
    await session?.close();
    await testServer.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown smoke test failure';
  console.error(`Persistent profile smoke test failed: ${message}`);
  process.exitCode = 1;
});
