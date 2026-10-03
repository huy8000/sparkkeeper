CREATE TABLE `test_send_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`admin_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`template_id` text NOT NULL,
	`preview_key_digest` text NOT NULL,
	`fingerprint` text NOT NULL,
	`payload_digest` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_run_id` text,
	`active_slot` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`admin_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `message_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consumed_run_id`) REFERENCES `execution_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "test_send_intents_ttl_check" CHECK("test_send_intents"."expires_at" = "test_send_intents"."created_at" + 600000),
	CONSTRAINT "test_send_intents_digest_check" CHECK(length("test_send_intents"."fingerprint") = 64 and length("test_send_intents"."payload_digest") = 64 and length("test_send_intents"."preview_key_digest") = 64),
	CONSTRAINT "test_send_intents_active_check" CHECK("active_slot" IS NULL OR ("active_slot" = 1 AND "consumed_run_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_send_intents_preview_key_idx` ON `test_send_intents` (`preview_key_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `test_send_intents_consumed_run_idx` ON `test_send_intents` (`consumed_run_id`);--> statement-breakpoint
CREATE INDEX `test_send_intents_admin_expiry_idx` ON `test_send_intents` (`admin_id`,`expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `test_send_intents_active_idx` ON `test_send_intents` (`active_slot`);
--> statement-breakpoint
CREATE TRIGGER test_send_intent_immutable BEFORE UPDATE ON test_send_intents
WHEN NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.admin_id IS NOT OLD.admin_id
 OR NEW.contact_id IS NOT OLD.contact_id OR NEW.template_id IS NOT OLD.template_id
 OR NEW.preview_key_digest IS NOT OLD.preview_key_digest OR NEW.fingerprint IS NOT OLD.fingerprint
 OR NEW.payload_digest IS NOT OLD.payload_digest OR NEW.summary IS NOT OLD.summary
 OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR (OLD.consumed_run_id IS NOT NULL AND NEW.consumed_run_id IS NOT OLD.consumed_run_id)
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_TEST_SEND_INTENT'); END;
--> statement-breakpoint
CREATE TRIGGER test_send_record_guard BEFORE UPDATE ON target_send_records
WHEN EXISTS (SELECT 1 FROM test_send_intents WHERE consumed_run_id = OLD.run_id)
 AND (NEW.message_text IS NOT OLD.message_text OR NEW.run_id IS NOT OLD.run_id
 OR NEW.contact_id IS NOT OLD.contact_id OR NEW.template_id IS NOT OLD.template_id
 OR NEW.target_identity_kind_snapshot IS NOT OLD.target_identity_kind_snapshot
 OR NEW.target_identity_value_digest IS NOT OLD.target_identity_value_digest
 OR NEW.task_id IS NOT OLD.task_id OR NEW.business_date IS NOT OLD.business_date
 OR NEW.attempt_count > 1 OR NEW.attempt_count < OLD.attempt_count
 OR NEW.machine_status = 'RETRY_WAIT'
 OR (OLD.send_action_started_at IS NOT NULL AND NEW.send_action_started_at IS NOT OLD.send_action_started_at)
 OR (NEW.send_action_started_at IS NOT OLD.send_action_started_at AND OLD.machine_status != 'RUNNING')
 OR (NEW.send_action_started_at IS NOT NULL AND NEW.machine_status IN ('FAILED','SKIPPED','READY'))
 OR (OLD.machine_status != 'READY' AND NEW.machine_status = 'READY')
 OR OLD.machine_status IN ('SUCCESS','FAILED','DELIVERY_UNKNOWN','SKIPPED'))
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_TEST_SEND_RECORD'); END;
--> statement-breakpoint
CREATE TRIGGER test_send_run_guard BEFORE UPDATE ON execution_runs
WHEN EXISTS (SELECT 1 FROM test_send_intents WHERE consumed_run_id = OLD.id)
 AND (NEW.kind IS NOT OLD.kind OR NEW.account_id IS NOT OLD.account_id
 OR NEW.template_id IS NOT OLD.template_id OR NEW.requested_by_admin_user_id IS NOT OLD.requested_by_admin_user_id
 OR NEW.confirmed_at IS NOT OLD.confirmed_at OR NEW.idempotency_key IS NOT OLD.idempotency_key
 OR NEW.task_id IS NOT OLD.task_id OR NEW.business_date IS NOT OLD.business_date
 OR OLD.status NOT IN ('PENDING','RUNNING') OR (OLD.status != 'PENDING' AND NEW.status = 'PENDING'))
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_TEST_SEND_RUN'); END;
