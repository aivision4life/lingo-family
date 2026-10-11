-- Rebuild of pron_attempts so that its links to words / phrases / examples become ON DELETE SET NULL
-- (deleting content keeps the practice history, readable through reference_text). Nothing references
-- pron_attempts, and existing rows are copied. On D1 PRAGMA foreign_keys has no effect (see 0002).
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_pron_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`word_id` text,
	`phrase_id` text,
	`example_id` text,
	`lang` text NOT NULL,
	`reference_text` text NOT NULL,
	`pron_score` real NOT NULL,
	`accuracy` real NOT NULL,
	`fluency` real NOT NULL,
	`completeness` real NOT NULL,
	`details_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`phrase_id`) REFERENCES `phrases`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`example_id`) REFERENCES `examples`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_pron_attempts`("id", "profile_id", "word_id", "phrase_id", "example_id", "lang", "reference_text", "pron_score", "accuracy", "fluency", "completeness", "details_json", "created_at") SELECT "id", "profile_id", "word_id", "phrase_id", "example_id", "lang", "reference_text", "pron_score", "accuracy", "fluency", "completeness", "details_json", "created_at" FROM `pron_attempts`;--> statement-breakpoint
DROP TABLE `pron_attempts`;--> statement-breakpoint
ALTER TABLE `__new_pron_attempts` RENAME TO `pron_attempts`;--> statement-breakpoint
CREATE INDEX `pron_attempts_profile_time_idx` ON `pron_attempts` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pron_attempts_word_idx` ON `pron_attempts` (`word_id`);