PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_send_records` (
	`id` text PRIMARY KEY NOT NULL,
	`daily_run_id` text NOT NULL,
	`friend_id` text NOT NULL,
	`business_date` text NOT NULL,
	`message_template_id` text,
	`message_text` text NOT NULL,
	`status` text DEFAULT 'READY' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`last_error_code` text,
	`sent_at` integer,
	`send_action_started_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`daily_run_id`) REFERENCES `daily_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`friend_id`) REFERENCES `friends`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "send_records_business_date_check" CHECK(strftime('%Y-%m-%d', "__new_send_records"."business_date") = "__new_send_records"."business_date"),
	CONSTRAINT "send_records_message_text_not_empty_check" CHECK(length(trim("__new_send_records"."message_text")) > 0),
	CONSTRAINT "send_records_status_check" CHECK("__new_send_records"."status" in ('READY', 'RUNNING', 'RETRY_WAIT', 'SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN')),
	CONSTRAINT "send_records_attempt_count_check" CHECK("__new_send_records"."attempt_count" between 0 and 5),
	CONSTRAINT "send_records_retry_wait_check" CHECK(("__new_send_records"."status" = 'RETRY_WAIT' and "__new_send_records"."next_retry_at" is not null and "__new_send_records"."finished_at" is null) or ("__new_send_records"."status" <> 'RETRY_WAIT' and "__new_send_records"."next_retry_at" is null)),
	CONSTRAINT "send_records_last_error_code_check" CHECK("__new_send_records"."last_error_code" is null or "__new_send_records"."last_error_code" in ('NETWORK_TRANSIENT', 'PAGE_LOAD_TIMEOUT', 'CONTACT_LIST_NOT_READY', 'BROWSER_TRANSIENT', 'CONTACT_NOT_FOUND', 'AMBIGUOUS_CONTACT', 'SELECTOR_FAILURE', 'CONVERSATION_VERIFICATION_FAILED', 'MESSAGE_INPUT_FAILED', 'SEND_ACTION_FAILED', 'VERIFY_FAILED', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'TEMPLATE_INVALID', 'CONFIG_INVALID', 'PROCESS_INTERRUPTED_BEFORE_SEND', 'RETRY_WINDOW_EXPIRED', 'MAX_ATTEMPTS_EXHAUSTED', 'DELIVERY_UNKNOWN'))
);
--> statement-breakpoint
INSERT INTO `__new_send_records`("id", "daily_run_id", "friend_id", "business_date", "message_template_id", "message_text", "status", "attempt_count", "next_retry_at", "last_error_code", "sent_at", "send_action_started_at", "started_at", "finished_at", "created_at", "updated_at")
SELECT
	"id",
	"daily_run_id",
	"friend_id",
	"business_date",
	"message_template_id",
	"message_text",
	"status",
	CASE WHEN "status" = 'READY' THEN 0 ELSE 1 END,
	NULL,
	CASE WHEN "status" = 'DELIVERY_UNKNOWN' THEN 'DELIVERY_UNKNOWN' ELSE NULL END,
	CASE WHEN "status" = 'SUCCESS' THEN coalesce("finished_at", "updated_at") ELSE NULL END,
	CASE WHEN "status" IN ('RUNNING', 'SUCCESS', 'DELIVERY_UNKNOWN') THEN coalesce("started_at", "updated_at") ELSE NULL END,
	"started_at",
	"finished_at",
	"created_at",
	"updated_at"
FROM `send_records`;--> statement-breakpoint
DROP TABLE `send_records`;--> statement-breakpoint
ALTER TABLE `__new_send_records` RENAME TO `send_records`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `send_records_friend_business_date_unique` ON `send_records` (`friend_id`,`business_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `send_records_daily_run_friend_unique` ON `send_records` (`daily_run_id`,`friend_id`);--> statement-breakpoint
CREATE TABLE `__new_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`timezone` text NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`retry_interval_seconds` integer DEFAULT 60 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "schedules_start_time_check" CHECK("__new_schedules"."start_time" glob '[0-2][0-9]:[0-5][0-9]' and cast(substr("__new_schedules"."start_time", 1, 2) as integer) between 0 and 23),
	CONSTRAINT "schedules_end_time_check" CHECK("__new_schedules"."end_time" glob '[0-2][0-9]:[0-5][0-9]' and cast(substr("__new_schedules"."end_time", 1, 2) as integer) between 0 and 23),
	CONSTRAINT "schedules_window_check" CHECK("__new_schedules"."start_time" < "__new_schedules"."end_time"),
	CONSTRAINT "schedules_timezone_not_empty_check" CHECK(length(trim("__new_schedules"."timezone")) > 0),
	CONSTRAINT "schedules_max_attempts_check" CHECK("__new_schedules"."max_attempts" between 1 and 5),
	CONSTRAINT "schedules_retry_interval_seconds_check" CHECK("__new_schedules"."retry_interval_seconds" between 1 and 86400)
);
--> statement-breakpoint
INSERT INTO `__new_schedules`("id", "account_id", "start_time", "end_time", "timezone", "max_attempts", "retry_interval_seconds", "enabled", "created_at", "updated_at") SELECT "id", "account_id", "start_time", "end_time", "timezone", 3, 60, "enabled", "created_at", "updated_at" FROM `schedules`;--> statement-breakpoint
DROP TABLE `schedules`;--> statement-breakpoint
ALTER TABLE `__new_schedules` RENAME TO `schedules`;--> statement-breakpoint
CREATE UNIQUE INDEX `schedules_account_id_unique` ON `schedules` (`account_id`);--> statement-breakpoint
CREATE INDEX `schedules_enabled_idx` ON `schedules` (`enabled`);
