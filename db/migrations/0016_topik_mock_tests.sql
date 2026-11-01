CREATE TABLE `topik_test_items` (
	`id` text PRIMARY KEY NOT NULL,
	`test_id` text NOT NULL,
	`position` integer NOT NULL,
	`question_id` text,
	`number` integer NOT NULL,
	`points` integer NOT NULL,
	`segment_id` text,
	`selected_option` integer,
	`is_correct` integer,
	`answered_at` integer,
	FOREIGN KEY (`test_id`) REFERENCES `topik_tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `topik_questions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`segment_id`) REFERENCES `topik_segments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topik_test_items_test_position_uq` ON `topik_test_items` (`test_id`,`position`);--> statement-breakpoint
CREATE TABLE `topik_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`section` text NOT NULL,
	`kind` text NOT NULL,
	`source_exam` text,
	`question_count` integer NOT NULL,
	`total_points` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`duration_ms` integer,
	`pause_count` integer DEFAULT 0 NOT NULL,
	`paused_ms` integer DEFAULT 0 NOT NULL,
	`correct_count` integer,
	`score_points` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topik_tests_profile_idx` ON `topik_tests` (`profile_id`,`section`,`started_at`);--> statement-breakpoint
ALTER TABLE `topik_questions` ADD `points` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
-- Backfill from the instruction's own "각 N점" (M6.4). SQLite has no regex, but the only forms a
-- real paper uses are "각 2점" and "각 3점", and anything else keeps the default of 2 — a question
-- worth 0 by accident would simply vanish from a result. `scripts/checkPoints` reports every
-- listening question that did not land on 2, since TOPIK II listening is 50 x 2 = 100.
UPDATE `topik_questions` SET `points` = 3 WHERE `instruction` LIKE '%각 3점%';--> statement-breakpoint
UPDATE `topik_questions` SET `points` = 4 WHERE `instruction` LIKE '%각 4점%';
