/**
 * Canonical list of the stable machine-readable error codes the SparkKeeper
 * server returns (see apps/server/src/http/errors/ApiError.ts). The list is
 * owned by the admin frontend on purpose: the bundle must never import server
 * code, and the coverage tests enforce that every code carries zh-CN and
 * en-US copy. When the server gains a new code, add it here together with
 * its translation keys; unknown codes always fall back safely.
 */
export const KNOWN_API_ERROR_CODES = [
  'ACCOUNT_NOT_FOUND',
  'FRIEND_NOT_FOUND',
  'SCHEDULE_NOT_FOUND',
  'TEMPLATE_NOT_FOUND',
  'RUN_NOT_FOUND',
  'VALIDATION_ERROR',
  'CONFLICT',
  'RUN_ALREADY_IN_PROGRESS',
  'RUN_ALREADY_COMPLETE',
  'RUN_TERMINAL',
  'MANUAL_RUN_FORBIDDEN',
  'MANUAL_RUN_BLOCKED',
  'MANUAL_RUN_UNAVAILABLE',
  'REAL_SEND_ACKNOWLEDGEMENT_REQUIRED',
  'ADMIN_REQUEST_REQUIRED',
  'ADMIN_REQUEST_REJECTED',
  'EVENT_STREAM_REJECTED',
  'UNSUPPORTED_MEDIA_TYPE',
  'WEBHOOK_DESTINATION_BLOCKED',
  'ROUTE_NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export type KnownApiErrorCode = (typeof KNOWN_API_ERROR_CODES)[number];

const API_ERROR_TRANSLATION_KEYS: Record<KnownApiErrorCode, string> = {
  ACCOUNT_NOT_FOUND: 'errors.api.accountNotFound',
  FRIEND_NOT_FOUND: 'errors.api.friendNotFound',
  SCHEDULE_NOT_FOUND: 'errors.api.scheduleNotFound',
  TEMPLATE_NOT_FOUND: 'errors.api.templateNotFound',
  RUN_NOT_FOUND: 'errors.api.runNotFound',
  VALIDATION_ERROR: 'errors.api.validationError',
  CONFLICT: 'errors.api.conflict',
  RUN_ALREADY_IN_PROGRESS: 'errors.api.runAlreadyInProgress',
  RUN_ALREADY_COMPLETE: 'errors.api.runAlreadyComplete',
  RUN_TERMINAL: 'errors.api.runTerminal',
  MANUAL_RUN_FORBIDDEN: 'errors.api.manualRunForbidden',
  MANUAL_RUN_BLOCKED: 'errors.api.manualRunBlocked',
  MANUAL_RUN_UNAVAILABLE: 'errors.api.manualRunUnavailable',
  REAL_SEND_ACKNOWLEDGEMENT_REQUIRED: 'errors.api.realSendAcknowledgementRequired',
  ADMIN_REQUEST_REQUIRED: 'errors.api.adminRequestRequired',
  ADMIN_REQUEST_REJECTED: 'errors.api.adminRequestRejected',
  EVENT_STREAM_REJECTED: 'errors.api.eventStreamRejected',
  UNSUPPORTED_MEDIA_TYPE: 'errors.api.unsupportedMediaType',
  WEBHOOK_DESTINATION_BLOCKED: 'errors.api.webhookDestinationBlocked',
  ROUTE_NOT_FOUND: 'errors.api.routeNotFound',
  INTERNAL_ERROR: 'errors.api.internalError',
};

/**
 * Maps a stable server error code to its translation key. Returns null for
 * unknown/future codes so callers fall back to the server-provided message.
 * Classification is always based on the stable code, never on message text.
 */
export function apiErrorTranslationKey(code: string | null | undefined): string | null {
  if (typeof code !== 'string' || code === '') return null;
  return (API_ERROR_TRANSLATION_KEYS as Record<string, string | undefined>)[code] ?? null;
}
