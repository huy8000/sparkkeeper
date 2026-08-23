declare const businessDateBrand: unique symbol;

export type BusinessDate = string & { readonly [businessDateBrand]: true };

export type BusinessDateErrorCode =
  'INVALID_BUSINESS_DATE' | 'INVALID_INSTANT' | 'INVALID_TIME_ZONE';

export const DEFAULT_APP_TIMEZONE = 'Asia/Shanghai';

export class BusinessDateError extends Error {
  constructor(
    readonly code: BusinessDateErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BusinessDateError';
  }
}

export function resolveBusinessTimeZone(value?: string): string {
  const timeZone = value?.trim() || DEFAULT_APP_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch (error) {
    throw new BusinessDateError(
      'INVALID_TIME_ZONE',
      'Business timezone must be a valid IANA timezone.',
      error,
    );
  }

  return timeZone;
}

export function resolveBusinessDate(instant: Date, timeZone = DEFAULT_APP_TIMEZONE): BusinessDate {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new BusinessDateError('INVALID_INSTANT', 'Business date requires a valid instant.');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: resolveBusinessTimeZone(timeZone),
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(instant);
  const year = readDatePart(parts, 'year');
  const month = readDatePart(parts, 'month');
  const day = readDatePart(parts, 'day');

  return parseBusinessDate(`${year}-${month}-${day}`);
}

export function parseBusinessDate(value: unknown): BusinessDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BusinessDateError(
      'INVALID_BUSINESS_DATE',
      'Business date must use the YYYY-MM-DD format.',
    );
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BusinessDateError(
      'INVALID_BUSINESS_DATE',
      'Business date must be a real Gregorian calendar date.',
    );
  }

  return value as BusinessDate;
}

function readDatePart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: 'year' | 'month' | 'day',
): string {
  const part = parts.find((candidate) => candidate.type === type);
  if (part === undefined) {
    throw new BusinessDateError(
      'INVALID_TIME_ZONE',
      'Unable to resolve business date components for the configured timezone.',
    );
  }
  return part.value;
}
