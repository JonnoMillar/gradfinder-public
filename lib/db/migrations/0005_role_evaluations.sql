CREATE TABLE `role_evaluations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`grad_role` text NOT NULL,
	`grad_role_reason` text NOT NULL,
	`family` text NOT NULL,
	`one_line` text NOT NULL,
	`day_to_day` text NOT NULL,
	`scores` text NOT NULL,
	`reasons` text NOT NULL,
	`stretch` text,
	`dealbreakers` text DEFAULT '[]' NOT NULL,
	`salary_from_posting` text,
	`confidence` text NOT NULL,
	`content_hash` text,
	`model` text NOT NULL,
	`rubric_version` integer NOT NULL,
	`evaluated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_evaluations_job_id_unique` ON `role_evaluations` (`job_id`);