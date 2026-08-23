CREATE TABLE `system_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`level` text NOT NULL,
	`run_id` text,
	`account_id` text,
	`friend_id` text,
	`attempt` integer,
	`error_code` text,
	`message` text NOT NULL,
	`screenshot_path` text,
	`trace_path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `daily_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`friend_id`) REFERENCES `friends`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "system_events_level_check" CHECK("system_events"."level" in ('INFO', 'WARN', 'ERROR')),
	CONSTRAINT "system_events_event_type_check" CHECK("system_events"."event_type" in ('RUN_STARTED', 'RUN_FINISHED', 'AUTH_CHECKING', 'AUTH_EXPIRED', 'AUTH_UNKNOWN', 'FRIEND_RESOLVING', 'CONTACT_NOT_FOUND', 'AMBIGUOUS_CONTACT', 'MESSAGE_BUILDING', 'MESSAGE_SENDING', 'VERIFYING', 'VERIFY_SUCCESS', 'RETRY_WAIT', 'TASK_FAILED', 'SELECTOR_FAILURE', 'BROWSER_ERROR', 'DELIVERY_UNKNOWN', 'CONVERSATION_VERIFICATION_FAILED', 'SKIPPED_IDEMPOTENT', 'CONSECUTIVE_RUN_FAILURE', 'OBSERVABILITY_ERROR')),
	CONSTRAINT "system_events_attempt_check" CHECK("system_events"."attempt" is null or "system_events"."attempt" > 0),
	CONSTRAINT "system_events_message_not_empty_check" CHECK(length(trim("system_events"."message")) > 0)
);
--> statement-breakpoint
CREATE INDEX `system_events_created_at_idx` ON `system_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `system_events_run_id_idx` ON `system_events` (`run_id`);--> statement-breakpoint
CREATE INDEX `system_events_account_id_idx` ON `system_events` (`account_id`);