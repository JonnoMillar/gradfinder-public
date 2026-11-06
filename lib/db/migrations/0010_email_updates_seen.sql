ALTER TABLE `email_updates` ADD `status_from` text;--> statement-breakpoint
ALTER TABLE `email_updates` ADD `seen_at` text;--> statement-breakpoint
-- the from-status of past moves, from the activity_log row the same Gmail record wrote
UPDATE `email_updates` SET `status_from` = (
  SELECT l.from_status FROM activity_log l
  WHERE l.application_id = email_updates.application_id AND l.to_status = email_updates.status_applied AND l.note LIKE 'Gmail:%'
  ORDER BY abs(julianday(l.at) - julianday(email_updates.created_at)) LIMIT 1
) WHERE `status_applied` IS NOT NULL;--> statement-breakpoint
-- old news is not news: only the last week's moves are left to play
UPDATE `email_updates` SET `seen_at` = `created_at` WHERE `received_at` < date('now', '-7 days');
