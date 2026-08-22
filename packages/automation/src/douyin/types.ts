export type AuthStatus = 'READY' | 'AUTH_EXPIRED' | 'UNKNOWN';

export interface AuthDetectionResult {
  readonly status: AuthStatus;
  readonly reason: string;
}

export interface AuthDetectorOptions {
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}
