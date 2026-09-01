import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BetterSqlite3 from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as applyDrizzleMigrations } from 'drizzle-orm/better-sqlite3/migrator';

import { resolveDatabasePath, type ResolveDatabasePathOptions } from '../config/databaseConfig.js';
import * as schema from '../schema/index.js';
import {
  DatabaseClientError,
  DatabaseInitializationError,
  DatabaseMigrationError,
  DatabaseSchemaError,
} from './errors.js';

export const DATABASE_BUSY_TIMEOUT_MS = 5_000;
export const DATABASE_SYNCHRONOUS_MODE = 2;
export const DEFAULT_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL('../../migrations', import.meta.url),
);

export interface CreateDatabaseOptions extends ResolveDatabasePathOptions {
  readonly migrationsDirectory?: string;
}

export interface DatabasePragmaState {
  readonly journalMode: string;
  readonly foreignKeys: number;
  readonly busyTimeoutMs: number;
  readonly synchronous: number;
}

export interface DatabaseColumnState {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly primaryKey: boolean;
}

export interface DatabaseInspection {
  readonly databasePath: string;
  readonly pragmas: DatabasePragmaState;
  readonly tables: readonly string[];
  readonly appliedMigrationCount: number;
  readonly accountColumns: readonly DatabaseColumnState[];
  readonly dailyRunColumns: readonly DatabaseColumnState[];
  readonly friendColumns: readonly DatabaseColumnState[];
  readonly messageTemplateColumns: readonly DatabaseColumnState[];
  readonly notificationConfigColumns: readonly DatabaseColumnState[];
  readonly sendRecordColumns: readonly DatabaseColumnState[];
  readonly scheduleColumns: readonly DatabaseColumnState[];
  readonly systemEventColumns: readonly DatabaseColumnState[];
  readonly adminUserColumns: readonly DatabaseColumnState[];
  readonly adminSessionColumns: readonly DatabaseColumnState[];
  readonly accountLoginSessionColumns: readonly DatabaseColumnState[];
  readonly avatarAssetColumns: readonly DatabaseColumnState[];
  readonly contactSyncRunColumns: readonly DatabaseColumnState[];
  readonly contactColumns: readonly DatabaseColumnState[];
  readonly contactIdentityColumns: readonly DatabaseColumnState[];
  readonly sendTaskColumns: readonly DatabaseColumnState[];
  readonly sendTaskTargetColumns: readonly DatabaseColumnState[];
  readonly executionRunColumns: readonly DatabaseColumnState[];
  readonly targetSendRecordColumns: readonly DatabaseColumnState[];
  readonly deliveryResolutionColumns: readonly DatabaseColumnState[];
  readonly auditEventColumns: readonly DatabaseColumnState[];
  readonly legacyFriendBindingColumns: readonly DatabaseColumnState[];
  readonly legacyScheduleImportColumns: readonly DatabaseColumnState[];
  readonly accountsSchemaCompatible: boolean;
  readonly dailyRunsSchemaCompatible: boolean;
  readonly friendsSchemaCompatible: boolean;
  readonly messageTemplatesSchemaCompatible: boolean;
  readonly notificationConfigsSchemaCompatible: boolean;
  readonly sendRecordsSchemaCompatible: boolean;
  readonly schedulesSchemaCompatible: boolean;
  readonly systemEventsSchemaCompatible: boolean;
  readonly adminUsersSchemaCompatible: boolean;
  readonly adminSessionsSchemaCompatible: boolean;
  readonly accountLoginSessionsSchemaCompatible: boolean;
  readonly avatarAssetsSchemaCompatible: boolean;
  readonly contactSyncRunsSchemaCompatible: boolean;
  readonly contactsSchemaCompatible: boolean;
  readonly contactIdentitiesSchemaCompatible: boolean;
  readonly sendTasksSchemaCompatible: boolean;
  readonly sendTaskTargetsSchemaCompatible: boolean;
  readonly executionRunsSchemaCompatible: boolean;
  readonly targetSendRecordsSchemaCompatible: boolean;
  readonly deliveryResolutionsSchemaCompatible: boolean;
  readonly auditEventsSchemaCompatible: boolean;
  readonly legacyFriendBindingsSchemaCompatible: boolean;
  readonly legacyScheduleImportsSchemaCompatible: boolean;
}

