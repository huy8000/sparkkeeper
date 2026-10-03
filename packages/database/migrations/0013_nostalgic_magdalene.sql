CREATE TABLE `legacy_profile_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`source_device` text NOT NULL,
	`source_inode` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "legacy_profile_bindings_state" CHECK(("legacy_profile_bindings"."status" = 'PREPARED' and "legacy_profile_bindings"."completed_at" is null) or ("legacy_profile_bindings"."status" = 'COMPLETED' and "legacy_profile_bindings"."completed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_profile_bindings_account_id_unique` ON `legacy_profile_bindings` (`account_id`);--> statement-breakpoint
CREATE TABLE `v4_system_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`account_id` text NOT NULL,
	`record_id` text,
	`event_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `execution_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`record_id`) REFERENCES `target_send_records`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "v4_system_events_type" CHECK("v4_system_events"."event_type" in ('RUN_STARTED','RUN_FINISHED','DELIVERY_UNKNOWN','TASK_FAILED','AUTH_EXPIRED'))
);
--> statement-breakpoint
CREATE INDEX `v4_system_events_run_sequence` ON `v4_system_events` (`run_id`,`sequence`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_admin_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`outcome` text NOT NULL,
	`reason_code` text,
	`correlation_digest` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_admin_user_id`) REFERENCES `admin_users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "audit_events_outcome_check" CHECK("__new_audit_events"."outcome" in ('SUCCESS', 'REJECTED', 'FAILED')),
	CONSTRAINT "audit_events_action_check" CHECK("__new_audit_events"."action" in ('ADMIN_INITIALIZED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_REVOKED', 'PASSWORD_CHANGED', 'ACCOUNT_LOGIN_STARTED', 'ACCOUNT_LOGIN_CANCELLED', 'ACCOUNT_CREATED', 'ACCOUNT_RELOGIN_COMPLETED', 'ACCOUNT_UNBOUND', 'CONTACT_SYNC_STARTED', 'CONTACT_SYNC_FINISHED', 'PREFERRED_IDENTITY_CHANGED', 'LEGACY_FRIEND_BOUND', 'LEGACY_FRIEND_DISMISSED', 'TEMPLATE_CREATED', 'TEMPLATE_UPDATED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_ENABLED', 'TASK_DISABLED', 'TASK_ARCHIVED', 'TEST_SEND_CONFIRMED', 'DELIVERY_RESOLVED', 'NOTIFICATION_CONFIG_UPDATED', 'NOTIFICATION_TEST_CONFIRMED', 'SESSION_CLEANUP', 'PROFILE_QUARANTINED', 'LEGACY_PROFILE_BINDING_STARTED', 'LEGACY_PROFILE_BOUND', 'LEGACY_SCHEDULE_IMPORTED', 'LEGACY_SCHEDULE_DISMISSED')),
	CONSTRAINT "audit_events_entity_type_check" CHECK("__new_audit_events"."entity_type" in ('ADMIN_USER', 'ADMIN_SESSION', 'ACCOUNT_LOGIN_SESSION', 'DOUYIN_ACCOUNT', 'CONTACT_SYNC_RUN', 'CONTACT', 'CONTACT_IDENTITY', 'TEMPLATE', 'SEND_TASK', 'EXECUTION_RUN', 'TARGET_SEND_RECORD', 'DELIVERY_RESOLUTION', 'NOTIFICATION_CONFIG', 'LEGACY_FRIEND_BINDING', 'LEGACY_SCHEDULE_IMPORT', 'SYSTEM')),
	CONSTRAINT "audit_events_entity_id_check" CHECK("__new_audit_events"."entity_id" is null or length(trim("__new_audit_events"."entity_id")) > 0),
	CONSTRAINT "audit_events_reason_code_check" CHECK("__new_audit_events"."reason_code" is null or length(trim("__new_audit_events"."reason_code")) > 0),
	CONSTRAINT "audit_events_correlation_digest_check" CHECK("__new_audit_events"."correlation_digest" is null or length(trim("__new_audit_events"."correlation_digest")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_audit_events`("id", "actor_admin_user_id", "action", "entity_type", "entity_id", "outcome", "reason_code", "correlation_digest", "created_at") SELECT "id", "actor_admin_user_id", "action", "entity_type", "entity_id", "outcome", "reason_code", "correlation_digest", "created_at" FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_events_created_at_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_created_idx` ON `audit_events` (`actor_admin_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_created_idx` ON `audit_events` (`entity_type`,`entity_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER audit_history_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER audit_history_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER resolution_history_update BEFORE UPDATE ON delivery_resolutions BEGIN SELECT RAISE(ABORT, 'RESOLUTION_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER resolution_history_delete BEFORE DELETE ON delivery_resolutions BEGIN SELECT RAISE(ABORT, 'RESOLUTION_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER resolution_chain_guard BEFORE INSERT ON delivery_resolutions
WHEN
 (NEW.target_send_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM target_send_records WHERE id=NEW.target_send_record_id AND machine_status='DELIVERY_UNKNOWN')) OR
 (NEW.legacy_send_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM send_records WHERE id=NEW.legacy_send_record_id AND status='DELIVERY_UNKNOWN')) OR
 (NEW.supersedes_resolution_id IS NULL AND EXISTS(SELECT 1 FROM delivery_resolutions WHERE target_send_record_id IS NEW.target_send_record_id AND legacy_send_record_id IS NEW.legacy_send_record_id)) OR
 (NEW.supersedes_resolution_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM delivery_resolutions r WHERE r.id=NEW.supersedes_resolution_id AND r.target_send_record_id IS NEW.target_send_record_id AND r.legacy_send_record_id IS NEW.legacy_send_record_id AND NOT EXISTS(SELECT 1 FROM delivery_resolutions n WHERE n.supersedes_resolution_id=r.id)))
