CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`customer_pet_name` text DEFAULT '' NOT NULL,
	`plan_type` text NOT NULL,
	`amount_cents` integer,
	`paid` integer DEFAULT false NOT NULL,
	`scheduled_date` text NOT NULL,
	`scheduled_time` text DEFAULT '09:00' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`services` text DEFAULT '[]' NOT NULL,
	`session_number` integer DEFAULT 1 NOT NULL,
	`total_sessions` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_appointments_scheduled_date` ON `appointments` (`scheduled_date`);--> statement-breakpoint
CREATE INDEX `idx_appointments_group_id` ON `appointments` (`group_id`);--> statement-breakpoint
CREATE INDEX `idx_appointments_status_date` ON `appointments` (`status`,`scheduled_date`);