export interface DatabaseMigrationResult {
  readonly appliedMigrationCount: number;
  readonly accountsSchemaVerified: true;
  readonly dailyRunsSchemaVerified: true;
  readonly friendsSchemaVerified: true;
  readonly messageTemplatesSchemaVerified: true;
  readonly notificationConfigsSchemaVerified: true;
  readonly sendRecordsSchemaVerified: true;
  readonly schedulesSchemaVerified: true;
  readonly systemEventsSchemaVerified: true;
  readonly adminUsersSchemaVerified: true;
  readonly adminSessionsSchemaVerified: true;
  readonly accountLoginSessionsSchemaVerified: true;
  readonly avatarAssetsSchemaVerified: true;
  readonly contactSyncRunsSchemaVerified: true;
  readonly contactsSchemaVerified: true;
  readonly contactIdentitiesSchemaVerified: true;
  readonly sendTasksSchemaVerified: true;
  readonly sendTaskTargetsSchemaVerified: true;
  readonly executionRunsSchemaVerified: true;
  readonly targetSendRecordsSchemaVerified: true;
  readonly deliveryResolutionsSchemaVerified: true;
  readonly auditEventsSchemaVerified: true;
  readonly legacyFriendBindingsSchemaVerified: true;
  readonly legacyScheduleImportsSchemaVerified: true;
}

interface SqliteCountRow {
  readonly count: number;
}

interface SqliteNameRow {
  readonly name: string;
}

interface SqliteHealthRow {
  readonly ready: number;
}

interface SqliteTableInfoRow {
  readonly name: string;
  readonly type: string;
  readonly notnull: 0 | 1;
  readonly pk: number;
}

const EXPECTED_ACCOUNT_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'name', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'login_status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'last_login_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'avatar_remote_url', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'avatar_cache_key', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'douyin_unique_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'douyin_short_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'douyin_sec_uid', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'profile_state', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'lifecycle_status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'last_auth_check_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'last_contact_sync_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'unbound_at', type: 'INTEGER', notNull: false, primaryKey: false },
];

const EXPECTED_FRIEND_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'display_name', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'remark_name', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'short_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'unique_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'sec_uid', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'match_field', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'match_key', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_DAILY_RUN_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'business_date', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'finished_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_MESSAGE_TEMPLATE_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'name', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'provider_type', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'content', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_NOTIFICATION_CONFIG_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'INTEGER', notNull: true, primaryKey: true },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'provider', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'webhook_url', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'notify_auth_expired', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'notify_task_failed', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'notify_consecutive_failure', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'notify_delivery_unknown', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_SEND_RECORD_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'daily_run_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'friend_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'business_date', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'message_template_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'message_text', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'attempt_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'next_retry_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'last_error_code', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'sent_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'send_action_started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'finished_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_SCHEDULE_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'start_time', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'end_time', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'timezone', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'max_attempts', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'retry_interval_seconds', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_SYSTEM_EVENT_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'event_type', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'level', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'run_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'account_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'friend_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'attempt', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'error_code', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'message', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'screenshot_path', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'trace_path', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_ADMIN_USER_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'username', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'username_normalized', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'password_hash', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'session_version', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'failed_login_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'locked_until', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'last_failed_login_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'last_login_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'password_changed_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_ADMIN_SESSION_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'admin_user_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'token_digest', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'csrf_token_digest', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'session_version', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'reauthenticated_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'last_seen_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'idle_expires_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'absolute_expires_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'revoked_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'revoke_reason', type: 'TEXT', notNull: false, primaryKey: false },
];

