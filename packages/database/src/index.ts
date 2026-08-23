export {
  createDatabase,
  DatabaseClient,
  DATABASE_BUSY_TIMEOUT_MS,
  DATABASE_SYNCHRONOUS_MODE,
  DEFAULT_MIGRATIONS_DIRECTORY,
  type CreateDatabaseOptions,
  type DatabaseColumnState,
  type DatabaseInspection,
  type DatabaseMigrationResult,
  type DatabasePragmaState,
} from './client/DatabaseClient.js';
export {
  DatabaseClientError,
  DatabaseInitializationError,
  DatabaseMigrationError,
  DatabaseSchemaError,
} from './client/errors.js';
export {
  DATA_DIR_ENV,
  DEFAULT_DATABASE_FILENAME,
  DEFAULT_DATA_DIRECTORY,
  resolveDatabasePath,
  type DatabaseEnvironment,
  type ResolveDatabasePathOptions,
} from './config/databaseConfig.js';
export {
  AccountRepository,
  AccountRepositoryError,
  type Account,
  type CreateAccountInput,
  type UpdateAccountInput,
} from './repositories/index.js';
export { accounts, LOGIN_STATUSES, type AccountRow, type NewAccountRow } from './schema/index.js';
