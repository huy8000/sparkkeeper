import type { ApiFailure } from '../types/api';
import type { Parser } from './parsers';

export type ApiErrorKind = 'API' | 'NETWORK' | 'ABORT' | 'MALFORMED';

export class ApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly kind: ApiErrorKind;
  readonly retryAfter?: number | undefined;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    kind: ApiErrorKind,
    retryAfter?: number | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'httpStatus' in error &&
      'kind' in error)
  );
}

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const CSRF_HEADER = 'X-SparkKeeper-CSRF';
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
  const retryAfter =
    typeof error.retryAfter === 'number' && Number.isFinite(error.retryAfter)
      ? error.retryAfter
      : undefined;
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(retryAfter !== undefined ? { retryAfter } : {}),
    },
  };
}

function parseRetryAfterHeader(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export interface ApiClientOptions {
  readonly baseUrl?: string | undefined;
  readonly fetchImplementation?: FetchImplementation | undefined;
  readonly csrfTokenProvider?: (() => string | null) | undefined;
  readonly onUnauthenticated?: ((error: ApiError) => void) | undefined;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly csrfTokenProvider?: (() => string | null) | undefined;
  private readonly onUnauthenticated?: ((error: ApiError) => void) | undefined;

  constructor(
    optionsOrBaseUrl?: ApiClientOptions | string,
    fetchImplementation?: FetchImplementation,
  ) {
    if (typeof optionsOrBaseUrl === 'string' || optionsOrBaseUrl === undefined) {
      this.baseUrl = normalizeBaseUrl(optionsOrBaseUrl);
      this.fetchImplementation =
        fetchImplementation ?? ((input, init) => globalThis.fetch(input, init));
    } else {
      this.baseUrl = normalizeBaseUrl(
        optionsOrBaseUrl.baseUrl ?? import.meta.env.VITE_API_BASE_URL,
      );
      this.fetchImplementation =
        optionsOrBaseUrl.fetchImplementation ??
        fetchImplementation ??
        ((input, init) => globalThis.fetch(input, init));
      this.csrfTokenProvider = optionsOrBaseUrl.csrfTokenProvider;
      this.onUnauthenticated = optionsOrBaseUrl.onUnauthenticated;
    }
  }

  async get<T>(path: string, parser: Parser<T>, signal?: AbortSignal): Promise<T> {
    return this.request('GET', path, parser, signal);
  }

  async login<T, TBody>(
    path: string,
    body: TBody,
    parser: Parser<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.request('POST', path, parser, signal, body, { isLogin: true });
  }

  async mutate<T, TBody>(
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body: TBody,
    parser: Parser<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.request(method, path, parser, signal, body);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    parser: Parser<T>,
    signal?: AbortSignal,
    body?: unknown,
    options?: { readonly isLogin?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      if (!options?.isLogin) {
        headers[ADMIN_MUTATION_HEADER] = ADMIN_MUTATION_HEADER_VALUE;
        const csrfToken = this.csrfTokenProvider?.();
        if (csrfToken) {
          headers[CSRF_HEADER] = csrfToken;
        }
      }
    }

    let response: Response;
    try {
      response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method,
        credentials: 'same-origin',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw new ApiError('REQUEST_ABORTED', 'Request cancelled.', 0, 'ABORT');
      }
      throw new ApiError('NETWORK_ERROR', 'Unable to reach SparkKeeper.', 0, 'NETWORK');
    }

    const retryAfter = parseRetryAfterHeader(response.headers.get('retry-after'));

    // Handle 204 No Content (e.g. logout)
    if (response.status === 204) {
      const parsed = parser(undefined);
      return parsed as T;
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
        retryAfter,
      );
    }

    const failure = parseFailure(payload);
    if (failure !== undefined) {
      const effectiveRetryAfter = failure.error.retryAfter ?? retryAfter;
      const apiError = new ApiError(
        failure.error.code,
        failure.error.message,
        response.status,
        'API',
        effectiveRetryAfter,
      );

      if (response.status === 401 && path !== '/auth/me') {
        this.onUnauthenticated?.(apiError);
      }

      throw apiError;
    }

    if (!response.ok) {
      const apiError = new ApiError(
        'HTTP_ERROR',
        'The request could not be completed.',
        response.status,
        'MALFORMED',
        retryAfter,
      );
      if (response.status === 401 && path !== '/auth/me') {
        this.onUnauthenticated?.(apiError);
      }
      throw apiError;
    }

    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      throw new ApiError(
        'MALFORMED_RESPONSE',
        'The server returned an invalid response.',
        response.status,
        'MALFORMED',
        retryAfter,
      );
    }
    const envelope = payload as Record<string, unknown>;
    if (envelope.success !== true || !Object.hasOwn(envelope, 'data')) {
      throw new ApiError(
        'MALFORMED_RESPONSE',
        'The server returned an invalid response.',
        response.status,
        'MALFORMED',
        retryAfter,
      );
    }
    const parsed = parser(envelope.data);
    if (parsed === undefined) {
      throw new ApiError(
        'MALFORMED_RESPONSE',
        'The server returned an invalid response.',
        response.status,
        'MALFORMED',
        retryAfter,
      );
    }
    return parsed;
  }
}
