export class DatabaseInitializationError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'DatabaseInitializationError';
  }
}

export class DatabaseClientError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DatabaseClientError';
  }
}

export class DatabaseMigrationError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'DatabaseMigrationError';
  }
}

export class DatabaseSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseSchemaError';
  }
}