BEGIN SELECT RAISE(ABORT, 'RESOLUTION_CHAIN_CONFLICT'); END;
--> statement-breakpoint
CREATE TRIGGER v4_event_update BEFORE UPDATE ON v4_system_events BEGIN SELECT RAISE(ABORT, 'EVENT_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER v4_event_delete BEFORE DELETE ON v4_system_events BEGIN SELECT RAISE(ABORT, 'EVENT_APPEND_ONLY'); END;
--> statement-breakpoint
CREATE TRIGGER v4_run_started AFTER UPDATE OF status ON execution_runs WHEN NEW.status='RUNNING' AND OLD.status='PENDING'
BEGIN INSERT INTO v4_system_events(run_id,account_id,event_type,created_at) VALUES(NEW.id,NEW.account_id,'RUN_STARTED',NEW.updated_at); END;
--> statement-breakpoint
CREATE TRIGGER v4_run_finished AFTER UPDATE OF status ON execution_runs WHEN OLD.status IN ('PENDING','RUNNING') AND NEW.status NOT IN ('PENDING','RUNNING')
BEGIN
  INSERT INTO v4_system_events(run_id,account_id,event_type,created_at) VALUES(NEW.id,NEW.account_id,'RUN_FINISHED',NEW.updated_at);
  INSERT INTO v4_system_events(run_id,account_id,event_type,created_at) SELECT NEW.id,NEW.account_id,CASE WHEN NEW.status='AUTH_EXPIRED' THEN 'AUTH_EXPIRED' ELSE 'TASK_FAILED' END,NEW.updated_at WHERE NEW.status IN ('AUTH_EXPIRED','FAILED','PARTIAL_FAILED');
END;
--> statement-breakpoint
CREATE TRIGGER v4_delivery_unknown AFTER UPDATE OF machine_status ON target_send_records WHEN NEW.machine_status='DELIVERY_UNKNOWN' AND OLD.machine_status!='DELIVERY_UNKNOWN'
BEGIN INSERT INTO v4_system_events(run_id,account_id,record_id,event_type,created_at) SELECT NEW.run_id,r.account_id,NEW.id,'DELIVERY_UNKNOWN',NEW.updated_at FROM execution_runs r WHERE r.id=NEW.run_id; END;
--> statement-breakpoint
CREATE TRIGGER migration_login_guard BEFORE INSERT ON account_login_sessions WHEN EXISTS(SELECT 1 FROM legacy_profile_bindings WHERE status='PREPARED') BEGIN SELECT RAISE(ABORT, 'MIGRATION_RECOVERY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER migration_discovery_guard BEFORE INSERT ON contact_sync_runs WHEN EXISTS(SELECT 1 FROM legacy_profile_bindings WHERE status='PREPARED') BEGIN SELECT RAISE(ABORT, 'MIGRATION_RECOVERY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER migration_execution_guard BEFORE INSERT ON execution_runs WHEN EXISTS(SELECT 1 FROM legacy_profile_bindings WHERE status='PREPARED') BEGIN SELECT RAISE(ABORT, 'MIGRATION_RECOVERY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER migration_legacy_guard BEFORE UPDATE OF status ON daily_runs WHEN NEW.status='RUNNING' AND EXISTS(SELECT 1 FROM legacy_profile_bindings WHERE status='PREPARED') BEGIN SELECT RAISE(ABORT, 'MIGRATION_RECOVERY_REQUIRED'); END;
