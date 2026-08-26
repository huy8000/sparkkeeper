import { describe, expect, it, vi } from 'vitest';

import { accountFixture } from '../test/fixtures';
import { ADMIN_MUTATION_HEADER, ADMIN_MUTATION_HEADER_VALUE, ApiClient, ApiError } from './client';
import { parseAccount } from './parsers';
import { createSparkKeeperApi } from './sparkkeeperApi';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiClient', () => {
  it('parses a successful envelope through an allowlisted DTO parser', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(jsonResponse({ success: true, data: accountFixture })),
    );
    const client = new ApiClient('/api', fetcher);

    await expect(client.get('/accounts/test', parseAccount)).resolves.toEqual(accountFixture);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/accounts/test',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('surfaces a safe API error envelope with HTTP status', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { success: false, error: { code: 'NOT_FOUND', message: 'Account not found.' } },
          404,
        ),
      ),
    );
    const client = new ApiClient('/api', fetcher);

    await expect(client.get('/accounts/test', parseAccount)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Account not found.',
      httpStatus: 404,
      kind: 'API',
    });
  });

  it('distinguishes network failure without exposing the raw exception', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('PRIVATE_STACK_SENTINEL')));
    const client = new ApiClient('/api', fetcher);

    await expect(client.get('/accounts/test', parseAccount)).rejects.toEqual(
      expect.objectContaining({
        code: 'NETWORK_ERROR',
        kind: 'NETWORK',
        message: 'Unable to reach SparkKeeper.',
      }),
    );
  });

  it('supports AbortSignal and reports a cancellation separately', async () => {
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const client = new ApiClient('/api', fetcher);
    const controller = new AbortController();
    const request = client.get('/accounts/test', parseAccount, controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: 'REQUEST_ABORTED', kind: 'ABORT' });
  });

  it('fails safely when a success envelope is malformed', async () => {
    const fetcher = vi.fn(() => Promise.resolve(jsonResponse({ success: true, data: { id: 42 } })));
    const client = new ApiClient('/api', fetcher);

    await expect(client.get('/accounts/test', parseAccount)).rejects.toEqual(
      expect.objectContaining({ code: 'MALFORMED_RESPONSE', kind: 'MALFORMED' }),
    );
  });

  it('encodes the supported run filters and bounded limit only', async () => {
    const fetcher = vi.fn(() => Promise.resolve(jsonResponse({ success: true, data: [] })));
    const api = createSparkKeeperApi('/api', fetcher);
    await api.listRuns({
      accountId: 'test account',
      businessDate: '2026-01-02',
      status: 'FAILED',
      limit: 100,
    });

    expect(fetcher).toHaveBeenCalledWith(
      '/api/runs?accountId=test+account&businessDate=2026-01-02&status=FAILED&limit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses the safe same-origin API prefix by default', () => {
    const error = new ApiError('TEST', 'test', 0, 'API');
    expect(error).toMatchObject({ name: 'ApiError', code: 'TEST' });
  });

  it('centralizes JSON mutation bodies and the local Admin request header', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(jsonResponse({ success: true, data: accountFixture }, 201)),
    );
    const client = new ApiClient('/api', fetcher);
    const controller = new AbortController();
    await client.mutate(
      'POST',
      '/accounts',
      { name: 'Demo Account' },
      parseAccount,
      controller.signal,
    );

    expect(fetcher).toHaveBeenCalledWith(
      '/api/accounts',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Demo Account' }),
        signal: controller.signal,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          [ADMIN_MUTATION_HEADER]: ADMIN_MUTATION_HEADER_VALUE,
        }),
      }),
    );
  });

  it('preserves typed safe API errors for mutations', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid configuration.' },
          },
          400,
        ),
      ),
    );
    const client = new ApiClient('/api', fetcher);
    await expect(
      client.mutate('PATCH', '/accounts/test', { enabled: false }, parseAccount),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400, kind: 'API' });
  });
});
