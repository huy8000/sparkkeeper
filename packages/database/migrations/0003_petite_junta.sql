CREATE TABLE `daily_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`business_date` text NOT NULL,
	`status` text DEFAULT 'READY' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "daily_runs_business_date_check" CHECK(strftime('%Y-%m-%d', "daily_runs"."business_date") = "daily_runs"."business_date"),
	CONSTRAINT "daily_runs_status_check" CHECK("daily_runs"."status" in ('READY', 'RUNNING', 'SUCCESS', 'FAILED', 'AUTH_EXPIRED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_runs_account_business_date_unique` ON `daily_runs` (`account_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `send_records` (
	`id` text PRIMARY KEY NOT NULL,
	`daily_run_id` text NOT NULL,
	`friend_id` text NOT NULL,
	`business_date` text NOT NULL,
	`message_template_id` text,
	`message_text` text NOT NULL,
	`status` text DEFAULT 'READY' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`daily_run_id`) REFERENCES `daily_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`friend_id`) REFERENCES `friends`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`message_template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "send_records_business_date_check" CHECK(strftime('%Y-%m-%d', "send_records"."business_date") = "send_records"."business_date"),
	CONSTRAINT "send_records_message_text_not_empty_check" CHECK(length(trim("send_records"."message_text")) > 0),
	CONSTRAINT "send_records_status_check" CHECK("send_records"."status" in ('READY', 'RUNNING', 'SUCCESS', 'FAILED', 'DELIVERY_UNKNOWN'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `send_records_friend_business_date_unique` ON `send_records` (`friend_id`,`business_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `send_records_daily_run_friend_unique` ON `send_records` (`daily_run_id`,`friend_id`);