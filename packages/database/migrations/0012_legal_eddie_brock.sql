CREATE TABLE `scheduled_run_snapshots` (
	`run_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`business_date` text NOT NULL,
	`snapshot` text NOT NULL,
	`active_slot` integer,
	`owner_token` text,
	FOREIGN KEY (`run_id`) REFERENCES `execution_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `send_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduled_snapshots_active_check" CHECK("scheduled_run_snapshots"."active_slot" is null or "scheduled_run_snapshots"."active_slot"=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_snapshots_task_date_idx` ON `scheduled_run_snapshots` (`task_id`,`business_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_snapshots_active_idx` ON `scheduled_run_snapshots` (`active_slot`);
--> statement-breakpoint
CREATE TRIGGER scheduled_snapshot_immutable BEFORE UPDATE ON scheduled_run_snapshots
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.task_id IS NOT OLD.task_id OR NEW.business_date IS NOT OLD.business_date OR NEW.snapshot IS NOT OLD.snapshot
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCHEDULED_SNAPSHOT'); END;
--> statement-breakpoint
CREATE TRIGGER scheduled_record_guard BEFORE UPDATE ON target_send_records
WHEN EXISTS (SELECT 1 FROM scheduled_run_snapshots WHERE run_id=OLD.run_id)
AND (NEW.run_id IS NOT OLD.run_id OR NEW.task_id IS NOT OLD.task_id OR NEW.contact_id IS NOT OLD.contact_id
 OR NEW.business_date IS NOT OLD.business_date OR NEW.template_id IS NOT OLD.template_id OR NEW.message_text IS NOT OLD.message_text
 OR NEW.target_identity_kind_snapshot IS NOT OLD.target_identity_kind_snapshot OR NEW.target_identity_value_digest IS NOT OLD.target_identity_value_digest
 OR NEW.attempt_count < OLD.attempt_count OR (OLD.send_action_started_at IS NOT NULL AND NEW.send_action_started_at IS NOT OLD.send_action_started_at)
 OR (NEW.send_action_started_at IS NOT OLD.send_action_started_at AND OLD.machine_status != 'RUNNING')
 OR (NEW.send_action_started_at IS NOT NULL AND NEW.machine_status IN ('READY','RETRY_WAIT','FAILED','SKIPPED'))
 OR (OLD.machine_status != 'READY' AND NEW.machine_status = 'READY')
 OR (NEW.machine_status = 'RUNNING' AND EXISTS (SELECT 1 FROM target_send_records other WHERE other.run_id=OLD.run_id AND other.id!=OLD.id AND other.machine_status='RUNNING'))
 OR OLD.machine_status IN ('SUCCESS','FAILED','DELIVERY_UNKNOWN','SKIPPED'))
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCHEDULED_RECORD'); END;
--> statement-breakpoint
CREATE TRIGGER scheduled_run_guard BEFORE UPDATE ON execution_runs
WHEN EXISTS (SELECT 1 FROM scheduled_run_snapshots WHERE run_id=OLD.id)
AND (NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.account_id IS NOT OLD.account_id OR NEW.task_id IS NOT OLD.task_id
 OR NEW.template_id IS NOT OLD.template_id OR NEW.business_date IS NOT OLD.business_date OR NEW.idempotency_key IS NOT OLD.idempotency_key
 OR NEW.requested_by_admin_user_id IS NOT OLD.requested_by_admin_user_id OR NEW.confirmed_at IS NOT OLD.confirmed_at
 OR OLD.status NOT IN ('PENDING','RUNNING') OR (OLD.status != 'PENDING' AND NEW.status='PENDING'))
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_SCHEDULED_RUN'); END;