const EXPECTED_ACCOUNT_LOGIN_SESSION_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'purpose', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'account_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'pending_account_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'created_by_admin_user_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'expires_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'ready_detected_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'completed_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'cancelled_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'failure_code', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_AVATAR_ASSET_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'cache_key', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'media_type', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'byte_size', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'content_digest', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'fetched_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'last_referenced_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'expires_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_CONTACT_SYNC_RUN_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'requested_by_admin_user_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'is_complete', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'candidate_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'stale_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'unavailable_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'issue_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'failure_code', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'finished_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_CONTACT_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'type', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'display_name', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'remark_name', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'avatar_remote_url', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'avatar_asset_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'streak_days', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'streak_updated_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'availability_status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'identity_status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'discovered_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'last_seen_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'last_full_sync_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'missed_full_sync_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_CONTACT_IDENTITY_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'contact_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'kind', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'value', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'normalized_value', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'source', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'state', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'is_preferred', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'first_observed_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'last_observed_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'superseded_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_SEND_TASK_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'name', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'template_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'schedule_type', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'start_time', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'end_time', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'timezone', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'max_attempts', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'retry_interval_seconds', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'enabled', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'archived_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_SEND_TASK_TARGET_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'task_id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'contact_id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_EXECUTION_RUN_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'kind', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'task_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'template_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'requested_by_admin_user_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'business_date', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'idempotency_key', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'confirmed_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'finished_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_TARGET_SEND_RECORD_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'run_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'task_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'contact_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'business_date', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'template_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'message_text', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'machine_status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'attempt_count', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'next_retry_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'failure_code', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'target_identity_kind_snapshot', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'target_identity_value_digest', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'send_action_started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'sent_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'started_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'finished_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_DELIVERY_RESOLUTION_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'target_send_record_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'legacy_send_record_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'original_machine_status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'resolution', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'source', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'resolved_by_admin_user_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'note', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'supersedes_resolution_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'resolved_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_AUDIT_EVENT_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'actor_admin_user_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'action', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'entity_type', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'entity_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'outcome', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'reason_code', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'correlation_digest', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_LEGACY_FRIEND_BINDING_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'friend_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'contact_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'bound_by_admin_user_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'bound_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'dismissed_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

