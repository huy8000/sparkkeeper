export type ApiErrorCode =
  | 'ACCOUNT_NOT_FOUND'
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
  | 'RUN_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'ROUTE_NOT_FOUND'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
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
