import type { ApiErrorCode } from '../errors/ApiError.js';

export interface SuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
}

export interface ErrorEnvelope {
  readonly success: false;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
  };
}

export function success<T>(data: T): SuccessEnvelope<T> {
  return { success: true, data };
}

export function failure(code: ApiErrorCode, message: string): ErrorEnvelope {
  return { success: false, error: { code, message } };
}
