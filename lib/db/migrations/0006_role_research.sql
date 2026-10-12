CREATE TABLE `role_research` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`unknowns` text DEFAULT '[]' NOT NULL,
	`fit` text DEFAULT '[]' NOT NULL,
	`angle` text NOT NULL,
	`model` text NOT NULL,
	`researched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_research_job_id_unique` ON `role_research` (`job_id`);