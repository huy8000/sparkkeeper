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
  FRIEND_MATCH_FIELDS,
  FRIEND_MATCH_PRIORITY,
  FriendIdentityError,
  normalizeFriendIdentity,
  selectFriendMatch,
  type FriendMatch,
  type NormalizedFriendIdentity,
} from './identity/index.js';
export {
  AccountRepository,
  AccountRepositoryError,
  type Account,
  type CreateAccountInput,
  type UpdateAccountInput,
  FriendRepository,
  FriendRepositoryError,
  type CreateFriendInput,
  type Friend,
  type UpdateFriendInput,
} from './repositories/index.js';
export {
  accounts,
  friends,
  LOGIN_STATUSES,
  type AccountRow,
  type FriendRow,
  type NewAccountRow,
  type NewFriendRow,
} from './schema/index.js';
export type { FriendIdentity, FriendMatchField } from '@sparkkeeper/shared';
