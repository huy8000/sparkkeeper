import { MIN_PASSWORD_CODE_POINTS } from '../../security/PasswordPolicy.js';

export const loginSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    additionalProperties: false,
    properties: {
      username: {
        type: 'string',
        minLength: 3,
        maxLength: 64,
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$',
      },
      password: {
        type: 'string',
        minLength: MIN_PASSWORD_CODE_POINTS,
        maxLength: 1024, // allow max UTF-8 byte length for 256 code points
      },
    },
  },
} as const;

export const logoutSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
  },
} as const;
