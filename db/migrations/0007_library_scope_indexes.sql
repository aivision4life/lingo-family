CREATE INDEX `cards_profile_word_idx` ON `cards` (`profile_id`,`word_id`);--> statement-breakpoint
CREATE INDEX `words_created_by_idx` ON `words` (`created_by_profile`);