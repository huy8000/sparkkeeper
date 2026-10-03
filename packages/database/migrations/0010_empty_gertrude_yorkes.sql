PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contact_sync_runs` (
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
	`idempotency_key_digest` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contact_sync_runs_status_check" CHECK("__new_contact_sync_runs"."status" in ('PENDING', 'RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED', 'AUTH_EXPIRED')),
	CONSTRAINT "contact_sync_runs_failure_code_check" CHECK("__new_contact_sync_runs"."failure_code" is null or "__new_contact_sync_runs"."failure_code" in ('PROFILE_UNAVAILABLE', 'PROFILE_BUSY', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'CHAT_NOT_READY', 'DISCOVERY_TIMEOUT', 'CANDIDATE_LIMIT_REACHED', 'PARSER_CONTRACT_FAILURE', 'BROWSER_FAILURE', 'PERSISTENCE_FAILURE', 'DISCOVERY_STALLED', 'PROCESS_INTERRUPTED')),
	CONSTRAINT "contact_sync_runs_candidate_count_check" CHECK("__new_contact_sync_runs"."candidate_count" >= 0 and "__new_contact_sync_runs"."candidate_count" <= 500),
	CONSTRAINT "contact_sync_runs_created_count_check" CHECK("__new_contact_sync_runs"."created_count" >= 0 and "__new_contact_sync_runs"."created_count" <= 500),
	CONSTRAINT "contact_sync_runs_updated_count_check" CHECK("__new_contact_sync_runs"."updated_count" >= 0 and "__new_contact_sync_runs"."updated_count" <= 500),
	CONSTRAINT "contact_sync_runs_stale_count_check" CHECK("__new_contact_sync_runs"."stale_count" >= 0),
	CONSTRAINT "contact_sync_runs_unavailable_count_check" CHECK("__new_contact_sync_runs"."unavailable_count" >= 0),
	CONSTRAINT "contact_sync_runs_issue_count_check" CHECK("__new_contact_sync_runs"."issue_count" >= 0 and "__new_contact_sync_runs"."issue_count" <= 500),
	CONSTRAINT "contact_sync_runs_completion_check" CHECK(("__new_contact_sync_runs"."status" = 'COMPLETE' and "__new_contact_sync_runs"."is_complete" = 1 and "__new_contact_sync_runs"."failure_code" is null) or ("__new_contact_sync_runs"."status" in ('PARTIAL', 'FAILED', 'AUTH_EXPIRED') and "__new_contact_sync_runs"."is_complete" = 0 and "__new_contact_sync_runs"."failure_code" is not null) or ("__new_contact_sync_runs"."status" in ('PENDING', 'RUNNING') and "__new_contact_sync_runs"."is_complete" = 0 and "__new_contact_sync_runs"."failure_code" is null)),
	CONSTRAINT "contact_sync_runs_terminal_finished_check" CHECK(("__new_contact_sync_runs"."status" in ('COMPLETE', 'PARTIAL', 'FAILED', 'AUTH_EXPIRED') and "__new_contact_sync_runs"."finished_at" is not null) or ("__new_contact_sync_runs"."status" in ('PENDING', 'RUNNING') and "__new_contact_sync_runs"."finished_at" is null)),
	CONSTRAINT "contact_sync_runs_digest_check" CHECK("__new_contact_sync_runs"."idempotency_key_digest" is null or (length("__new_contact_sync_runs"."idempotency_key_digest") = 64 and "__new_contact_sync_runs"."idempotency_key_digest" not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
INSERT INTO `__new_contact_sync_runs`("id", "account_id", "requested_by_admin_user_id", "status", "is_complete", "candidate_count", "created_count", "updated_count", "stale_count", "unavailable_count", "issue_count", "failure_code", "started_at", "finished_at", "created_at", "updated_at", "idempotency_key_digest") SELECT "id", "account_id", "requested_by_admin_user_id", "status", "is_complete", "candidate_count", "created_count", "updated_count", "stale_count", "unavailable_count", "issue_count", "failure_code", "started_at", "finished_at", "created_at", "updated_at", NULL FROM `contact_sync_runs`;--> statement-breakpoint
DROP TABLE `contact_sync_runs`;--> statement-breakpoint
ALTER TABLE `__new_contact_sync_runs` RENAME TO `contact_sync_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `contact_sync_runs_account_created_idx` ON `contact_sync_runs` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_sync_runs_status_idx` ON `contact_sync_runs` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_sync_runs_admin_idempotency_idx` ON `contact_sync_runs` (`requested_by_admin_user_id`,`idempotency_key_digest`) WHERE "contact_sync_runs"."idempotency_key_digest" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `contact_sync_runs_active_global_idx` ON `contact_sync_runs` (1) WHERE "contact_sync_runs"."status" in ('PENDING', 'RUNNING');--> statement-breakpoint
CREATE TABLE `__new_contacts` (
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
	`first_missing_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`avatar_asset_id`) REFERENCES `avatar_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`last_full_sync_id`) REFERENCES `contact_sync_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "contacts_type_check" CHECK("__new_contacts"."type" in ('PERSON', 'GROUP', 'SYSTEM', 'UNKNOWN')),
	CONSTRAINT "contacts_availability_status_check" CHECK("__new_contacts"."availability_status" in ('AVAILABLE', 'STALE', 'UNAVAILABLE')),
	CONSTRAINT "contacts_identity_status_check" CHECK("__new_contacts"."identity_status" in ('READY', 'UNAVAILABLE', 'CHANGED', 'AMBIGUOUS', 'LEGACY_UNBOUND')),
	CONSTRAINT "contacts_display_name_not_empty_check" CHECK(length(trim("__new_contacts"."display_name")) > 0),
	CONSTRAINT "contacts_remark_name_check" CHECK("__new_contacts"."remark_name" is null or length(trim("__new_contacts"."remark_name")) > 0),
	CONSTRAINT "contacts_avatar_remote_url_check" CHECK("__new_contacts"."avatar_remote_url" is null or length(trim("__new_contacts"."avatar_remote_url")) > 0),
	CONSTRAINT "contacts_streak_days_check" CHECK("__new_contacts"."streak_days" is null or "__new_contacts"."streak_days" >= 0),
	CONSTRAINT "contacts_streak_consistency_check" CHECK(("__new_contacts"."streak_days" is null and "__new_contacts"."streak_updated_at" is null) or ("__new_contacts"."streak_days" is not null and "__new_contacts"."streak_updated_at" is not null)),
	CONSTRAINT "contacts_missed_full_sync_count_check" CHECK("__new_contacts"."missed_full_sync_count" >= 0),
	CONSTRAINT "contacts_missing_time_check" CHECK(("__new_contacts"."missed_full_sync_count" = 0 and "__new_contacts"."first_missing_at" is null) or ("__new_contacts"."missed_full_sync_count" > 0 and "__new_contacts"."first_missing_at" is not null)),
	CONSTRAINT "contacts_timeline_check" CHECK("__new_contacts"."last_seen_at" >= "__new_contacts"."discovered_at")
);
--> statement-breakpoint
INSERT INTO `__new_contacts`("id", "account_id", "type", "display_name", "remark_name", "avatar_remote_url", "avatar_asset_id", "streak_days", "streak_updated_at", "availability_status", "identity_status", "discovered_at", "last_seen_at", "last_full_sync_id", "missed_full_sync_count", "created_at", "updated_at", "first_missing_at") SELECT "id", "account_id", "type", "display_name", "remark_name", "avatar_remote_url", "avatar_asset_id", "streak_days", "streak_updated_at", "availability_status", "identity_status", "discovered_at", "last_seen_at", "last_full_sync_id", "missed_full_sync_count", "created_at", "updated_at", CASE WHEN "missed_full_sync_count" > 0 THEN CAST(strftime('%s','now') AS integer) * 1000 ELSE NULL END FROM `contacts`;--> statement-breakpoint
DROP TABLE `contacts`;--> statement-breakpoint
ALTER TABLE `__new_contacts` RENAME TO `contacts`;--> statement-breakpoint
CREATE INDEX `contacts_account_type_availability_idx` ON `contacts` (`account_id`,`type`,`availability_status`);--> statement-breakpoint
CREATE INDEX `contacts_account_display_name_idx` ON `contacts` (`account_id`,`display_name`);--> statement-breakpoint
CREATE INDEX `contacts_account_cursor_idx` ON `contacts` (`account_id`,`created_at`,`id`);
