CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`job_id` integer NOT NULL,
	`application_id` integer,
	`state` text DEFAULT 'queued' NOT NULL,
	`form_url` text,
	`note` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`heartbeat_at` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_runs_state_idx` ON `agent_runs` (`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_one_active` ON `agent_runs` (`job_id`,`kind`) WHERE state in ('queued','running','needs_you','ready');--> statement-breakpoint
CREATE TABLE `run_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`options` text,
	`standing` integer DEFAULT false NOT NULL,
	`fact_key` text,
	`answer` text,
	`answered_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_questions_run_idx` ON `run_questions` (`run_id`);--> statement-breakpoint
ALTER TABLE `applications` ADD `form_url` text;--> statement-breakpoint
ALTER TABLE `applications` ADD `employer_title` text;