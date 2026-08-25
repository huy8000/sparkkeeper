import { vi } from 'vitest';

import {
  ACCOUNT_ID,
  RUN_ID,
  accountFixture,
  friendFixture,
  healthFixture,
  runFixture,
  runtimeFixture,
  scheduleFixture,
  sendRecordFixture,
  systemEventFixture,
} from './fixtures';

export function success(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function failure(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export type TestHandler = (
  url: URL,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

export function installApiFetch(override?: TestHandler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    const overridden = override?.(url, init);
    if (overridden !== undefined) return overridden;
    switch (url.pathname) {
      case '/api/health':
        return success(healthFixture);
      case '/api/runtime/status':
        return success(runtimeFixture);
      case '/api/accounts':
        return success([accountFixture]);
      case `/api/accounts/${ACCOUNT_ID}`:
        return success(accountFixture);
      case `/api/accounts/${ACCOUNT_ID}/friends`:
        return success([friendFixture]);
      case `/api/accounts/${ACCOUNT_ID}/schedules`:
        return success([scheduleFixture]);
      case '/api/runs':
        return success([runFixture]);
      case `/api/runs/${RUN_ID}`:
        return success(runFixture);
      case `/api/runs/${RUN_ID}/send-records`:
        return success([sendRecordFixture]);
      case `/api/runs/${RUN_ID}/events`:
        return success([systemEventFixture]);
      default:
        return failure('ROUTE_NOT_FOUND', 'Route not found.', 404);
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
