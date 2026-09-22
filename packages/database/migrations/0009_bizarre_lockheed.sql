PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account_login_sessions` (
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
	`idempotency_key_digest` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_login_sessions_purpose_check" CHECK("__new_account_login_sessions"."purpose" in ('ADD_ACCOUNT', 'RELOGIN')),
	CONSTRAINT "account_login_sessions_status_check" CHECK("__new_account_login_sessions"."status" in ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED')),
	CONSTRAINT "account_login_sessions_failure_code_check" CHECK("__new_account_login_sessions"."failure_code" is null or "__new_account_login_sessions"."failure_code" in ('START_FAILED', 'PROFILE_LEASE_CONFLICT', 'PROFILE_PREPARE_FAILED', 'CONSOLE_START_FAILED', 'AUTH_NOT_READY', 'PROFILE_IDENTITY_UNAVAILABLE', 'PROFILE_IDENTITY_CONFLICT', 'READY_TIMEOUT', 'PROCESS_EXITED', 'FINALIZE_FAILED', 'INTEGRITY_ERROR')),
	CONSTRAINT "account_login_sessions_purpose_target_check" CHECK(("__new_account_login_sessions"."purpose" = 'ADD_ACCOUNT' and "__new_account_login_sessions"."account_id" is null and "__new_account_login_sessions"."pending_account_id" is not null and length(trim("__new_account_login_sessions"."pending_account_id")) > 0) or ("__new_account_login_sessions"."purpose" = 'RELOGIN' and "__new_account_login_sessions"."account_id" is not null and "__new_account_login_sessions"."pending_account_id" is null)),
	CONSTRAINT "account_login_sessions_expires_at_check" CHECK("__new_account_login_sessions"."expires_at" > "__new_account_login_sessions"."created_at"),
	CONSTRAINT "account_login_sessions_completed_at_check" CHECK(("__new_account_login_sessions"."status" = 'COMPLETED' and "__new_account_login_sessions"."completed_at" is not null) or ("__new_account_login_sessions"."status" != 'COMPLETED' and "__new_account_login_sessions"."completed_at" is null)),
	CONSTRAINT "account_login_sessions_cancelled_at_check" CHECK(("__new_account_login_sessions"."status" = 'CANCELLED' and "__new_account_login_sessions"."cancelled_at" is not null) or ("__new_account_login_sessions"."status" != 'CANCELLED' and "__new_account_login_sessions"."cancelled_at" is null)),
	CONSTRAINT "account_login_sessions_failure_check" CHECK(("__new_account_login_sessions"."status" = 'FAILED' and "__new_account_login_sessions"."failure_code" is not null) or ("__new_account_login_sessions"."status" != 'FAILED' and "__new_account_login_sessions"."failure_code" is null)),
	CONSTRAINT "account_login_sessions_idempotency_digest_check" CHECK("__new_account_login_sessions"."idempotency_key_digest" is null or (length("__new_account_login_sessions"."idempotency_key_digest") = 64 and "__new_account_login_sessions"."idempotency_key_digest" not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
INSERT INTO `__new_account_login_sessions`("id", "purpose", "account_id", "pending_account_id", "created_by_admin_user_id", "status", "expires_at", "started_at", "ready_detected_at", "completed_at", "cancelled_at", "failure_code", "created_at", "updated_at", "idempotency_key_digest") SELECT "id", "purpose", "account_id", "pending_account_id", "created_by_admin_user_id", "status", "expires_at", "started_at", "ready_detected_at", "completed_at", "cancelled_at", "failure_code", "created_at", "updated_at", NULL FROM `account_login_sessions`;--> statement-breakpoint
DROP TABLE `account_login_sessions`;--> statement-breakpoint
ALTER TABLE `__new_account_login_sessions` RENAME TO `account_login_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `account_login_sessions_active_relogin_idx` ON `account_login_sessions` (`account_id`) WHERE "account_login_sessions"."account_id" is not null and "account_login_sessions"."status" in ('PENDING', 'STARTING', 'AWAITING_USER', 'READY_DETECTED', 'COMPLETING');--> statement-breakpoint
CREATE UNIQUE INDEX `account_login_sessions_admin_idempotency_unique_idx` ON `account_login_sessions` (`created_by_admin_user_id`,`idempotency_key_digest`) WHERE "account_login_sessions"."idempotency_key_digest" is not null;
