CREATE TABLE `notification_configs` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`provider` text DEFAULT 'WEBHOOK' NOT NULL,
	`webhook_url` text,
	`notify_auth_expired` integer DEFAULT true NOT NULL,
	`notify_task_failed` integer DEFAULT true NOT NULL,
	`notify_consecutive_failure` integer DEFAULT true NOT NULL,
	`notify_delivery_unknown` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "notification_configs_singleton_check" CHECK("notification_configs"."id" = 1),
	CONSTRAINT "notification_configs_provider_check" CHECK("notification_configs"."provider" = 'WEBHOOK'),
	CONSTRAINT "notification_configs_webhook_url_check" CHECK("notification_configs"."webhook_url" is null or length(trim("notification_configs"."webhook_url")) > 0)
);
