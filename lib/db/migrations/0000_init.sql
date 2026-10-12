CREATE TABLE `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`application_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_app_idx` ON `activity_log` (`application_id`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`status` text DEFAULT 'discovered' NOT NULL,
	`next_action` text,
	`next_action_due` text,
	`notes` text,
	`applied_at` text,
	`dismissed_reason` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_job_id_unique` ON `applications` (`job_id`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`domain` text,
	`website` text,
	`logo_url` text,
	`sector` text,
	`sub_sector` text,
	`summary` text,
	`size_band` text,
	`headcount` integer,
	`hq` text,
	`london_office` integer,
	`hybrid_policy` text,
	`ai_forward` integer,
	`ai_forward_rationale` text,
	`research_updated_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_unique` ON `companies` (`slug`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`field` text NOT NULL,
	`value_text` text NOT NULL,
	`value_json` text,
	`source_url` text NOT NULL,
	`source_kind` text NOT NULL,
	`confidence` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `facts_entity_field_idx` ON `facts` (`entity_type`,`entity_id`,`field`);--> statement-breakpoint
CREATE TABLE `job_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`snapshot_id` integer,
	`first_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_sources_source_sourceid_uq` ON `job_sources` (`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `job_sources_job_idx` ON `job_sources` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'unknown' NOT NULL,
	`function` text,
	`description_text` text,
	`description_html` text,
	`location_raw` text,
	`is_london` integer DEFAULT false NOT NULL,
	`work_mode` text DEFAULT 'unknown' NOT NULL,
	`salary_min` integer,
	`salary_max` integer,
	`salary_currency` text,
	`salary_text` text,
	`start_text` text,
	`deadline` text,
	`deadline_text` text,
	`apply_url` text,
	`canonical_url` text,
	`eligibility` text,
	`application_requirements` text,
	`process_stages` text,
	`excluded_reason` text,
	`rank_score` real DEFAULT 0 NOT NULL,
	`rank_breakdown` text,
	`dedupe_key` text NOT NULL,
	`content_hash` text,
	`extraction_meta` text,
	`first_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_key_unique` ON `jobs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_active_excluded_idx` ON `jobs` (`is_active`,`excluded_reason`);--> statement-breakpoint
CREATE INDEX `jobs_deadline_idx` ON `jobs` (`deadline`);--> statement-breakpoint
CREATE TABLE `news_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`published_at` text,
	`source_name` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_items_url_unique` ON `news_items` (`url`);--> statement-breakpoint
CREATE INDEX `news_company_idx` ON `news_items` (`company_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`http_status` integer NOT NULL,
	`content_hash` text NOT NULL,
	`body_path` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_url_idx` ON `snapshots` (`url`);--> statement-breakpoint
CREATE TABLE `sweep_run_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`discovered` integer DEFAULT 0 NOT NULL,
	`inserted` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`error` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `sweep_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sweep_run_sources_run_idx` ON `sweep_run_sources` (`run_id`);--> statement-breakpoint
CREATE TABLE `sweep_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text,
	`trigger` text DEFAULT 'cli' NOT NULL,
	`summary` text
);
