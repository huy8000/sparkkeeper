CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`login_status` text DEFAULT 'UNKNOWN' NOT NULL,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "accounts_login_status_check" CHECK("accounts"."login_status" in ('READY', 'AUTH_EXPIRED', 'UNKNOWN')),
	CONSTRAINT "accounts_name_not_empty_check" CHECK(length(trim("accounts"."name")) > 0)
);
