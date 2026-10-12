CREATE TABLE `email_updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gmail_message_id` text NOT NULL,
	`thread_id` text,
	`view_url` text,
	`received_at` text NOT NULL,
	`sender` text NOT NULL,
	`subject` text NOT NULL,
	`kind` text NOT NULL,
	`summary` text,
	`company_hint` text,
	`role_hint` text,
	`application_id` integer,
	`status_applied` text,
	`action_text` text,
	`action_due` text,
	`action_done` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_updates_gmail_message_id_unique` ON `email_updates` (`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `email_updates_app_idx` ON `email_updates` (`application_id`);