export const REPOSITORY_ERROR_CODES = [
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_TRANSITION',
  'ACCOUNT_MISMATCH',
  'UNSUPPORTED_TARGET_TYPE',
  'INVALID_TARGET',
  'IDENTITY_CONFLICT',
  'TERMINAL_STATE',
  'IDEMPOTENCY_CONFLICT',
  'VALIDATION_ERROR',
  'INTEGRITY_ERROR',
] as const;

export type RepositoryErrorCode = (typeof REPOSITORY_ERROR_CODES)[number];

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly entityName?: string | undefined;
  readonly operation?: string | undefined;

  constructor(
    code: RepositoryErrorCode,
    message: string,
    options?: { entityName?: string; operation?: string; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'RepositoryError';
    this.code = code;
    this.entityName = options?.entityName;
    this.operation = options?.operation;
  }
}
