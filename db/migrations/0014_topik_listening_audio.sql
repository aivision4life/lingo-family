CREATE TABLE `topik_audio` (
	`id` text PRIMARY KEY NOT NULL,
	`section` text NOT NULL,
	`exam` text NOT NULL,
	`audio_key` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topik_audio_section_exam_uq` ON `topik_audio` (`section`,`exam`);--> statement-breakpoint
CREATE TABLE `topik_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`audio_id` text NOT NULL,
	`idx` integer NOT NULL,
	`start_ms` integer NOT NULL,
	`speech_end_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`audio_id`) REFERENCES `topik_audio`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topik_segments_audio_idx_uq` ON `topik_segments` (`audio_id`,`idx`);--> statement-breakpoint
ALTER TABLE `topik_questions` ADD `segment_id` text REFERENCES topik_segments(id) ON DELETE set null;