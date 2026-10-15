CREATE TABLE `topik_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`question_id` text,
	`section` text NOT NULL,
	`exam` text NOT NULL,
	`number` integer NOT NULL,
	`selected_option` integer NOT NULL,
	`is_correct` integer NOT NULL,
	`duration_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `topik_questions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `topik_attempts_profile_time_idx` ON `topik_attempts` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `topik_attempts_question_idx` ON `topik_attempts` (`question_id`);--> statement-breakpoint
CREATE TABLE `topik_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`question_id` text NOT NULL,
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
	FOREIGN KEY (`question_id`) REFERENCES `topik_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topik_cards_profile_question_uq` ON `topik_cards` (`profile_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `topik_cards_profile_due_idx` ON `topik_cards` (`profile_id`,`due`);--> statement-breakpoint
CREATE TABLE `topik_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`section` text NOT NULL,
	`exam` text NOT NULL,
	`number` integer NOT NULL,
	`block` text NOT NULL,
	`instruction` text,
	`stem_text` text,
	`stem_image_key` text,
	`options` text NOT NULL,
	`correct_option` integer NOT NULL,
	`warning` text,
	`verified` integer DEFAULT false NOT NULL,
	`created_by_profile` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by_profile`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topik_questions_section_exam_number_uq` ON `topik_questions` (`section`,`exam`,`number`);--> statement-breakpoint
CREATE INDEX `topik_questions_section_number_idx` ON `topik_questions` (`section`,`number`);