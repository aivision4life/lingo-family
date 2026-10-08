-- M1.6: remove Chinese (zh) from the product (SPEC §5, decided 2026-10-08).
-- Custom migration: drizzle-kit cannot generate a column rename non-interactively.
-- 1) Delete zh data in foreign-key order: review_logs → cards → examples → deck_words → decks/profile_decks → words.
DELETE FROM `review_logs` WHERE `card_id` IN (
  SELECT `c`.`id` FROM `cards` `c` JOIN `words` `w` ON `w`.`id` = `c`.`word_id` WHERE `w`.`lang` = 'zh'
);--> statement-breakpoint
DELETE FROM `cards` WHERE `word_id` IN (SELECT `id` FROM `words` WHERE `lang` = 'zh');--> statement-breakpoint
DELETE FROM `pron_attempts` WHERE `lang` = 'zh' OR `word_id` IN (SELECT `id` FROM `words` WHERE `lang` = 'zh');--> statement-breakpoint
DELETE FROM `examples` WHERE `word_id` IN (SELECT `id` FROM `words` WHERE `lang` = 'zh');--> statement-breakpoint
DELETE FROM `deck_words`
  WHERE `word_id` IN (SELECT `id` FROM `words` WHERE `lang` = 'zh')
     OR `deck_id` IN (SELECT `id` FROM `decks` WHERE `lang` = 'zh');--> statement-breakpoint
DELETE FROM `profile_decks` WHERE `deck_id` IN (SELECT `id` FROM `decks` WHERE `lang` = 'zh');--> statement-breakpoint
DELETE FROM `decks` WHERE `lang` = 'zh';--> statement-breakpoint
DELETE FROM `word_chars` WHERE `word_id` IN (SELECT `id` FROM `words` WHERE `lang` = 'zh');--> statement-breakpoint
DELETE FROM `words` WHERE `lang` = 'zh';--> statement-breakpoint
-- 2) Remove 'zh' from study_langs; a profile left without any language studies Korean.
UPDATE `profiles`
  SET `study_langs` = COALESCE(
    NULLIF((SELECT json_group_array(`value`) FROM json_each(`profiles`.`study_langs`) WHERE `value` <> 'zh'), '[]'),
    '["ko"]'
  )
  WHERE EXISTS (SELECT 1 FROM json_each(`profiles`.`study_langs`) WHERE `value` = 'zh');--> statement-breakpoint
-- 3) Hanja columns: keep the traditional form as `hanja`, drop the simplified Chinese form.
ALTER TABLE `words` RENAME COLUMN `hanzi_traditional` TO `hanja`;--> statement-breakpoint
ALTER TABLE `words` DROP COLUMN `hanzi_simplified`;--> statement-breakpoint
-- 4) han_chars is keyed by Hanja now (both tables were still unused, so they are recreated).
DROP TABLE `word_chars`;--> statement-breakpoint
DROP TABLE `han_chars`;--> statement-breakpoint
CREATE TABLE `han_chars` (
	`hanja` text PRIMARY KEY NOT NULL,
	`han_viet` text NOT NULL,
	`meaning_vi` text NOT NULL,
	`ai_generated` integer DEFAULT false NOT NULL,
	`verified` integer DEFAULT false NOT NULL
);--> statement-breakpoint
CREATE TABLE `word_chars` (
	`word_id` text NOT NULL,
	`position` integer NOT NULL,
	`hanja` text NOT NULL,
	PRIMARY KEY(`word_id`, `position`),
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hanja`) REFERENCES `han_chars`(`hanja`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `word_chars_hanja_idx` ON `word_chars` (`hanja`);--> statement-breakpoint
-- 5) Enrichment cache: keys are hashed (cannot filter by language) and the prompt/schema changed.
DELETE FROM `ai_cache`;
