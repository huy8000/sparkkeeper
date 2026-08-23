CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`timezone` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "schedules_start_time_check" CHECK("schedules"."start_time" glob '[0-2][0-9]:[0-5][0-9]' and cast(substr("schedules"."start_time", 1, 2) as integer) between 0 and 23),
	CONSTRAINT "schedules_end_time_check" CHECK("schedules"."end_time" glob '[0-2][0-9]:[0-5][0-9]' and cast(substr("schedules"."end_time", 1, 2) as integer) between 0 and 23),
	CONSTRAINT "schedules_window_check" CHECK("schedules"."start_time" < "schedules"."end_time"),
	CONSTRAINT "schedules_timezone_not_empty_check" CHECK(length(trim("schedules"."timezone")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schedules_account_id_unique` ON `schedules` (`account_id`);--> statement-breakpoint
CREATE INDEX `schedules_enabled_idx` ON `schedules` (`enabled`);