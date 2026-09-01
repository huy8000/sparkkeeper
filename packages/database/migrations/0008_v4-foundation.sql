ALTER TABLE `accounts` ADD `avatar_remote_url` text CONSTRAINT "accounts_avatar_remote_url_check" CHECK("accounts"."avatar_remote_url" is null or length(trim("accounts"."avatar_remote_url", ' ' || char(9) || char(10) || char(13))) > 0);--> statement-breakpoint
ALTER TABLE `accounts` ADD `avatar_cache_key` text CONSTRAINT "accounts_avatar_cache_key_check" CHECK("accounts"."avatar_cache_key" is null or length(trim("accounts"."avatar_cache_key", ' ' || char(9) || char(10) || char(13))) > 0);--> statement-breakpoint
ALTER TABLE `accounts` ADD `douyin_unique_id` text CONSTRAINT "accounts_douyin_unique_id_check" CHECK("accounts"."douyin_unique_id" is null or length(trim("accounts"."douyin_unique_id", ' ' || char(9) || char(10) || char(13))) > 0);--> statement-breakpoint
ALTER TABLE `accounts` ADD `douyin_short_id` text CONSTRAINT "accounts_douyin_short_id_check" CHECK("accounts"."douyin_short_id" is null or length(trim("accounts"."douyin_short_id", ' ' || char(9) || char(10) || char(13))) > 0);--> statement-breakpoint
ALTER TABLE `accounts` ADD `douyin_sec_uid` text CONSTRAINT "accounts_douyin_sec_uid_check" CHECK("accounts"."douyin_sec_uid" is null or length(trim("accounts"."douyin_sec_uid", ' ' || char(9) || char(10) || char(13))) > 0);--> statement-breakpoint
ALTER TABLE `accounts` ADD `profile_state` text DEFAULT 'MIGRATION_REQUIRED' NOT NULL CONSTRAINT "accounts_profile_state_check" CHECK("accounts"."profile_state" in ('PROVISIONING', 'READY', 'MIGRATION_REQUIRED', 'MISSING', 'QUARANTINED'));--> statement-breakpoint
ALTER TABLE `accounts` ADD `lifecycle_status` text DEFAULT 'ACTIVE' NOT NULL CONSTRAINT "accounts_lifecycle_status_check" CHECK("accounts"."lifecycle_status" in ('ACTIVE', 'UNBOUND'));--> statement-breakpoint
ALTER TABLE `accounts` ADD `last_auth_check_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `last_contact_sync_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `unbound_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_douyin_sec_uid_unique_idx` ON `accounts` (`douyin_sec_uid`) WHERE `accounts`.`douyin_sec_uid` is not null;--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`password_hash` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`session_version` integer DEFAULT 1 NOT NULL,
	`failed_login_count` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_failed_login_at` integer,
	`last_login_at` integer,
	`password_changed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "admin_users_username_not_empty_check" CHECK(length(trim("admin_users"."username")) > 0),
	CONSTRAINT "admin_users_username_normalized_not_empty_check" CHECK(length(trim("admin_users"."username_normalized")) > 0),
	CONSTRAINT "admin_users_password_hash_not_empty_check" CHECK(length(trim("admin_users"."password_hash")) > 0),
	CONSTRAINT "admin_users_status_check" CHECK("admin_users"."status" in ('ACTIVE', 'DISABLED')),
	CONSTRAINT "admin_users_session_version_check" CHECK("admin_users"."session_version" >= 1),
	CONSTRAINT "admin_users_failed_login_count_check" CHECK("admin_users"."failed_login_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_username_normalized_unique` ON `admin_users` (`username_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_users_active_singleton_idx` ON `admin_users` (`status`) WHERE `admin_users`.`status` = 'ACTIVE';--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`csrf_token_digest` text NOT NULL,
	`session_version` integer NOT NULL,
	`reauthenticated_at` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoke_reason` text,
	FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "admin_sessions_token_digest_not_empty_check" CHECK(length(trim("admin_sessions"."token_digest")) > 0),
	CONSTRAINT "admin_sessions_csrf_token_digest_not_empty_check" CHECK(length(trim("admin_sessions"."csrf_token_digest")) > 0),
	CONSTRAINT "admin_sessions_session_version_check" CHECK("admin_sessions"."session_version" >= 1),
	CONSTRAINT "admin_sessions_timeline_check" CHECK("admin_sessions"."created_at" <= "admin_sessions"."last_seen_at" and "admin_sessions"."last_seen_at" <= "admin_sessions"."idle_expires_at"),
	CONSTRAINT "admin_sessions_absolute_timeline_check" CHECK("admin_sessions"."created_at" < "admin_sessions"."absolute_expires_at" and "admin_sessions"."idle_expires_at" <= "admin_sessions"."absolute_expires_at"),
	CONSTRAINT "admin_sessions_reauthenticated_at_check" CHECK("admin_sessions"."reauthenticated_at" is null or ("admin_sessions"."reauthenticated_at" >= "admin_sessions"."created_at" and "admin_sessions"."reauthenticated_at" <= "admin_sessions"."absolute_expires_at")),
	CONSTRAINT "admin_sessions_revoke_reason_check" CHECK(("admin_sessions"."revoked_at" is null and "admin_sessions"."revoke_reason" is null) or ("admin_sessions"."revoked_at" is not null and "admin_sessions"."revoke_reason" is not null and length(trim("admin_sessions"."revoke_reason")) > 0))
);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_sessions_token_digest_unique` ON `admin_sessions` (`token_digest`);--> statement-breakpoint
CREATE INDEX `admin_sessions_admin_user_revoked_idx` ON `admin_sessions` (`admin_user_id`, `revoked_at`);--> statement-breakpoint
CREATE INDEX `admin_sessions_idle_expires_at_idx` ON `admin_sessions` (`idle_expires_at`);--> statement-breakpoint
CREATE INDEX `admin_sessions_absolute_expires_at_idx` ON `admin_sessions` (`absolute_expires_at`);--> statement-breakpoint
CREATE TABLE `account_login_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`purpose` text NOT NULL,
	`account_id` text,
	`pending_account_id` text,
	`created_by_admin_user_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`expires_at` integer NOT NULL,
	`started_at` integer,
	`ready_detected_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_login_sessions_purpose_check" CHECK("account_login_sessions"."purpose" in ('ADD_ACCOUNT', 'RELOGIN')),
	CONSTRAINT "account_login_sessions_status_check" CHECK("account_login_sessions"."status" in ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED')),
	CONSTRAINT "account_login_sessions_failure_code_check" CHECK("account_login_sessions"."failure_code" is null or "account_login_sessions"."failure_code" in ('START_FAILED', 'PROFILE_LEASE_CONFLICT', 'PROFILE_PREPARE_FAILED', 'CONSOLE_START_FAILED', 'AUTH_NOT_READY', 'PROFILE_IDENTITY_UNAVAILABLE', 'PROFILE_IDENTITY_CONFLICT', 'READY_TIMEOUT', 'PROCESS_EXITED', 'FINALIZE_FAILED', 'INTEGRITY_ERROR')),
	CONSTRAINT "account_login_sessions_purpose_target_check" CHECK(("account_login_sessions"."purpose" = 'ADD_ACCOUNT' and "account_login_sessions"."account_id" is null and "account_login_sessions"."pending_account_id" is not null and length(trim("account_login_sessions"."pending_account_id")) > 0) or ("account_login_sessions"."purpose" = 'RELOGIN' and "account_login_sessions"."account_id" is not null and "account_login_sessions"."pending_account_id" is null)),
	CONSTRAINT "account_login_sessions_expires_at_check" CHECK("account_login_sessions"."expires_at" > "account_login_sessions"."created_at"),
	CONSTRAINT "account_login_sessions_completed_at_check" CHECK(("account_login_sessions"."status" = 'COMPLETED' and "account_login_sessions"."completed_at" is not null) or ("account_login_sessions"."status" != 'COMPLETED' and "account_login_sessions"."completed_at" is null)),
	CONSTRAINT "account_login_sessions_cancelled_at_check" CHECK(("account_login_sessions"."status" = 'CANCELLED' and "account_login_sessions"."cancelled_at" is not null) or ("account_login_sessions"."status" != 'CANCELLED' and "account_login_sessions"."cancelled_at" is null)),
	CONSTRAINT "account_login_sessions_failure_check" CHECK(("account_login_sessions"."status" = 'FAILED' and "account_login_sessions"."failure_code" is not null) or ("account_login_sessions"."status" != 'FAILED' and "account_login_sessions"."failure_code" is null))
);--> statement-breakpoint
CREATE UNIQUE INDEX `account_login_sessions_active_relogin_idx` ON `account_login_sessions` (`account_id`) WHERE "account_login_sessions"."account_id" is not null and "account_login_sessions"."status" in ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING');--> statement-breakpoint
CREATE TABLE `avatar_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`content_digest` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`last_referenced_at` integer NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "avatar_assets_cache_key_not_empty_check" CHECK(length(trim("avatar_assets"."cache_key")) > 0),
	CONSTRAINT "avatar_assets_content_digest_not_empty_check" CHECK(length(trim("avatar_assets"."content_digest")) > 0),
	CONSTRAINT "avatar_assets_media_type_check" CHECK("avatar_assets"."media_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
	CONSTRAINT "avatar_assets_byte_size_check" CHECK("avatar_assets"."byte_size" >= 1 and "avatar_assets"."byte_size" <= 5242880)
);--> statement-breakpoint
CREATE UNIQUE INDEX `avatar_assets_cache_key_unique` ON `avatar_assets` (`cache_key`);--> statement-breakpoint
CREATE INDEX `avatar_assets_account_id_idx` ON `avatar_assets` (`account_id`);--> statement-breakpoint
CREATE INDEX `avatar_assets_expires_at_idx` ON `avatar_assets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `contact_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`requested_by_admin_user_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`is_complete` integer DEFAULT false NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`created_count` integer DEFAULT 0 NOT NULL,
	`updated_count` integer DEFAULT 0 NOT NULL,
	`stale_count` integer DEFAULT 0 NOT NULL,
	`unavailable_count` integer DEFAULT 0 NOT NULL,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contact_sync_runs_status_check" CHECK("contact_sync_runs"."status" in ('PENDING', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED', 'AUTH_EXPIRED')),
	CONSTRAINT "contact_sync_runs_failure_code_check" CHECK("contact_sync_runs"."failure_code" is null or "contact_sync_runs"."failure_code" in ('PROFILE_UNAVAILABLE', 'PROFILE_BUSY', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'CHAT_NOT_READY', 'DISCOVERY_TIMEOUT', 'CANDIDATE_LIMIT_REACHED', 'PARSER_CONTRACT_FAILURE', 'BROWSER_FAILURE', 'PERSISTENCE_FAILURE')),
	CONSTRAINT "contact_sync_runs_candidate_count_check" CHECK("contact_sync_runs"."candidate_count" >= 0 and "contact_sync_runs"."candidate_count" <= 500),
	CONSTRAINT "contact_sync_runs_created_count_check" CHECK("contact_sync_runs"."created_count" >= 0 and "contact_sync_runs"."created_count" <= 500),
	CONSTRAINT "contact_sync_runs_updated_count_check" CHECK("contact_sync_runs"."updated_count" >= 0 and "contact_sync_runs"."updated_count" <= 500),
	CONSTRAINT "contact_sync_runs_stale_count_check" CHECK("contact_sync_runs"."stale_count" >= 0 and "contact_sync_runs"."stale_count" <= 500),
	CONSTRAINT "contact_sync_runs_unavailable_count_check" CHECK("contact_sync_runs"."unavailable_count" >= 0 and "contact_sync_runs"."unavailable_count" <= 500),
	CONSTRAINT "contact_sync_runs_issue_count_check" CHECK("contact_sync_runs"."issue_count" >= 0 and "contact_sync_runs"."issue_count" <= 500),
	CONSTRAINT "contact_sync_runs_completion_check" CHECK(("contact_sync_runs"."status" = 'COMPLETE' and "contact_sync_runs"."is_complete" = 1 and "contact_sync_runs"."failure_code" is null) or ("contact_sync_runs"."status" in ('PARTIAL', 'FAILED', 'AUTH_EXPIRED') and "contact_sync_runs"."is_complete" = 0 and "contact_sync_runs"."failure_code" is not null) or ("contact_sync_runs"."status" in ('PENDING', 'RUNNING') and "contact_sync_runs"."is_complete" = 0 and "contact_sync_runs"."failure_code" is null)),
	CONSTRAINT "contact_sync_runs_terminal_finished_check" CHECK(("contact_sync_runs"."status" in ('COMPLETE', 'PARTIAL', 'FAILED', 'AUTH_EXPIRED') and "contact_sync_runs"."finished_at" is not null) or ("contact_sync_runs"."status" in ('PENDING', 'RUNNING') and "contact_sync_runs"."finished_at" is null))
);--> statement-breakpoint
CREATE INDEX `contact_sync_runs_account_created_idx` ON `contact_sync_runs` (`account_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `contact_sync_runs_status_idx` ON `contact_sync_runs` (`status`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`type` text NOT NULL,
	`display_name` text NOT NULL,
	`remark_name` text,
	`avatar_remote_url` text,
	`avatar_asset_id` text,
	`streak_days` integer,
	`streak_updated_at` integer,
	`availability_status` text DEFAULT 'AVAILABLE' NOT NULL,
	`identity_status` text DEFAULT 'UNAVAILABLE' NOT NULL,
	`discovered_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_full_sync_id` text,
	`missed_full_sync_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`avatar_asset_id`) REFERENCES `avatar_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_full_sync_id`) REFERENCES `contact_sync_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "contacts_type_check" CHECK("contacts"."type" in ('PERSON', 'GROUP', 'SYSTEM', 'UNKNOWN')),
	CONSTRAINT "contacts_availability_status_check" CHECK("contacts"."availability_status" in ('AVAILABLE', 'STALE', 'UNAVAILABLE')),
	CONSTRAINT "contacts_identity_status_check" CHECK("contacts"."identity_status" in ('READY', 'UNAVAILABLE', 'CHANGED', 'AMBIGUOUS', 'LEGACY_UNBOUND')),
	CONSTRAINT "contacts_display_name_not_empty_check" CHECK(length(trim("contacts"."display_name")) > 0),
	CONSTRAINT "contacts_remark_name_check" CHECK("contacts"."remark_name" is null or length(trim("contacts"."remark_name")) > 0),
	CONSTRAINT "contacts_avatar_remote_url_check" CHECK("contacts"."avatar_remote_url" is null or length(trim("contacts"."avatar_remote_url")) > 0),
	CONSTRAINT "contacts_streak_days_check" CHECK("contacts"."streak_days" is null or "contacts"."streak_days" >= 0),
	CONSTRAINT "contacts_streak_consistency_check" CHECK(("contacts"."streak_days" is null and "contacts"."streak_updated_at" is null) or ("contacts"."streak_days" is not null and "contacts"."streak_updated_at" is not null)),
	CONSTRAINT "contacts_missed_full_sync_count_check" CHECK("contacts"."missed_full_sync_count" >= 0),
	CONSTRAINT "contacts_timeline_check" CHECK("contacts"."last_seen_at" >= "contacts"."discovered_at")
);--> statement-breakpoint
CREATE INDEX `contacts_account_type_availability_idx` ON `contacts` (`account_id`, `type`, `availability_status`);--> statement-breakpoint
CREATE INDEX `contacts_account_display_name_idx` ON `contacts` (`account_id`, `display_name`);--> statement-breakpoint
CREATE TABLE `contact_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`source` text NOT NULL,
	`state` text DEFAULT 'ACTIVE' NOT NULL,
	`is_preferred` integer DEFAULT false NOT NULL,
	`first_observed_at` integer NOT NULL,
	`last_observed_at` integer NOT NULL,
	`superseded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contact_identities_kind_check" CHECK("contact_identities"."kind" in ('SEC_UID', 'UNIQUE_ID', 'SHORT_ID', 'REMARK_NAME', 'DISPLAY_NAME', 'CONVERSATION_ID')),
	CONSTRAINT "contact_identities_source_check" CHECK("contact_identities"."source" in ('DOM', 'PAGE_DATA', 'RESPONSE_PARSER', 'LEGACY_MANUAL', 'HUMAN_REBIND')),
	CONSTRAINT "contact_identities_state_check" CHECK("contact_identities"."state" in ('ACTIVE', 'SUPERSEDED')),
	CONSTRAINT "contact_identities_value_not_empty_check" CHECK(length(trim("contact_identities"."value")) > 0),
	CONSTRAINT "contact_identities_normalized_value_not_empty_check" CHECK(length(trim("contact_identities"."normalized_value")) > 0),
	CONSTRAINT "contact_identities_observation_timeline_check" CHECK("contact_identities"."first_observed_at" <= "contact_identities"."last_observed_at"),
	CONSTRAINT "contact_identities_superseded_consistency_check" CHECK(("contact_identities"."state" = 'ACTIVE' and "contact_identities"."superseded_at" is null) or ("contact_identities"."state" = 'SUPERSEDED' and "contact_identities"."superseded_at" is not null)),
	CONSTRAINT "contact_identities_preferred_active_check" CHECK("contact_identities"."is_preferred" = 0 or ("contact_identities"."is_preferred" = 1 and "contact_identities"."state" = 'ACTIVE'))
);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_identities_preferred_active_idx` ON `contact_identities` (`contact_id`) WHERE "contact_identities"."is_preferred" = 1 and "contact_identities"."state" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX `contact_identities_stable_active_idx` ON `contact_identities` (`account_id`, `kind`, `normalized_value`) WHERE "contact_identities"."state" = 'ACTIVE' and "contact_identities"."kind" in ('SEC_UID', 'UNIQUE_ID', 'SHORT_ID', 'CONVERSATION_ID');--> statement-breakpoint
CREATE INDEX `contact_identities_contact_state_idx` ON `contact_identities` (`contact_id`, `state`);--> statement-breakpoint
CREATE INDEX `contact_identities_account_kind_normalized_idx` ON `contact_identities` (`account_id`, `kind`, `normalized_value`);--> statement-breakpoint
CREATE INDEX `contact_identities_contact_last_observed_idx` ON `contact_identities` (`contact_id`, `last_observed_at`);--> statement-breakpoint
CREATE TABLE `send_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`account_id` text NOT NULL,
	`template_id` text NOT NULL,
	`schedule_type` text DEFAULT 'DAILY_WINDOW' NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`timezone` text NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`retry_interval_seconds` integer DEFAULT 60 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "send_tasks_name_not_empty_check" CHECK(length(trim("send_tasks"."name")) > 0),
	CONSTRAINT "send_tasks_timezone_not_empty_check" CHECK(length(trim("send_tasks"."timezone")) > 0),
	CONSTRAINT "send_tasks_schedule_type_check" CHECK("send_tasks"."schedule_type" in ('DAILY_WINDOW')),
	CONSTRAINT "send_tasks_max_attempts_check" CHECK("send_tasks"."max_attempts" >= 1 and "send_tasks"."max_attempts" <= 5),
	CONSTRAINT "send_tasks_retry_interval_seconds_check" CHECK("send_tasks"."retry_interval_seconds" >= 1 and "send_tasks"."retry_interval_seconds" <= 86400),
	CONSTRAINT "send_tasks_archived_enabled_check" CHECK("send_tasks"."archived_at" is null or "send_tasks"."enabled" = 0)
);--> statement-breakpoint
CREATE INDEX `send_tasks_account_id_idx` ON `send_tasks` (`account_id`);--> statement-breakpoint
CREATE INDEX `send_tasks_enabled_idx` ON `send_tasks` (`enabled`);--> statement-breakpoint
CREATE INDEX `send_tasks_template_id_idx` ON `send_tasks` (`template_id`);--> statement-breakpoint
CREATE TABLE `send_task_targets` (
	`task_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `contact_id`),
	FOREIGN KEY (`task_id`) REFERENCES `send_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `send_task_targets_contact_id_idx` ON `send_task_targets` (`contact_id`);--> statement-breakpoint
CREATE TABLE `execution_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`account_id` text NOT NULL,
	`task_id` text,
	`template_id` text NOT NULL,
	`requested_by_admin_user_id` text,
	`business_date` text,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`confirmed_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `send_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "execution_runs_kind_check" CHECK("execution_runs"."kind" in ('TEST_SEND', 'SCHEDULED_TASK')),
	CONSTRAINT "execution_runs_status_check" CHECK("execution_runs"."status" in ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED', 'DELIVERY_UNKNOWN', 'AUTH_EXPIRED', 'CANCELLED')),
	CONSTRAINT "execution_runs_idempotency_key_not_empty_check" CHECK(length(trim("execution_runs"."idempotency_key")) > 0),
	CONSTRAINT "execution_runs_scheduled_check" CHECK(("execution_runs"."kind" = 'SCHEDULED_TASK' and "execution_runs"."task_id" is not null and "execution_runs"."business_date" is not null and "execution_runs"."requested_by_admin_user_id" is null and "execution_runs"."confirmed_at" is null) or ("execution_runs"."kind" = 'TEST_SEND' and "execution_runs"."task_id" is null and "execution_runs"."business_date" is null and "execution_runs"."requested_by_admin_user_id" is not null and "execution_runs"."confirmed_at" is not null)),
	CONSTRAINT "execution_runs_business_date_format_check" CHECK("execution_runs"."business_date" is null or length("execution_runs"."business_date") = 10),
	CONSTRAINT "execution_runs_terminal_finished_check" CHECK(("execution_runs"."status" in ('SUCCESS', 'PARTIAL_FAILED', 'FAILED', 'DELIVERY_UNKNOWN', 'AUTH_EXPIRED', 'CANCELLED') and "execution_runs"."finished_at" is not null) or ("execution_runs"."status" in ('PENDING', 'RUNNING') and "execution_runs"."finished_at" is null))
);--> statement-breakpoint
CREATE UNIQUE INDEX `execution_runs_idempotency_key_unique` ON `execution_runs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `execution_runs_account_created_idx` ON `execution_runs` (`account_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `execution_runs_task_business_date_idx` ON `execution_runs` (`task_id`, `business_date`);--> statement-breakpoint
CREATE INDEX `execution_runs_status_created_idx` ON `execution_runs` (`status`, `created_at`);--> statement-breakpoint
CREATE TABLE `target_send_records` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`task_id` text,
	`contact_id` text NOT NULL,
	`business_date` text,
	`template_id` text,
	`message_text` text NOT NULL,
	`machine_status` text DEFAULT 'READY' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`failure_code` text,
	`target_identity_kind_snapshot` text NOT NULL,
	`target_identity_value_digest` text NOT NULL,
	`send_action_started_at` integer,
	`sent_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `execution_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `send_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "target_send_records_message_text_not_empty_check" CHECK(length(trim("target_send_records"."message_text")) > 0),
	CONSTRAINT "target_send_records_digest_not_empty_check" CHECK(length(trim("target_send_records"."target_identity_value_digest")) > 0),
	CONSTRAINT "target_send_records_identity_kind_check" CHECK("target_send_records"."target_identity_kind_snapshot" in ('SEC_UID', 'UNIQUE_ID', 'SHORT_ID', 'REMARK_NAME', 'DISPLAY_NAME', 'CONVERSATION_ID')),
	CONSTRAINT "target_send_records_machine_status_check" CHECK("target_send_records"."machine_status" in ('READY', 'RUNNING', 'RETRY_WAIT', 'SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN', 'SKIPPED')),
	CONSTRAINT "target_send_records_attempt_count_check" CHECK("target_send_records"."attempt_count" >= 0 and "target_send_records"."attempt_count" <= 5),
	CONSTRAINT "target_send_records_failure_code_check" CHECK("target_send_records"."failure_code" is null or "target_send_records"."failure_code" in ('NAVIGATION_FAILED', 'PAGE_LOAD_TIMEOUT', 'CONTACT_LIST_NOT_READY', 'TARGET_NOT_FOUND', 'TARGET_AMBIGUOUS', 'TARGET_IDENTITY_UNAVAILABLE', 'IDENTITY_CHANGED', 'CONVERSATION_VERIFICATION_FAILED', 'COMPOSER_NOT_READY', 'MESSAGE_INPUT_FAILED', 'SEND_ACTION_NOT_TRIGGERED', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'CAPTCHA_OR_RISK_CONTROL', 'BROWSER_FAILURE', 'PROFILE_UNAVAILABLE', 'TEMPLATE_INVALID', 'CONFIG_INVALID', 'PROCESS_INTERRUPTED_BEFORE_SEND', 'RETRY_WINDOW_EXPIRED', 'MAX_ATTEMPTS_EXHAUSTED', 'BATCH_ABORTED', 'DELIVERY_VERIFICATION_TIMEOUT', 'DELIVERY_EVIDENCE_INSUFFICIENT', 'PAGE_CLOSED_AFTER_ACTION', 'NAVIGATION_AFTER_ACTION', 'AUTH_STATE_CHANGED_AFTER_ACTION', 'PROCESS_INTERRUPTED_AFTER_ACTION')),
	CONSTRAINT "target_send_records_scheduled_tuple_check" CHECK(("target_send_records"."task_id" is null and "target_send_records"."business_date" is null) or ("target_send_records"."task_id" is not null and "target_send_records"."business_date" is not null)),
	CONSTRAINT "target_send_records_retry_wait_check" CHECK(("target_send_records"."machine_status" = 'RETRY_WAIT' and "target_send_records"."next_retry_at" is not null) or ("target_send_records"."machine_status" != 'RETRY_WAIT' and "target_send_records"."next_retry_at" is null)),
	CONSTRAINT "target_send_records_failure_code_presence_check" CHECK(("target_send_records"."machine_status" in ('READY', 'RUNNING', 'SUCCESS') and "target_send_records"."failure_code" is null) or ("target_send_records"."machine_status" in ('RETRY_WAIT', 'FAILED', 'DELIVERY_UNKNOWN', 'SKIPPED') and "target_send_records"."failure_code" is not null)),
	CONSTRAINT "target_send_records_success_check" CHECK("target_send_records"."machine_status" != 'SUCCESS' or ("target_send_records"."send_action_started_at" is not null and "target_send_records"."sent_at" is not null)),
	CONSTRAINT "target_send_records_delivery_unknown_check" CHECK("target_send_records"."machine_status" != 'DELIVERY_UNKNOWN' or ("target_send_records"."send_action_started_at" is not null and "target_send_records"."failure_code" in ('DELIVERY_VERIFICATION_TIMEOUT', 'DELIVERY_EVIDENCE_INSUFFICIENT', 'PAGE_CLOSED_AFTER_ACTION', 'NAVIGATION_AFTER_ACTION', 'AUTH_STATE_CHANGED_AFTER_ACTION', 'PROCESS_INTERRUPTED_AFTER_ACTION'))),
	CONSTRAINT "target_send_records_failed_skipped_check" CHECK("target_send_records"."machine_status" not in ('FAILED', 'SKIPPED') or "target_send_records"."sent_at" is null),
	CONSTRAINT "target_send_records_finished_check" CHECK(("target_send_records"."machine_status" in ('SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN', 'SKIPPED') and "target_send_records"."finished_at" is not null) or ("target_send_records"."machine_status" in ('READY', 'RUNNING', 'RETRY_WAIT') and "target_send_records"."finished_at" is null))
);--> statement-breakpoint
CREATE UNIQUE INDEX `target_send_records_run_contact_unique_idx` ON `target_send_records` (`run_id`, `contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `target_send_records_task_contact_date_unique_idx` ON `target_send_records` (`task_id`, `contact_id`, `business_date`) WHERE "target_send_records"."task_id" is not null and "target_send_records"."business_date" is not null;--> statement-breakpoint
CREATE INDEX `target_send_records_contact_created_idx` ON `target_send_records` (`contact_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `target_send_records_status_idx` ON `target_send_records` (`machine_status`);--> statement-breakpoint
CREATE TABLE `delivery_resolutions` (
	`id` text PRIMARY KEY NOT NULL,
	`target_send_record_id` text,
	`legacy_send_record_id` text,
	`original_machine_status` text NOT NULL,
	`resolution` text NOT NULL,
	`source` text DEFAULT 'HUMAN' NOT NULL,
	`resolved_by_admin_user_id` text NOT NULL,
	`note` text,
	`supersedes_resolution_id` text,
	`resolved_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_send_record_id`) REFERENCES `target_send_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`legacy_send_record_id`) REFERENCES `send_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_resolution_id`) REFERENCES `delivery_resolutions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "delivery_resolutions_source_record_check" CHECK(("delivery_resolutions"."target_send_record_id" is not null and "delivery_resolutions"."legacy_send_record_id" is null) or ("delivery_resolutions"."target_send_record_id" is null and "delivery_resolutions"."legacy_send_record_id" is not null)),
	CONSTRAINT "delivery_resolutions_original_status_check" CHECK("delivery_resolutions"."original_machine_status" = 'DELIVERY_UNKNOWN'),
	CONSTRAINT "delivery_resolutions_resolution_check" CHECK("delivery_resolutions"."resolution" in ('CONFIRMED_DELIVERED', 'CONFIRMED_NOT_DELIVERED', 'INCONCLUSIVE')),
	CONSTRAINT "delivery_resolutions_source_check" CHECK("delivery_resolutions"."source" in ('HUMAN')),
	CONSTRAINT "delivery_resolutions_note_check" CHECK("delivery_resolutions"."note" is null or (length(trim("delivery_resolutions"."note")) > 0 and length("delivery_resolutions"."note") <= 500))
);--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_resolutions_supersedes_resolution_id_unique` ON `delivery_resolutions` (`supersedes_resolution_id`);--> statement-breakpoint
CREATE INDEX `delivery_resolutions_target_send_record_id_idx` ON `delivery_resolutions` (`target_send_record_id`);--> statement-breakpoint
CREATE INDEX `delivery_resolutions_legacy_send_record_id_idx` ON `delivery_resolutions` (`legacy_send_record_id`);--> statement-breakpoint
CREATE INDEX `delivery_resolutions_resolved_by_idx` ON `delivery_resolutions` (`resolved_by_admin_user_id`);--> statement-breakpoint
CREATE INDEX `delivery_resolutions_resolved_at_idx` ON `delivery_resolutions` (`resolved_at`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_admin_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`outcome` text NOT NULL,
	`reason_code` text,
	`correlation_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "audit_events_outcome_check" CHECK("audit_events"."outcome" in ('SUCCESS', 'REJECTED', 'FAILED')),
	CONSTRAINT "audit_events_action_check" CHECK("audit_events"."action" in ('ADMIN_INITIALIZED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_REVOKED', 'PASSWORD_CHANGED', 'ACCOUNT_LOGIN_STARTED', 'ACCOUNT_LOGIN_CANCELLED', 'ACCOUNT_CREATED', 'ACCOUNT_RELOGIN_COMPLETED', 'ACCOUNT_UNBOUND', 'CONTACT_SYNC_STARTED', 'CONTACT_SYNC_FINISHED', 'PREFERRED_IDENTITY_CHANGED', 'LEGACY_FRIEND_BOUND', 'LEGACY_FRIEND_DISMISSED', 'TEMPLATE_CREATED', 'TEMPLATE_UPDATED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_ENABLED', 'TASK_DISABLED', 'TASK_ARCHIVED', 'TEST_SEND_CONFIRMED', 'DELIVERY_RESOLVED', 'NOTIFICATION_CONFIG_UPDATED', 'NOTIFICATION_TEST_CONFIRMED', 'SESSION_CLEANUP', 'PROFILE_QUARANTINED')),
	CONSTRAINT "audit_events_entity_type_check" CHECK("audit_events"."entity_type" in ('ADMIN_USER', 'ADMIN_SESSION', 'ACCOUNT_LOGIN_SESSION', 'DOUYIN_ACCOUNT', 'CONTACT_SYNC_RUN', 'CONTACT', 'CONTACT_IDENTITY', 'TEMPLATE', 'SEND_TASK', 'EXECUTION_RUN', 'TARGET_SEND_RECORD', 'DELIVERY_RESOLUTION', 'NOTIFICATION_CONFIG', 'LEGACY_FRIEND_BINDING', 'LEGACY_SCHEDULE_IMPORT', 'SYSTEM')),
	CONSTRAINT "audit_events_entity_id_check" CHECK("audit_events"."entity_id" is null or length(trim("audit_events"."entity_id")) > 0),
	CONSTRAINT "audit_events_reason_code_check" CHECK("audit_events"."reason_code" is null or length(trim("audit_events"."reason_code")) > 0),
	CONSTRAINT "audit_events_correlation_digest_check" CHECK("audit_events"."correlation_digest" is null or length(trim("audit_events"."correlation_digest")) > 0)
);--> statement-breakpoint
CREATE INDEX `audit_events_created_at_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_created_idx` ON `audit_events` (`actor_admin_user_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_created_idx` ON `audit_events` (`entity_type`, `entity_id`, `created_at`);--> statement-breakpoint
CREATE TABLE `legacy_friend_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`friend_id` text NOT NULL,
	`account_id` text NOT NULL,
	`contact_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`bound_by_admin_user_id` text,
	`bound_at` integer,
	`dismissed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`friend_id`) REFERENCES `friends`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bound_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "legacy_friend_bindings_status_check" CHECK("legacy_friend_bindings"."status" in ('PENDING', 'BOUND', 'DISMISSED')),
	CONSTRAINT "legacy_friend_bindings_status_fields_check" CHECK(("legacy_friend_bindings"."status" = 'PENDING' and "legacy_friend_bindings"."contact_id" is null and "legacy_friend_bindings"."bound_by_admin_user_id" is null and "legacy_friend_bindings"."bound_at" is null and "legacy_friend_bindings"."dismissed_at" is null) or ("legacy_friend_bindings"."status" = 'BOUND' and "legacy_friend_bindings"."contact_id" is not null and "legacy_friend_bindings"."bound_by_admin_user_id" is not null and "legacy_friend_bindings"."bound_at" is not null and "legacy_friend_bindings"."dismissed_at" is null) or ("legacy_friend_bindings"."status" = 'DISMISSED' and "legacy_friend_bindings"."contact_id" is null and "legacy_friend_bindings"."bound_by_admin_user_id" is null and "legacy_friend_bindings"."bound_at" is null and "legacy_friend_bindings"."dismissed_at" is not null))
);--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_friend_bindings_friend_id_unique` ON `legacy_friend_bindings` (`friend_id`);--> statement-breakpoint
CREATE INDEX `legacy_friend_bindings_account_id_idx` ON `legacy_friend_bindings` (`account_id`);--> statement-breakpoint
CREATE INDEX `legacy_friend_bindings_contact_id_idx` ON `legacy_friend_bindings` (`contact_id`);--> statement-breakpoint
CREATE INDEX `legacy_friend_bindings_status_idx` ON `legacy_friend_bindings` (`status`);--> statement-breakpoint
CREATE TABLE `legacy_schedule_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`account_id` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`timezone` text NOT NULL,
	`max_attempts` integer NOT NULL,
	`retry_interval_seconds` integer NOT NULL,
	`legacy_enabled_snapshot` integer NOT NULL,
	`converted_task_id` text,
	`converted_by_admin_user_id` text,
	`converted_at` integer,
	`dismissed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`converted_task_id`) REFERENCES `send_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`converted_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "legacy_schedule_imports_status_check" CHECK("legacy_schedule_imports"."status" in ('PENDING', 'CONVERTED', 'DISMISSED')),
	CONSTRAINT "legacy_schedule_imports_timezone_not_empty_check" CHECK(length(trim("legacy_schedule_imports"."timezone")) > 0),
	CONSTRAINT "legacy_schedule_imports_max_attempts_check" CHECK("legacy_schedule_imports"."max_attempts" >= 1 and "legacy_schedule_imports"."max_attempts" <= 5),
	CONSTRAINT "legacy_schedule_imports_retry_interval_seconds_check" CHECK("legacy_schedule_imports"."retry_interval_seconds" >= 1 and "legacy_schedule_imports"."retry_interval_seconds" <= 86400),
	CONSTRAINT "legacy_schedule_imports_status_fields_check" CHECK(("legacy_schedule_imports"."status" = 'PENDING' and "legacy_schedule_imports"."converted_task_id" is null and "legacy_schedule_imports"."converted_by_admin_user_id" is null and "legacy_schedule_imports"."converted_at" is null and "legacy_schedule_imports"."dismissed_at" is null) or ("legacy_schedule_imports"."status" = 'CONVERTED' and "legacy_schedule_imports"."converted_task_id" is not null and "legacy_schedule_imports"."converted_by_admin_user_id" is not null and "legacy_schedule_imports"."converted_at" is not null and "legacy_schedule_imports"."dismissed_at" is null) or ("legacy_schedule_imports"."status" = 'DISMISSED' and "legacy_schedule_imports"."converted_task_id" is null and "legacy_schedule_imports"."converted_by_admin_user_id" is null and "legacy_schedule_imports"."converted_at" is null and "legacy_schedule_imports"."dismissed_at" is not null))
);--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_schedule_imports_schedule_id_unique` ON `legacy_schedule_imports` (`schedule_id`);--> statement-breakpoint
CREATE INDEX `legacy_schedule_imports_account_id_idx` ON `legacy_schedule_imports` (`account_id`);--> statement-breakpoint
CREATE INDEX `legacy_schedule_imports_converted_task_id_idx` ON `legacy_schedule_imports` (`converted_task_id`);--> statement-breakpoint
CREATE INDEX `legacy_schedule_imports_status_idx` ON `legacy_schedule_imports` (`status`);--> statement-breakpoint
INSERT INTO `legacy_friend_bindings` (
	`id`,
	`friend_id`,
	`account_id`,
	`contact_id`,
	`status`,
	`bound_by_admin_user_id`,
	`bound_at`,
	`dismissed_at`,
	`created_at`,
	`updated_at`
)
SELECT
	'v4:legacy-friend-binding:' || `id`,
	`id`,
	`account_id`,
	NULL,
	'PENDING',
	NULL,
	NULL,
	NULL,
	`created_at`,
	`updated_at`
FROM `friends`
WHERE NOT EXISTS (
	SELECT 1 FROM `legacy_friend_bindings` WHERE `legacy_friend_bindings`.`friend_id` = `friends`.`id`
);--> statement-breakpoint
INSERT INTO `legacy_schedule_imports` (
	`id`,
	`schedule_id`,
	`account_id`,
	`status`,
	`start_time`,
	`end_time`,
	`timezone`,
	`max_attempts`,
	`retry_interval_seconds`,
	`legacy_enabled_snapshot`,
	`converted_task_id`,
	`converted_by_admin_user_id`,
	`converted_at`,
	`dismissed_at`,
	`created_at`,
	`updated_at`
)
SELECT
	'v4:legacy-schedule-import:' || `id`,
	`id`,
	`account_id`,
	'PENDING',
	`start_time`,
	`end_time`,
	`timezone`,
	`max_attempts`,
	`retry_interval_seconds`,
	`enabled`,
	NULL,
	NULL,
	NULL,
	NULL,
	`created_at`,
	`updated_at`
FROM `schedules`
WHERE NOT EXISTS (
	SELECT 1 FROM `legacy_schedule_imports` WHERE `legacy_schedule_imports`.`schedule_id` = `schedules`.`id`
);
