export type ApiErrorCode =
  | 'TARGET_NOT_ELIGIBLE'
  | 'INTENT_NOT_FOUND'
  | 'INTENT_EXPIRED'
  | 'INTENT_CHANGED'
  | 'INTENT_CONSUMED'
  | 'INTENT_LIMIT'
  | 'TEST_SEND_NOT_FOUND'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_NOT_READY'
  | 'CONTACT_NOT_FOUND'
  | 'CONTACT_SYNC_NOT_FOUND'
  | 'AVATAR_NOT_FOUND'
  | 'FRIEND_NOT_FOUND'
  | 'SCHEDULE_NOT_FOUND'
  | 'TEMPLATE_NOT_FOUND'
  | 'ADMIN_REQUEST_REQUIRED'
  | 'ADMIN_REQUEST_REJECTED'
  | 'EVENT_STREAM_REJECTED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'CONFLICT'
  | 'MANUAL_RUN_FORBIDDEN'
  | 'MANUAL_RUN_BLOCKED'
  | 'MANUAL_RUN_UNAVAILABLE'
  | 'REAL_SEND_ACKNOWLEDGEMENT_REQUIRED'
  | 'RUN_ALREADY_IN_PROGRESS'
  | 'RUN_ALREADY_COMPLETE'
  | 'RUN_TERMINAL'
  | 'WEBHOOK_DESTINATION_BLOCKED'
  | 'RUN_NOT_FOUND'
  | 'LOGIN_SESSION_NOT_FOUND'
  | 'LOGIN_SESSION_ACTIVE'
  | 'LOGIN_SESSION_EXPIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'STATE_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'PROFILE_BUSY'
  | 'IDENTITY_UNAVAILABLE'
  | 'IDENTITY_CONFLICT'
  | 'RUNTIME_UNAVAILABLE'
  | 'RELEASE_GATE_CLOSED'
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHENTICATED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'ORIGIN_REJECTED'
  | 'CSRF_REJECTED'
  | 'REAUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'SERVICE_NOT_INITIALIZED'
  | 'AUTH_SERVICE_UNAVAILABLE'
  | 'ROUTE_NOT_FOUND'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly retryAfter?: number | undefined;

  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    options?: { readonly retryAfter?: number; readonly cause?: unknown },
  ) {
    super(message, options ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.retryAfter = options?.retryAfter;
  }
}

export function entityNotFound(
  code: Extract<
    ApiErrorCode,
    | 'ACCOUNT_NOT_FOUND'
    | 'FRIEND_NOT_FOUND'
    | 'SCHEDULE_NOT_FOUND'
    | 'TEMPLATE_NOT_FOUND'
    | 'RUN_NOT_FOUND'
  >,
  entityName: string,
): ApiError {
  return new ApiError(404, code, `${entityName} was not found.`);
}
