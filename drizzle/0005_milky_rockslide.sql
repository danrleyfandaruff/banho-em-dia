CREATE TABLE `payment_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`credit_bps` integer NOT NULL,
	`debit_bps` integer NOT NULL
);
