CREATE TABLE `ai_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`response_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`word_id` text NOT NULL,
	`card_type` text NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`state` integer NOT NULL,
	`last_review` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_profile_word_type_uq` ON `cards` (`profile_id`,`word_id`,`card_type`);--> statement-breakpoint
CREATE INDEX `cards_profile_due_idx` ON `cards` (`profile_id`,`due`);--> statement-breakpoint
CREATE TABLE `deck_words` (
	`deck_id` text NOT NULL,
	`word_id` text NOT NULL,
	PRIMARY KEY(`deck_id`, `word_id`),
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_words_word_idx` ON `deck_words` (`word_id`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lang` text NOT NULL,
	`is_kid_deck` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `examples` (
	`id` text PRIMARY KEY NOT NULL,
	`word_id` text NOT NULL,
	`sentence` text NOT NULL,
	`translation_vi` text NOT NULL,
	`translation_en` text NOT NULL,
	`translation_ko` text NOT NULL,
	`audio_key` text,
	`level` text NOT NULL,
	`ai_generated` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `examples_word_idx` ON `examples` (`word_id`);--> statement-breakpoint
CREATE TABLE `han_chars` (
	`char_simplified` text PRIMARY KEY NOT NULL,
	`char_traditional` text NOT NULL,
	`han_viet` text NOT NULL,
	`meaning_vi` text NOT NULL,
	`ai_generated` integer DEFAULT false NOT NULL,
	`verified` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_decks` (
	`profile_id` text NOT NULL,
	`deck_id` text NOT NULL,
	PRIMARY KEY(`profile_id`, `deck_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`avatar` text NOT NULL,
	`ui_lang` text DEFAULT 'vi' NOT NULL,
	`gloss_lang` text DEFAULT 'vi' NOT NULL,
	`is_kid` integer DEFAULT false NOT NULL,
	`pin_hash` text,
	`daily_new_limit` integer DEFAULT 10 NOT NULL,
	`study_langs` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pron_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`word_id` text,
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
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`example_id`) REFERENCES `examples`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pron_attempts_profile_time_idx` ON `pron_attempts` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pron_attempts_word_idx` ON `pron_attempts` (`word_id`);--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`rating` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	`duration_ms` integer,
	`state` integer NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`last_elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_logs_card_idx` ON `review_logs` (`card_id`);--> statement-breakpoint
CREATE INDEX `review_logs_profile_time_idx` ON `review_logs` (`profile_id`,`reviewed_at`);--> statement-breakpoint
CREATE TABLE `usage_daily` (
	`date` text NOT NULL,
	`profile_id` text NOT NULL,
	`service` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`date`, `profile_id`, `service`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `word_chars` (
	`word_id` text NOT NULL,
	`position` integer NOT NULL,
	`char_simplified` text NOT NULL,
	PRIMARY KEY(`word_id`, `position`),
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`char_simplified`) REFERENCES `han_chars`(`char_simplified`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `word_chars_char_idx` ON `word_chars` (`char_simplified`);--> statement-breakpoint
CREATE TABLE `words` (
	`id` text PRIMARY KEY NOT NULL,
	`lang` text NOT NULL,
	`term` text NOT NULL,
	`reading` text NOT NULL,
	`pos` text NOT NULL,
	`gloss_vi` text NOT NULL,
	`gloss_en` text NOT NULL,
	`gloss_ko` text NOT NULL,
	`hanzi_simplified` text,
	`hanzi_traditional` text,
	`han_viet` text,
	`emoji` text,
	`image_key` text,
	`audio_key` text,
	`notes` text,
	`ai_generated` integer DEFAULT false NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_by_profile` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_profile`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `words_lang_term_uq` ON `words` (`lang`,`term`);