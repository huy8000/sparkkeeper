export const MIN_PASSWORD_CODE_POINTS = 14;
export const MAX_PASSWORD_CODE_POINTS = 256;

export class PasswordValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'PasswordValidationError';
  }
}

/**
 * Counts the number of Unicode code points in a string.
 */
export function countPasswordCodePoints(password: string): number {
  return Array.from(password).length;
}

/**
 * Validates a password against the V4-2 specification:
 * - Must be a string.
 * - Minimum 14 and maximum 256 Unicode code points.
 * - No trimming, no case-folding, no arbitrary character classes required.
 * - Spaces are allowed.
 */
export function validatePasswordInput(password: unknown): string {
  if (typeof password !== 'string') {
    throw new PasswordValidationError('Password must be a string.');
  }

  const length = countPasswordCodePoints(password);
  if (length < MIN_PASSWORD_CODE_POINTS) {
    throw new PasswordValidationError(
      `Password must be at least ${MIN_PASSWORD_CODE_POINTS} characters long.`,
    );
  }

  if (length > MAX_PASSWORD_CODE_POINTS) {
    throw new PasswordValidationError(
      `Password must not exceed ${MAX_PASSWORD_CODE_POINTS} characters.`,
    );
  }

  return password;
}

export function isValidPassword(password: unknown): password is string {
  if (typeof password !== 'string') return false;
  const length = countPasswordCodePoints(password);
  return length >= MIN_PASSWORD_CODE_POINTS && length <= MAX_PASSWORD_CODE_POINTS;
}
