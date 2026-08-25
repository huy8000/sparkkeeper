import { vi } from 'vitest';

import {
  ACCOUNT_ID,
  FRIEND_ID,
  RUN_ID,
  TEMPLATE_ID,
  accountFixture,
  friendFixture,
  healthFixture,
  runFixture,
  runtimeFixture,
  scheduleFixture,
  sendRecordFixture,
  systemEventFixture,
  templateDetailFixture,
  templateSummaryFixture,
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
    const method = init?.method ?? 'GET';
    switch (`${method} ${url.pathname}`) {
      case 'GET /api/health':
        return success(healthFixture);
      case 'GET /api/runtime/status':
        return success(runtimeFixture);
      case 'GET /api/accounts':
        return success([accountFixture]);
      case 'POST /api/accounts':
        return success(accountFixture, 201);
      case `GET /api/accounts/${ACCOUNT_ID}`:
      case `PATCH /api/accounts/${ACCOUNT_ID}`:
        return success(accountFixture);
      case `GET /api/accounts/${ACCOUNT_ID}/friends`:
        return success([friendFixture]);
      case `POST /api/accounts/${ACCOUNT_ID}/friends`:
      case `PATCH /api/friends/${FRIEND_ID}`:
        return success(friendFixture, method === 'POST' ? 201 : 200);
      case `GET /api/accounts/${ACCOUNT_ID}/schedules`:
        return success([scheduleFixture]);
      case `PUT /api/accounts/${ACCOUNT_ID}/schedule`:
        return success(scheduleFixture);
      case 'GET /api/templates':
        return success([templateSummaryFixture]);
      case `GET /api/templates/${TEMPLATE_ID}`:
        return success(templateDetailFixture);
      case 'POST /api/templates':
        return success(templateDetailFixture, 201);
      case `PATCH /api/templates/${TEMPLATE_ID}`:
        return success(templateDetailFixture);
      case 'GET /api/runs':
        return success([runFixture]);
      case `GET /api/runs/${RUN_ID}`:
        return success(runFixture);
      case `GET /api/runs/${RUN_ID}/send-records`:
        return success([sendRecordFixture]);
      case `GET /api/runs/${RUN_ID}/events`:
        return success([systemEventFixture]);
      default:
        return failure('ROUTE_NOT_FOUND', 'Route not found.', 404);
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
