export const ADMIN_USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

export function isAdminUserStatus(value: unknown): value is AdminUserStatus {
  return typeof value === 'string' && ADMIN_USER_STATUSES.includes(value as AdminUserStatus);
}

export class AdminValidationError extends Error {
  readonly code: 'INVALID_USERNAME' | 'INVALID_STATUS';

  constructor(code: AdminValidationError['code'], message: string) {
    super(message);
    this.name = 'AdminValidationError';
    this.code = code;
  }
}

export function validateAdminUsername(username: string): string {
  const trimmed = username.trim();
  if (trimmed.length === 0) {
    throw new AdminValidationError('INVALID_USERNAME', 'Admin username must not be empty.');
  }
  return trimmed;
}

export function normalizeAdminUsername(username: string): string {
  const validated = validateAdminUsername(username);
  return validated.toLowerCase();
}
