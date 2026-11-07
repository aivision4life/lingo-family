ALTER TABLE `topik_tests` ADD `length_ms` integer;--> statement-breakpoint
ALTER TABLE `topik_tests` ADD `ends_at` integer;--> statement-breakpoint
ALTER TABLE `topik_tests` ADD `paused_at` integer;--> statement-breakpoint
ALTER TABLE `topik_tests` ADD `auto_submitted` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Sittings started before the clock existed have no deadline to measure, so there is nothing to
-- resume and nothing to grade honestly: five of them had been stuck at `running` for days on
-- production, which also means they were still answerable. They end here.
UPDATE `topik_tests` SET `status` = 'abandoned' WHERE `status` = 'running' AND `ends_at` IS NULL;
