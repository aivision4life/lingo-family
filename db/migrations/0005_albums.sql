ALTER TABLE `deck_words` ADD `added_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `kind` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
-- Rows that existed before this migration join "at migration time".
UPDATE `deck_words` SET `added_at` = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE `added_at` = 0;--> statement-breakpoint
-- Hand-written triggers (drizzle-kit does not know them; db/migrations.test.ts checks them).
-- New rows left at added_at = 0 get the insert time.
CREATE TRIGGER `deck_words_added_at` AFTER INSERT ON `deck_words` WHEN NEW.`added_at` = 0
BEGIN
  UPDATE `deck_words` SET `added_at` = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE `deck_id` = NEW.`deck_id` AND `word_id` = NEW.`word_id`;
END;--> statement-breakpoint
-- A word can only join a deck of its own language (albums are per language).
CREATE TRIGGER `deck_words_same_lang` BEFORE INSERT ON `deck_words`
WHEN (SELECT `lang` FROM `decks` WHERE `id` = NEW.`deck_id`) <> (SELECT `lang` FROM `words` WHERE `id` = NEW.`word_id`)
BEGIN
  SELECT RAISE(ABORT, 'deck_words: word and deck languages differ');
END;
