CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`chatgpt_user_id` text,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_users_email` ON `app_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_users_chatgpt_user_id` ON `app_users` (`chatgpt_user_id`);--> statement-breakpoint
CREATE INDEX `idx_app_users_active` ON `app_users` (`active`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text DEFAULT '' NOT NULL,
	`actor_email` text DEFAULT '' NOT NULL,
	`actor_name` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`description` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_created_at` ON `audit_logs` (`created_at`);