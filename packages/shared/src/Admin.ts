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

export const ADMIN_USERNAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export function validateAdminUsername(username: string): string {
  if (typeof username !== 'string' || !ADMIN_USERNAME_REGEX.test(username)) {
    throw new AdminValidationError(
      'INVALID_USERNAME',
      'Admin username must be 3-64 characters matching ^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$.',
    );
  }
  return username;
}

export function normalizeAdminUsername(username: string): string {
  const validated = validateAdminUsername(username);
  return validated.toLowerCase();
}
