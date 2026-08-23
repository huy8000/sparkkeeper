CREATE TABLE `friends` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`display_name` text NOT NULL,
	`remark_name` text,
	`short_id` text,
	`unique_id` text,
	`sec_uid` text,
	`match_field` text NOT NULL,
	`match_key` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "friends_display_name_not_empty_check" CHECK(length(trim("friends"."display_name")) > 0),
	CONSTRAINT "friends_match_key_not_empty_check" CHECK(length("friends"."match_key") > 0),
	CONSTRAINT "friends_match_field_check" CHECK("friends"."match_field" in ('displayName', 'remarkName', 'shortId', 'uniqueId', 'secUid')),
	CONSTRAINT "friends_match_consistency_check" CHECK(case "friends"."match_field"
        when 'displayName' then "friends"."match_key" = trim("friends"."display_name")
        when 'remarkName' then "friends"."remark_name" is not null and "friends"."match_key" = trim("friends"."remark_name")
        when 'shortId' then "friends"."short_id" is not null and "friends"."match_key" = trim("friends"."short_id")
        when 'uniqueId' then "friends"."unique_id" is not null and "friends"."match_key" = trim("friends"."unique_id")
        when 'secUid' then "friends"."sec_uid" is not null and "friends"."match_key" = trim("friends"."sec_uid")
        else 0
      end)
);
--> statement-breakpoint
CREATE INDEX `friends_account_id_idx` ON `friends` (`account_id`);