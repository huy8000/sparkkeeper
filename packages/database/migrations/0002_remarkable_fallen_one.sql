CREATE TABLE `message_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider_type` text NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "message_templates_name_not_empty_check" CHECK(length(trim("message_templates"."name")) > 0),
	CONSTRAINT "message_templates_provider_type_check" CHECK("message_templates"."provider_type" in ('STATIC', 'RANDOM'))
);
