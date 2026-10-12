CREATE TABLE `application_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`question` text NOT NULL,
	`word_limit` integer,
	`char_limit` integer,
	`text` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`gaps` text DEFAULT '[]' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_answers_app_q_uq` ON `application_answers` (`application_id`,`question`);