const EXPECTED_LEGACY_SCHEDULE_IMPORT_COLUMNS: readonly DatabaseColumnState[] = [
  { name: 'id', type: 'TEXT', notNull: true, primaryKey: true },
  { name: 'schedule_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'account_id', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'status', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'start_time', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'end_time', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'timezone', type: 'TEXT', notNull: true, primaryKey: false },
  { name: 'max_attempts', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'retry_interval_seconds', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'legacy_enabled_snapshot', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'converted_task_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'converted_by_admin_user_id', type: 'TEXT', notNull: false, primaryKey: false },
  { name: 'converted_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'dismissed_at', type: 'INTEGER', notNull: false, primaryKey: false },
  { name: 'created_at', type: 'INTEGER', notNull: true, primaryKey: false },
  { name: 'updated_at', type: 'INTEGER', notNull: true, primaryKey: false },
];

export class DatabaseClient {
  readonly databasePath: string;
  readonly orm: BetterSQLite3Database<typeof schema>;

  private readonly sqlite: BetterSqlite3.Database;
  private readonly migrationsDirectory: string;
  private closed = false;

  constructor(databasePath: string, sqlite: BetterSqlite3.Database, migrationsDirectory: string) {
    this.databasePath = databasePath;
    this.sqlite = sqlite;
    this.migrationsDirectory = migrationsDirectory;
    this.orm = drizzle({ client: sqlite, schema });
  }

  migrate(): DatabaseMigrationResult {
    this.assertOpen();

    try {
      applyDrizzleMigrations(this.orm, { migrationsFolder: this.migrationsDirectory });
    } catch (error) {
      throw new DatabaseMigrationError(
        `Failed to apply database migrations from "${this.migrationsDirectory}".`,
        error,
      );
    }

    const inspection = this.inspect();
    if (
      !inspection.accountsSchemaCompatible ||
      !inspection.dailyRunsSchemaCompatible ||
      !inspection.friendsSchemaCompatible ||
      !inspection.messageTemplatesSchemaCompatible ||
      !inspection.notificationConfigsSchemaCompatible ||
      !inspection.sendRecordsSchemaCompatible ||
      !inspection.schedulesSchemaCompatible ||
      !inspection.systemEventsSchemaCompatible ||
      !inspection.adminUsersSchemaCompatible ||
      !inspection.adminSessionsSchemaCompatible ||
      !inspection.accountLoginSessionsSchemaCompatible ||
      !inspection.avatarAssetsSchemaCompatible ||
      !inspection.contactSyncRunsSchemaCompatible ||
      !inspection.contactsSchemaCompatible ||
      !inspection.contactIdentitiesSchemaCompatible ||
      !inspection.sendTasksSchemaCompatible ||
      !inspection.sendTaskTargetsSchemaCompatible ||
      !inspection.executionRunsSchemaCompatible ||
      !inspection.targetSendRecordsSchemaCompatible ||
      !inspection.deliveryResolutionsSchemaCompatible ||
      !inspection.auditEventsSchemaCompatible ||
      !inspection.legacyFriendBindingsSchemaCompatible ||
      !inspection.legacyScheduleImportsSchemaCompatible
    ) {
      throw new DatabaseSchemaError(
        'Database migrations completed, but the database tables are incompatible with the Drizzle schema.',
      );
    }

    return {
      appliedMigrationCount: inspection.appliedMigrationCount,
      accountsSchemaVerified: true,
      dailyRunsSchemaVerified: true,
      friendsSchemaVerified: true,
      messageTemplatesSchemaVerified: true,
      notificationConfigsSchemaVerified: true,
      sendRecordsSchemaVerified: true,
      schedulesSchemaVerified: true,
      systemEventsSchemaVerified: true,
      adminUsersSchemaVerified: true,
      adminSessionsSchemaVerified: true,
      accountLoginSessionsSchemaVerified: true,
      avatarAssetsSchemaVerified: true,
      contactSyncRunsSchemaVerified: true,
      contactsSchemaVerified: true,
      contactIdentitiesSchemaVerified: true,
      sendTasksSchemaVerified: true,
      sendTaskTargetsSchemaVerified: true,
      executionRunsSchemaVerified: true,
      targetSendRecordsSchemaVerified: true,
      deliveryResolutionsSchemaVerified: true,
      auditEventsSchemaVerified: true,
      legacyFriendBindingsSchemaVerified: true,
      legacyScheduleImportsSchemaVerified: true,
    };
  }

  inspect(): DatabaseInspection {
    this.assertOpen();

    const tables = this.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
      )
      .all() as SqliteNameRow[];
    const tableNames = tables.map(({ name }) => name);
    const accountColumns = tableNames.includes('accounts') ? this.readTableColumns('accounts') : [];
    const dailyRunColumns = tableNames.includes('daily_runs')
      ? this.readTableColumns('daily_runs')
      : [];
    const friendColumns = tableNames.includes('friends') ? this.readTableColumns('friends') : [];
    const messageTemplateColumns = tableNames.includes('message_templates')
      ? this.readTableColumns('message_templates')
      : [];
    const notificationConfigColumns = tableNames.includes('notification_configs')
      ? this.readTableColumns('notification_configs')
      : [];
    const sendRecordColumns = tableNames.includes('send_records')
      ? this.readTableColumns('send_records')
      : [];
    const scheduleColumns = tableNames.includes('schedules')
      ? this.readTableColumns('schedules')
      : [];
    const systemEventColumns = tableNames.includes('system_events')
      ? this.readTableColumns('system_events')
      : [];

    const adminUserColumns = tableNames.includes('admin_users')
      ? this.readTableColumns('admin_users')
      : [];
    const adminSessionColumns = tableNames.includes('admin_sessions')
      ? this.readTableColumns('admin_sessions')
      : [];
    const accountLoginSessionColumns = tableNames.includes('account_login_sessions')
      ? this.readTableColumns('account_login_sessions')
      : [];
    const avatarAssetColumns = tableNames.includes('avatar_assets')
      ? this.readTableColumns('avatar_assets')
      : [];
    const contactSyncRunColumns = tableNames.includes('contact_sync_runs')
      ? this.readTableColumns('contact_sync_runs')
      : [];
    const contactColumns = tableNames.includes('contacts') ? this.readTableColumns('contacts') : [];
    const contactIdentityColumns = tableNames.includes('contact_identities')
      ? this.readTableColumns('contact_identities')
      : [];
    const sendTaskColumns = tableNames.includes('send_tasks')
      ? this.readTableColumns('send_tasks')
      : [];
    const sendTaskTargetColumns = tableNames.includes('send_task_targets')
      ? this.readTableColumns('send_task_targets')
      : [];
    const executionRunColumns = tableNames.includes('execution_runs')
      ? this.readTableColumns('execution_runs')
      : [];
    const targetSendRecordColumns = tableNames.includes('target_send_records')
      ? this.readTableColumns('target_send_records')
      : [];
    const deliveryResolutionColumns = tableNames.includes('delivery_resolutions')
      ? this.readTableColumns('delivery_resolutions')
      : [];
    const auditEventColumns = tableNames.includes('audit_events')
      ? this.readTableColumns('audit_events')
      : [];
    const legacyFriendBindingColumns = tableNames.includes('legacy_friend_bindings')
      ? this.readTableColumns('legacy_friend_bindings')
      : [];
    const legacyScheduleImportColumns = tableNames.includes('legacy_schedule_imports')
      ? this.readTableColumns('legacy_schedule_imports')
      : [];

    return {
      databasePath: this.databasePath,
      pragmas: readPragmaState(this.sqlite),
      tables: tableNames,
      appliedMigrationCount: tableNames.includes('__drizzle_migrations')
        ? this.readMigrationCount()
        : 0,
      accountColumns,
      dailyRunColumns,
      friendColumns,
      messageTemplateColumns,
      notificationConfigColumns,
      sendRecordColumns,
      scheduleColumns,
      systemEventColumns,
      adminUserColumns,
      adminSessionColumns,
      accountLoginSessionColumns,
      avatarAssetColumns,
      contactSyncRunColumns,
      contactColumns,
      contactIdentityColumns,
      sendTaskColumns,
      sendTaskTargetColumns,
      executionRunColumns,
      targetSendRecordColumns,
      deliveryResolutionColumns,
      auditEventColumns,
      legacyFriendBindingColumns,
      legacyScheduleImportColumns,
      accountsSchemaCompatible: columnsMatch(accountColumns, EXPECTED_ACCOUNT_COLUMNS),
      dailyRunsSchemaCompatible: columnsMatch(dailyRunColumns, EXPECTED_DAILY_RUN_COLUMNS),
      friendsSchemaCompatible: columnsMatch(friendColumns, EXPECTED_FRIEND_COLUMNS),
      messageTemplatesSchemaCompatible: columnsMatch(
        messageTemplateColumns,
        EXPECTED_MESSAGE_TEMPLATE_COLUMNS,
      ),
      notificationConfigsSchemaCompatible: columnsMatch(
        notificationConfigColumns,
        EXPECTED_NOTIFICATION_CONFIG_COLUMNS,
      ),
      sendRecordsSchemaCompatible: columnsMatch(sendRecordColumns, EXPECTED_SEND_RECORD_COLUMNS),
      schedulesSchemaCompatible: columnsMatch(scheduleColumns, EXPECTED_SCHEDULE_COLUMNS),
      systemEventsSchemaCompatible: columnsMatch(systemEventColumns, EXPECTED_SYSTEM_EVENT_COLUMNS),
      adminUsersSchemaCompatible: columnsMatch(adminUserColumns, EXPECTED_ADMIN_USER_COLUMNS),
      adminSessionsSchemaCompatible: columnsMatch(
        adminSessionColumns,
        EXPECTED_ADMIN_SESSION_COLUMNS,
      ),
      accountLoginSessionsSchemaCompatible: columnsMatch(
        accountLoginSessionColumns,
        EXPECTED_ACCOUNT_LOGIN_SESSION_COLUMNS,
      ),
      avatarAssetsSchemaCompatible: columnsMatch(avatarAssetColumns, EXPECTED_AVATAR_ASSET_COLUMNS),
      contactSyncRunsSchemaCompatible: columnsMatch(
        contactSyncRunColumns,
        EXPECTED_CONTACT_SYNC_RUN_COLUMNS,
      ),
      contactsSchemaCompatible: columnsMatch(contactColumns, EXPECTED_CONTACT_COLUMNS),
      contactIdentitiesSchemaCompatible: columnsMatch(
        contactIdentityColumns,
        EXPECTED_CONTACT_IDENTITY_COLUMNS,
      ),
      sendTasksSchemaCompatible: columnsMatch(sendTaskColumns, EXPECTED_SEND_TASK_COLUMNS),
      sendTaskTargetsSchemaCompatible: columnsMatch(
        sendTaskTargetColumns,
        EXPECTED_SEND_TASK_TARGET_COLUMNS,
      ),
      executionRunsSchemaCompatible: columnsMatch(
        executionRunColumns,
        EXPECTED_EXECUTION_RUN_COLUMNS,
      ),
      targetSendRecordsSchemaCompatible: columnsMatch(
        targetSendRecordColumns,
        EXPECTED_TARGET_SEND_RECORD_COLUMNS,
      ),
      deliveryResolutionsSchemaCompatible: columnsMatch(
        deliveryResolutionColumns,
        EXPECTED_DELIVERY_RESOLUTION_COLUMNS,
      ),
      auditEventsSchemaCompatible: columnsMatch(auditEventColumns, EXPECTED_AUDIT_EVENT_COLUMNS),
      legacyFriendBindingsSchemaCompatible: columnsMatch(
        legacyFriendBindingColumns,
        EXPECTED_LEGACY_FRIEND_BINDING_COLUMNS,
      ),
      legacyScheduleImportsSchemaCompatible: columnsMatch(
        legacyScheduleImportColumns,
        EXPECTED_LEGACY_SCHEDULE_IMPORT_COLUMNS,
      ),
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.sqlite.close();
    this.closed = true;
  }

  isOpen(): boolean {
    return !this.closed && this.sqlite.open;
  }

  ping(): true {
    this.assertOpen();

    try {
      const row = this.sqlite.prepare('select 1 as ready').get() as SqliteHealthRow | undefined;
      if (row?.ready !== 1) {
        throw new DatabaseClientError('Database health query returned an unexpected result.');
      }
      return true;
    } catch (error) {
      if (error instanceof DatabaseClientError) throw error;
      throw new DatabaseClientError('Database health query failed.', error);
    }
  }

  withBusyTimeout<T>(
    busyTimeoutMs: number,
    fn: () => Extract<T, PromiseLike<unknown>> extends never ? T : never,
  ): T {
    this.assertOpen();
    const previous =
      (this.sqlite.pragma('busy_timeout', { simple: true }) as number) ?? DATABASE_BUSY_TIMEOUT_MS;
    this.sqlite.pragma(`busy_timeout = ${busyTimeoutMs}`);
    try {
      const result = fn();
      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        'then' in result &&
        typeof (result as { then?: unknown }).then === 'function'
      ) {
        throw new DatabaseClientError(
          'withBusyTimeout does not support asynchronous or Promise-returning callbacks.',
        );
      }
      return result;
    } finally {
      if (this.isOpen()) {
        this.sqlite.pragma(`busy_timeout = ${previous}`);
      }
    }
  }

  private assertOpen(): void {
    if (!this.isOpen()) {
      throw new DatabaseClientError('Database client is closed.');
    }
  }

  private readMigrationCount(): number {
    const row = this.sqlite
      .prepare('select count(*) as count from "__drizzle_migrations"')
      .get() as SqliteCountRow;
    return row.count;
  }

  private readTableColumns(tableName: string): DatabaseColumnState[] {
    const rows = this.sqlite.pragma(`table_info(${tableName})`) as SqliteTableInfoRow[];
    return rows.map((row) => ({
      name: row.name,
      type: row.type.toUpperCase(),
      notNull: row.notnull === 1,
      primaryKey: row.pk > 0,
    }));
  }
}

export class ReadOnlyDatabaseClient {
  readonly databasePath: string;
  readonly orm: DatabaseClient['orm'];

  constructor(private readonly client: DatabaseClient) {
    this.databasePath = client.databasePath;
    this.orm = client.orm;
  }

  inspect(): DatabaseInspection {
    return this.client.inspect();
  }

  withBusyTimeout<T>(
    busyTimeoutMs: number,
    fn: () => Extract<T, PromiseLike<unknown>> extends never ? T : never,
  ): T {
    return this.client.withBusyTimeout(busyTimeoutMs, fn);
  }

  close(): void {
    this.client.close();
  }

  isOpen(): boolean {
    return this.client.isOpen();
  }

  ping(): true {
    return this.client.ping();
  }
}

export function openDatabaseReadOnly(
  options: ResolveDatabasePathOptions = {},
): ReadOnlyDatabaseClient {
  const databasePath = resolveDatabasePath(options);
  let sqlite: BetterSqlite3.Database;
  try {
    sqlite = new BetterSqlite3(databasePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new DatabaseInitializationError(
      `Unable to open existing SQLite database read-only at "${databasePath}".`,
      error,
    );
  }

  try {
    applyReadOnlyPragmas(sqlite);
    return new ReadOnlyDatabaseClient(
      new DatabaseClient(databasePath, sqlite, DEFAULT_MIGRATIONS_DIRECTORY),
    );
  } catch (error) {
    sqlite.close();
    throw new DatabaseInitializationError(
      `Unable to initialize read-only SQLite database "${databasePath}".`,
      error,
    );
  }
}

export function createDatabase(options: CreateDatabaseOptions = {}): DatabaseClient {
  const databasePath = resolveDatabasePath(options);
  const migrationsDirectory = path.resolve(
    options.migrationsDirectory ?? DEFAULT_MIGRATIONS_DIRECTORY,
  );

  try {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  } catch (error) {
    throw new DatabaseInitializationError(
      `Unable to create the database directory for "${databasePath}".`,
      error,
    );
  }

  let sqlite: BetterSqlite3.Database;
  try {
    sqlite = new BetterSqlite3(databasePath);
  } catch (error) {
    throw new DatabaseInitializationError(
      `Unable to open SQLite database "${databasePath}".`,
      error,
    );
  }

  try {
    applyPragmas(sqlite);
    return new DatabaseClient(databasePath, sqlite, migrationsDirectory);
  } catch (error) {
    sqlite.close();
    throw new DatabaseInitializationError(
      `Unable to initialize SQLite database "${databasePath}".`,
      error,
    );
  }
}

function applyPragmas(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma(`busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS}`);
  sqlite.pragma('synchronous = FULL');

  const state = readPragmaState(sqlite);
  if (
    state.journalMode !== 'wal' ||
    state.foreignKeys !== 1 ||
    state.busyTimeoutMs !== DATABASE_BUSY_TIMEOUT_MS ||
    state.synchronous !== DATABASE_SYNCHRONOUS_MODE
  ) {
    throw new DatabaseClientError(
      'SQLite PRAGMA initialization did not produce the required state.',
    );
  }
}

function applyReadOnlyPragmas(sqlite: BetterSqlite3.Database): void {
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma(`busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS}`);
  sqlite.pragma('synchronous = FULL');

  const state = readPragmaState(sqlite);
  if (
    state.journalMode !== 'wal' ||
    state.foreignKeys !== 1 ||
    state.busyTimeoutMs !== DATABASE_BUSY_TIMEOUT_MS ||
    state.synchronous !== DATABASE_SYNCHRONOUS_MODE
  ) {
    throw new DatabaseClientError(
      'Read-only SQLite inspection did not observe the required PRAGMA state.',
    );
  }
}

function readPragmaState(sqlite: BetterSqlite3.Database): DatabasePragmaState {
  return {
    journalMode: String(sqlite.pragma('journal_mode', { simple: true })).toLowerCase(),
    foreignKeys: Number(sqlite.pragma('foreign_keys', { simple: true })),
    busyTimeoutMs: Number(sqlite.pragma('busy_timeout', { simple: true })),
    synchronous: Number(sqlite.pragma('synchronous', { simple: true })),
  };
}

function columnsMatch(
  actual: readonly DatabaseColumnState[],
  expectedColumns: readonly DatabaseColumnState[],
): boolean {
  return (
    actual.length === expectedColumns.length &&
    actual.every((column, index) => {
      const expected = expectedColumns[index];
      return (
        expected !== undefined &&
        column.name === expected.name &&
        column.type === expected.type &&
        column.notNull === expected.notNull &&
        column.primaryKey === expected.primaryKey
      );
    })
  );
}
