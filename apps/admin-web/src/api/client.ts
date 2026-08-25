import type { ApiFailure } from '../types/api';
import type { Parser } from './parsers';

export type ApiErrorKind = 'API' | 'NETWORK' | 'ABORT' | 'MALFORMED';

export class ApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly kind: ApiErrorKind;

  constructor(code: string, message: string, httpStatus: number, kind: ApiErrorKind) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.kind = kind;
  }
}

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const ADMIN_MUTATION_HEADER = 'X-SparkKeeper-Admin-Request';
export const ADMIN_MUTATION_HEADER_VALUE = '1';

export function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return (trimmed === undefined || trimmed === '' ? '/api' : trimmed).replace(/\/$/, '');
}

function parseFailure(value: unknown): ApiFailure | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.success !== false ||
    typeof candidate.error !== 'object' ||
    candidate.error === null
  ) {
    return undefined;
  }
  const error = candidate.error as Record<string, unknown>;
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return undefined;
  return { success: false, error: { code: error.code, message: error.message } };
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;

  constructor(
    baseUrl = import.meta.env.VITE_API_BASE_URL,
    fetchImplementation?: FetchImplementation,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImplementation =
      fetchImplementation ?? ((input, init) => globalThis.fetch(input, init));
  }

  async get<T>(path: string, parser: Parser<T>, signal?: AbortSignal): Promise<T> {
    return this.request('GET', path, parser, signal);
  }

  async mutate<T, TBody>(
    method: 'POST' | 'PATCH' | 'PUT',
    path: string,
    body: TBody,
    parser: Parser<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.request(method, path, parser, signal, body);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    parser: Parser<T>,
    signal?: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        headers:
          method === 'GET'
            ? { Accept: 'application/json' }
            : {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                [ADMIN_MUTATION_HEADER]: ADMIN_MUTATION_HEADER_VALUE,
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw new ApiError('REQUEST_ABORTED', 'Request cancelled.', 0, 'ABORT');
      }
      throw new ApiError('NETWORK_ERROR', 'Unable to reach SparkKeeper.', 0, 'NETWORK');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        'MALFORMED_RESPONSE',
        'The server returned an invalid response.',
        response.status,
        'MALFORMED',
      );
    }

    const failure = parseFailure(payload);
    if (failure !== undefined) {
      throw new ApiError(failure.error.code, failure.error.message, response.status, 'API');
    }

    if (!response.ok) {
      throw new ApiError(
        'HTTP_ERROR',
        'The request could not be completed.',
        response.status,
        'MALFORMED',
      );
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new ApiError(
        'MALFORMED_RESPONSE',
        'The server returned an invalid response.',
        response.status,
        'MALFORMED',
      );
    }
    const envelope = payload as Record<string, unknown>;
    if (envelope.success !== true || !Object.hasOwn(envelope, 'data')) {
      throw new ApiError(
        'MALFORMED_RESPONSE',
        'The server returned an invalid response.',
        response.status,
        'MALFORMED',
      );
    }
    const parsed = parser(envelope.data);
    if (parsed === undefined) {
      throw new ApiError(
        'MALFORMED_RESPONSE',
        'The server returned an invalid response.',
        response.status,
        'MALFORMED',
      );
    }
    return parsed;
  }
}
